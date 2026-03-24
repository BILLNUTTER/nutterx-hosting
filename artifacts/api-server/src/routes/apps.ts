import { Router, type IRouter, type Request, type Response } from "express";
import slugify from "slugify";
import mongoose from "mongoose";
import { connectMongo, App, Log, type IApp } from "@workspace/mongo";
import { requireAuth } from "../middlewares/auth.js";
import { startApp, stopApp, restartApp } from "../services/processManager.js";
import { encrypt, decrypt } from "../lib/crypto.js";

const router: IRouter = Router();

function toApiApp(doc: IApp | null) {
  if (!doc) return null;
  return {
    id: (doc._id as mongoose.Types.ObjectId).toString(),
    name: doc.name,
    repoUrl: doc.repoUrl,
    branch: doc.branch ?? "main",
    slug: doc.slug,
    status: doc.status,
    autoRestart: doc.autoRestart,
    startCommand: doc.startCommand ?? null,
    installCommand: doc.installCommand ?? null,
    port: doc.port ?? null,
    envVars: doc.envVars.map((e) => ({ key: e.key, value: safeDecrypt(e.value) })),
    lastDeployedAt: doc.lastDeployedAt?.toISOString() ?? null,
    errorMessage: doc.errorMessage ?? null,
    createdAt: (doc.createdAt as Date).toISOString(),
    updatedAt: (doc.updatedAt as Date).toISOString(),
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
  const base = slugify(name, { lower: true, strict: true, trim: true });
  let candidate = base;
  let i = 0;
  while (await App.exists({ slug: candidate })) {
    i++;
    candidate = `${base}-${i}`;
  }
  return candidate;
}

router.get("/apps", requireAuth, async (req: Request, res: Response) => {
  try {
    await connectMongo();
    const apps = await App.find({ owner: req.user!.userId }).sort({ createdAt: -1 });
    res.json(apps.map(toApiApp));
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

    if (text === null) {
      res.status(404).json({ error: ".env.example not found in repository" });
      return;
    }

    const keys = parseEnvExample(text);
    res.json({ keys });
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
        try {
          pkgJson = await resp.json() as Record<string, unknown>;
        } catch {
          pkgJson = null;
        }
        break;
      }
    }

    if (!pkgJson) {
      res.status(404).json({ error: "package.json not found in repository" });
      return;
    }

    const scripts = (pkgJson.scripts as Record<string, string> | undefined) ?? {};
    const startCommand = scripts.start ?? scripts.serve ?? null;
    const buildCommand = scripts.build ?? null;

    let installCommand: string | null = null;
    if (pkgJson.packageManager && typeof pkgJson.packageManager === "string") {
      const pm = (pkgJson.packageManager as string).split("@")[0];
      installCommand = `${pm} install`;
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
    if (!trimmed) {
      lastComment = null;
      continue;
    }
    if (trimmed.startsWith("#")) {
      lastComment = trimmed.slice(1).trim();
      continue;
    }
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) {
      lastComment = null;
      continue;
    }
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
    await connectMongo();
    const { name, repoUrl, branch, pat, autoRestart, startCommand, installCommand, port } = req.body as {
      name: string;
      repoUrl: string;
      branch?: string;
      pat?: string;
      autoRestart?: boolean;
      startCommand?: string;
      installCommand?: string;
      port?: number;
    };

    if (!name || !repoUrl) {
      res.status(400).json({ error: "name and repoUrl are required" });
      return;
    }

    const slug = await generateSlug(name);

    const app = await App.create({
      owner: new mongoose.Types.ObjectId(req.user!.userId),
      name,
      repoUrl,
      branch: branch || "main",
      pat,
      slug,
      autoRestart: autoRestart ?? false,
      startCommand,
      installCommand,
      port,
      status: "idle",
    });

    res.status(201).json(toApiApp(app));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/apps/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    await connectMongo();
    const app = await App.findOne({ _id: req.params.id, owner: req.user!.userId });
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
    await connectMongo();
    const { name, repoUrl, pat, autoRestart, startCommand, installCommand, port } = req.body as {
      name?: string;
      repoUrl?: string;
      pat?: string;
      autoRestart?: boolean;
      startCommand?: string;
      installCommand?: string;
      port?: number;
    };

    const update: Record<string, unknown> = {};
    if (name !== undefined) update.name = name;
    if (repoUrl !== undefined) update.repoUrl = repoUrl;
    if (pat !== undefined) update.pat = pat;
    if (autoRestart !== undefined) update.autoRestart = autoRestart;
    if (startCommand !== undefined) update.startCommand = startCommand;
    if (installCommand !== undefined) update.installCommand = installCommand;
    if (port !== undefined) update.port = port;

    const app = await App.findOneAndUpdate(
      { _id: req.params.id, owner: req.user!.userId },
      update,
      { new: true }
    );
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
    await connectMongo();
    const app = await App.findOne({ _id: req.params.id, owner: req.user!.userId });
    if (!app) {
      res.status(404).json({ error: "App not found" });
      return;
    }

    try {
      await stopApp(app._id.toString());
    } catch {
    }

    await app.deleteOne();
    res.json({ message: "App deleted successfully" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/apps/:id/env", requireAuth, async (req: Request, res: Response) => {
  try {
    await connectMongo();
    const { envVars } = req.body as { envVars: Array<{ key: string; value: string }> };

    if (!Array.isArray(envVars)) {
      res.status(400).json({ error: "envVars must be an array" });
      return;
    }

    const app = await App.findOneAndUpdate(
      { _id: req.params.id, owner: req.user!.userId },
      { envVars: encryptEnvVars(envVars) },
      { new: true }
    );
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
    await connectMongo();
    const app = await App.findOne({ _id: req.params.id, owner: req.user!.userId });
    if (!app) {
      res.status(404).json({ error: "App not found" });
      return;
    }

    startApp(app._id.toString()).catch((err) => {
      req.log.error(err, "App start failed");
    });

    res.json({ message: "App start initiated" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/apps/:id/stop", requireAuth, async (req: Request, res: Response) => {
  try {
    await connectMongo();
    const app = await App.findOne({ _id: req.params.id, owner: req.user!.userId });
    if (!app) {
      res.status(404).json({ error: "App not found" });
      return;
    }

    await stopApp(app._id.toString());
    res.json({ message: "App stopped" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/apps/:id/restart", requireAuth, async (req: Request, res: Response) => {
  try {
    await connectMongo();
    const app = await App.findOne({ _id: req.params.id, owner: req.user!.userId });
    if (!app) {
      res.status(404).json({ error: "App not found" });
      return;
    }

    restartApp(app._id.toString()).catch((err) => {
      req.log.error(err, "App restart failed");
    });

    res.json({ message: "App restart initiated" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/apps/:id/logs", requireAuth, async (req: Request, res: Response) => {
  try {
    await connectMongo();
    const app = await App.findOne({ _id: req.params.id, owner: req.user!.userId });
    if (!app) {
      res.status(404).json({ error: "App not found" });
      return;
    }

    const limit = parseInt((req.query.limit as string) ?? "100", 10);
    const logs = await Log.find({ appId: app._id })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();

    const result = logs.reverse().map((l) => ({
      id: l._id.toString(),
      appId: app._id.toString(),
      line: l.line,
      stream: l.stream,
      timestamp: (l.timestamp as Date).toISOString(),
    }));

    res.json(result);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/apps/:id/logs/stream", requireAuth, async (req: Request, res: Response) => {
  try {
    await connectMongo();
    const app = await App.findOne({ _id: req.params.id, owner: req.user!.userId });
    if (!app) {
      res.status(404).json({ error: "App not found" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const send = (data: unknown) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const recentLogs = await Log.find({ appId: app._id })
      .sort({ timestamp: -1 })
      .limit(100)
      .lean();

    for (const log of recentLogs.reverse()) {
      send({ line: log.line, stream: log.stream, timestamp: (log.timestamp as Date).toISOString() });
    }

    const appId = (app._id as mongoose.Types.ObjectId).toString();
    let changeStream: mongoose.mongo.ChangeStream | null = null;

    try {
      const col = mongoose.connection.db?.collection("logs");
      if (col) {
        changeStream = col.watch(
          [{ $match: { "fullDocument.appId": new mongoose.Types.ObjectId(appId) } }],
          { fullDocument: "updateLookup" }
        ) as unknown as mongoose.mongo.ChangeStream;

        changeStream.on("change", (change: Record<string, unknown>) => {
          if (change.operationType === "insert" && change.fullDocument) {
            const doc = change.fullDocument as Record<string, unknown>;
            send({ line: doc.line, stream: doc.stream, timestamp: (doc.timestamp as Date).toISOString() });
          }
        });

        changeStream.on("error", () => {
          res.end();
        });
      }
    } catch {
    }

    const keepAlive = setInterval(() => {
      res.write(": ping\n\n");
    }, 30000);

    req.on("close", () => {
      clearInterval(keepAlive);
      if (changeStream) {
        changeStream.close().catch(() => {});
      }
    });
  } catch (err) {
    req.log.error(err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

export default router;
