import { Router, type IRouter, type Request, type Response } from "express";
import slugify from "slugify";
import { eq, and, desc, asc, gt } from "drizzle-orm";
import { connectDb, db, apps, logs } from "@workspace/db";
import type { App } from "@workspace/db";
import { requireAuth } from "../middlewares/auth.js";
import { startApp, stopApp, restartApp, subscribeToLogs } from "../services/processManager.js";
import { encrypt, decrypt } from "../lib/crypto.js";

const router: IRouter = Router();

function toApiApp(doc: App) {
  return {
    id: doc.id,
    name: doc.name,
    repoUrl: doc.repoUrl,
    branch: doc.branch ?? "main",
    slug: doc.slug,
    status: doc.status,
    autoRestart: doc.autoRestart,
    startCommand: doc.startCommand ?? null,
    installCommand: doc.installCommand ?? null,
    port: doc.port ?? null,
    envVars: (doc.envVars ?? []).map((e) => ({ key: e.key, value: safeDecrypt(e.value) })),
    lastDeployedAt: doc.lastDeployedAt?.toISOString() ?? null,
    errorMessage: doc.errorMessage ?? null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function safeDecrypt(value: string): string {
  try {
    return decrypt(value);
  } catch {
    return value;
  }
}

function encryptEnvVars(envVars: Array<{ key: string; value: string }>) {
  return envVars.map((e) => ({ key: e.key, value: encrypt(e.value) }));
}

async function generateSlug(name: string): Promise<string> {
  let base = slugify(name ?? "", { lower: true, strict: true, trim: true });
  if (!base) {
    base = (name ?? "")
      .replace(/[^a-zA-Z0-9\s-]/g, "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }
  if (!base) base = "app";

  let candidate = base;
  let i = 0;
  while (true) {
    const exists = await db.select({ id: apps.id }).from(apps).where(eq(apps.slug, candidate)).limit(1);
    if (exists.length === 0) break;
    i++;
    candidate = `${base}-${i}`;
  }
  return candidate;
}

router.get("/apps", requireAuth, async (req: Request, res: Response) => {
  try {
    await connectDb();
    const result = await db.select().from(apps).where(eq(apps.ownerId, req.user!.userId)).orderBy(desc(apps.createdAt));
    res.json(result.map(toApiApp));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/apps/env-template", requireAuth, async (req: Request, res: Response) => {
  try {
    const { repoUrl, pat, branch } = req.query as { repoUrl?: string; pat?: string; branch?: string };
    if (!repoUrl) {
      res.status(400).json({ error: "repoUrl is required" });
      return;
    }

    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/|$)/);
    if (!match) {
      res.status(400).json({ error: "Invalid GitHub repository URL" });
      return;
    }

    const [, owner, repo] = match;
    const headers: Record<string, string> = pat ? { Authorization: `token ${pat}` } : {};

    const branchesToTry = branch
      ? [branch, "main", "master"].filter((v, i, a) => a.indexOf(v) === i)
      : ["main", "master"];

    let text: string | null = null;
    for (const b of branchesToTry) {
      const url = `https://raw.githubusercontent.com/${owner}/${repo}/${b}/.env.example`;
      const resp = await fetch(url, { headers });
      if (resp.ok) {
        text = await resp.text();
        break;
      }
    }

    if (text !== null) {
      const keys = parseEnvExample(text);
      res.json({ keys, source: ".env.example" });
      return;
    }

    for (const b of branchesToTry) {
      const url = `https://raw.githubusercontent.com/${owner}/${repo}/${b}/app.json`;
      const resp = await fetch(url, { headers });
      if (resp.ok) {
        try {
          const appJson = await resp.json() as Record<string, unknown>;
          const envSection = appJson.env as Record<string, { description?: string; value?: string; required?: boolean }> | undefined;
          if (envSection && typeof envSection === "object") {
            const keys = Object.entries(envSection).map(([key, meta]) => ({
              key,
              defaultValue: meta?.value ?? "",
              comment: meta?.description ?? null,
              required: meta?.required !== false,
            }));
            res.json({ keys, source: "app.json" });
            return;
          }
        } catch {
          // not valid JSON, skip
        }
        break;
      }
    }

    res.status(404).json({ error: "No .env.example or app.json found in repository" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/apps/repo-meta", requireAuth, async (req: Request, res: Response) => {
  try {
    const { repoUrl, pat, branch } = req.query as { repoUrl?: string; pat?: string; branch?: string };
    if (!repoUrl) {
      res.status(400).json({ error: "repoUrl is required" });
      return;
    }

    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/|$)/);
    if (!match) {
      res.status(400).json({ error: "Invalid GitHub repository URL" });
      return;
    }

    const [, owner, repo] = match;
    const headers: Record<string, string> = pat ? { Authorization: `token ${pat}` } : {};
    const branchesToTry = branch
      ? [branch, "main", "master"].filter((v, i, a) => a.indexOf(v) === i)
      : ["main", "master"];

    let pkgJson: Record<string, unknown> | null = null;
    for (const b of branchesToTry) {
      const url = `https://raw.githubusercontent.com/${owner}/${repo}/${b}/package.json`;
      const resp = await fetch(url, { headers });
      if (resp.ok) {
        try { pkgJson = await resp.json() as Record<string, unknown>; } catch { pkgJson = null; }
        break;
      }
    }

    if (!pkgJson) {
      res.status(404).json({ error: "package.json not found in repository" });
      return;
    }

    const scripts = (pkgJson.scripts as Record<string, string> | undefined) ?? {};
    let startCommand: string | null = scripts.start ?? scripts.serve ?? null;
    const buildCommand = scripts.build ?? null;

    if (!startCommand && typeof pkgJson.main === "string" && pkgJson.main) {
      startCommand = `node ${pkgJson.main}`;
    }

    if (!startCommand) {
      for (const b of branchesToTry) {
        const pfUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${b}/Procfile`;
        const pfResp = await fetch(pfUrl, { headers });
        if (pfResp.ok) {
          const pfText = await pfResp.text();
          const webLine = pfText.split("\n").find((l) => l.startsWith("web:"));
          if (webLine) startCommand = webLine.replace(/^web:\s*/, "").trim();
          break;
        }
      }
    }

    let installCommand: string | null = null;
    if (pkgJson.packageManager && typeof pkgJson.packageManager === "string") {
      const pm = (pkgJson.packageManager as string).split("@")[0];
      installCommand = `${pm} install`;
    } else {
      installCommand = "npm install";
    }

    let port: number | null = null;
    const portSources = [
      (pkgJson.config as Record<string, unknown> | undefined)?.port,
      (pkgJson.engines as Record<string, unknown> | undefined)?.port,
    ];
    for (const src of portSources) {
      const n = Number(src);
      if (!isNaN(n) && n > 0) { port = n; break; }
    }
    if (!port && startCommand) {
      const portMatch = startCommand.match(/PORT[=\s]+(\d+)/);
      if (portMatch) port = parseInt(portMatch[1], 10);
    }

    res.json({ startCommand, buildCommand, installCommand, port, scripts: Object.keys(scripts) });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

function parseEnvExample(content: string) {
  const result: Array<{ key: string; defaultValue: string; comment: string | null; required: boolean }> = [];
  let lastComment: string | null = null;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) { lastComment = null; continue; }
    if (trimmed.startsWith("#")) { lastComment = trimmed.slice(1).trim(); continue; }
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) { lastComment = null; continue; }
    const key = trimmed.slice(0, eqIdx).trim();
    const rawValue = trimmed.slice(eqIdx + 1).trim();
    const defaultValue = rawValue.replace(/^["']|["']$/g, "");
    const required = defaultValue === "" || defaultValue === '""' || defaultValue === "''";
    result.push({ key, defaultValue, comment: lastComment, required });
    lastComment = null;
  }

  return result;
}

router.post("/apps", requireAuth, async (req: Request, res: Response) => {
  try {
    await connectDb();
    const { name, repoUrl, branch, pat, autoRestart, startCommand, installCommand, port } = req.body as {
      name: string; repoUrl: string; branch?: string; pat?: string;
      autoRestart?: boolean; startCommand?: string; installCommand?: string; port?: number;
    };

    if (!name || !repoUrl) {
      res.status(400).json({ error: "name and repoUrl are required" });
      return;
    }

    const slug = await generateSlug(name);

    const [app] = await db.insert(apps).values({
      ownerId: req.user!.userId,
      name,
      repoUrl,
      branch: branch || "main",
      pat: pat ?? null,
      slug,
      autoRestart: autoRestart ?? false,
      startCommand: startCommand ?? null,
      installCommand: installCommand ?? null,
      port: port ?? null,
      status: "idle",
    }).returning();

    res.status(201).json(toApiApp(app));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/apps/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    await connectDb();
    const [app] = await db.select().from(apps).where(and(eq(apps.id, String(req.params.id)), eq(apps.ownerId, req.user!.userId))).limit(1);
    if (!app) {
      res.status(404).json({ error: "App not found" });
      return;
    }
    res.json(toApiApp(app));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/apps/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    await connectDb();
    const { name, repoUrl, pat, autoRestart, startCommand, installCommand, port } = req.body as {
      name?: string; repoUrl?: string; pat?: string; autoRestart?: boolean;
      startCommand?: string; installCommand?: string; port?: number;
    };

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) update.name = name;
    if (repoUrl !== undefined) update.repoUrl = repoUrl;
    if (pat !== undefined) update.pat = pat;
    if (autoRestart !== undefined) update.autoRestart = autoRestart;
    if (startCommand !== undefined) update.startCommand = startCommand;
    if (installCommand !== undefined) update.installCommand = installCommand;
    if (port !== undefined) update.port = port;

    const [app] = await db.update(apps)
      .set(update as any)
      .where(and(eq(apps.id, String(req.params.id)), eq(apps.ownerId, req.user!.userId)))
      .returning();
    if (!app) {
      res.status(404).json({ error: "App not found" });
      return;
    }
    res.json(toApiApp(app));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/apps/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    await connectDb();
    const [app] = await db.select().from(apps).where(and(eq(apps.id, String(req.params.id)), eq(apps.ownerId, req.user!.userId))).limit(1);
    if (!app) {
      res.status(404).json({ error: "App not found" });
      return;
    }

    try { await stopApp(app.id); } catch {}

    await db.delete(logs).where(eq(logs.appId, app.id));
    await db.delete(apps).where(eq(apps.id, app.id));
    res.json({ message: "App deleted successfully" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/apps/:id/env", requireAuth, async (req: Request, res: Response) => {
  try {
    await connectDb();
    const { envVars } = req.body as { envVars: Array<{ key: string; value: string }> };

    if (!Array.isArray(envVars)) {
      res.status(400).json({ error: "envVars must be an array" });
      return;
    }

    const [app] = await db.update(apps)
      .set({ envVars: encryptEnvVars(envVars), updatedAt: new Date() })
      .where(and(eq(apps.id, String(req.params.id)), eq(apps.ownerId, req.user!.userId)))
      .returning();
    if (!app) {
      res.status(404).json({ error: "App not found" });
      return;
    }
    res.json(toApiApp(app));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/apps/:id/start", requireAuth, async (req: Request, res: Response) => {
  try {
    await connectDb();
    const [app] = await db.select().from(apps).where(and(eq(apps.id, String(req.params.id)), eq(apps.ownerId, req.user!.userId))).limit(1);
    if (!app) { res.status(404).json({ error: "App not found" }); return; }
    startApp(app.id).catch((err) => { req.log.error(err, "App start failed"); });
    res.json({ message: "App start initiated" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/apps/:id/stop", requireAuth, async (req: Request, res: Response) => {
  try {
    await connectDb();
    const [app] = await db.select().from(apps).where(and(eq(apps.id, String(req.params.id)), eq(apps.ownerId, req.user!.userId))).limit(1);
    if (!app) { res.status(404).json({ error: "App not found" }); return; }
    await stopApp(app.id);
    res.json({ message: "App stopped" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/apps/:id/restart", requireAuth, async (req: Request, res: Response) => {
  try {
    await connectDb();
    const [app] = await db.select().from(apps).where(and(eq(apps.id, String(req.params.id)), eq(apps.ownerId, req.user!.userId))).limit(1);
    if (!app) { res.status(404).json({ error: "App not found" }); return; }
    restartApp(app.id).catch((err) => { req.log.error(err, "App restart failed"); });
    res.json({ message: "App restart initiated" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/apps/:id/logs", requireAuth, async (req: Request, res: Response) => {
  try {
    await connectDb();
    const [app] = await db.select().from(apps).where(and(eq(apps.id, String(req.params.id)), eq(apps.ownerId, req.user!.userId))).limit(1);
    if (!app) { res.status(404).json({ error: "App not found" }); return; }

    const limit = parseInt((req.query.limit as string) ?? "100", 10);
    const logRows = await db.select().from(logs).where(eq(logs.appId, app.id)).orderBy(desc(logs.timestamp)).limit(limit);

    const result = logRows.reverse().map((l) => ({
      id: l.id,
      appId: app.id,
      line: l.line,
      stream: l.stream,
      timestamp: l.timestamp.toISOString(),
    }));

    res.json(result);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/apps/:id/logs/stream", requireAuth, async (req: Request, res: Response) => {
  try {
    await connectDb();
    const [app] = await db.select().from(apps).where(and(eq(apps.id, String(req.params.id)), eq(apps.ownerId, req.user!.userId))).limit(1);
    if (!app) { res.status(404).json({ error: "App not found" }); return; }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const flush = () => { if (typeof (res as any).flush === "function") (res as any).flush(); };
    const send = (data: unknown) => { res.write(`data: ${JSON.stringify(data)}\n\n`); flush(); };

    const sinceRaw = req.query.since as string | undefined;
    if (sinceRaw) {
      const since = new Date(sinceRaw);
      const gapLogs = await db.select().from(logs)
        .where(and(eq(logs.appId, app.id), gt(logs.timestamp, since)))
        .orderBy(asc(logs.timestamp))
        .limit(200);
      for (const log of gapLogs) {
        send({ line: log.line, stream: log.stream, timestamp: log.timestamp.toISOString() });
      }
    }

    const unsubscribe = subscribeToLogs(app.id, (ev) => {
      send({ line: ev.line, stream: ev.stream, timestamp: ev.timestamp.toISOString() });
    });

    const keepAlive = setInterval(() => { res.write(": ping\n\n"); flush(); }, 15000);

    req.on("close", () => { clearInterval(keepAlive); unsubscribe(); });
  } catch (err) {
    req.log.error(err);
    if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
