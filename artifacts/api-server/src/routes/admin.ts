import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { eq, and, desc, gt, inArray, or, sql } from "drizzle-orm";
import {
  connectDb, db,
  users, apps, logs, passwordResetRequests, payments, subscriptions, pesapalSettings, deployments,
} from "@workspace/db";
import type { App } from "@workspace/db";
import slugify from "slugify";
import { startApp, stopApp, restartApp, subscribeToLogs, getLogBuffer, deleteAppFiles } from "../services/processManager.js";
import { encrypt, decrypt } from "../lib/crypto.js";

function safeDecrypt(value: string): string {
  try { return decrypt(value); } catch { return value; }
}
function encryptEnvVars(envVars: Array<{ key: string; value: string }>) {
  return envVars.map((e) => ({ key: e.key, value: encrypt(e.value) }));
}

const ADMIN_OWNER_ID = "00000000-0000-0000-0000-000000000001";

const router: IRouter = Router();

const ADMIN_USERNAME = "BILLnutter001002";
const ADMIN_KEY = "42819408hosting";

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET not configured");
  return secret;
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
  if (!token) { res.status(401).json({ error: "Admin authentication required" }); return; }
  try {
    const payload = jwt.verify(token, getJwtSecret()) as { role?: string };
    if (payload.role !== "admin") { res.status(403).json({ error: "Admin access required" }); return; }
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired admin token" });
  }
}

router.post("/admin/login", (req, res) => {
  const { username, key } = req.body as { username: string; key: string };
  if (!username || !key) { res.status(400).json({ error: "Username and key are required" }); return; }
  if (username !== ADMIN_USERNAME || key !== ADMIN_KEY) { res.status(401).json({ error: "Invalid admin credentials" }); return; }
  const token = jwt.sign({ role: "admin", adminId: username }, getJwtSecret(), { expiresIn: "8h" });
  res.json({ adminToken: token });
});

router.get("/admin/stats", requireAdmin, async (req, res) => {
  try {
    await connectDb();
    const [
      [userCount],
      [appCount],
      [pendingResetCount],
      [revenueRow],
    ] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(users),
      db.select({ count: sql<number>`count(*)::int` }).from(apps),
      db.select({ count: sql<number>`count(*)::int` }).from(passwordResetRequests).where(eq(passwordResetRequests.status, "pending")),
      db.select({ total: sql<string>`COALESCE(SUM(amount),0)::text` }).from(payments).where(eq(payments.status, "completed")),
    ]);
    res.json({
      totalUsers: userCount?.count ?? 0,
      totalApps: appCount?.count ?? 0,
      pendingResets: pendingResetCount?.count ?? 0,
      totalRevenue: parseFloat(revenueRow?.total ?? "0"),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/users", requireAdmin, async (req, res) => {
  try {
    await connectDb();
    const allUsers = await db.select().from(users).orderBy(desc(users.createdAt));
    const userIds = allUsers.map((u) => u.id);

    if (userIds.length === 0) { res.json([]); return; }

    const [appCounts, subs] = await Promise.all([
      db.select({ ownerId: apps.ownerId, count: sql<number>`count(*)::int` })
        .from(apps)
        .where(inArray(apps.ownerId, userIds))
        .groupBy(apps.ownerId),
      db.select().from(subscriptions).where(
        and(inArray(subscriptions.userId, userIds), eq(subscriptions.status, "active"), gt(subscriptions.expiresAt, new Date()))
      ),
    ]);

    const countMap: Record<string, number> = {};
    for (const { ownerId, count } of appCounts) countMap[ownerId] = count;

    const subMap: Record<string, Date> = {};
    for (const s of subs) subMap[s.userId] = s.expiresAt;

    res.json(allUsers.map((u) => ({
      id: u.id,
      email: u.email,
      phone: u.phone ?? "",
      status: u.status ?? "active",
      appCount: countMap[u.id] ?? 0,
      subscriptionActive: !!subMap[u.id],
      subscriptionExpiry: subMap[u.id] ?? null,
      createdAt: u.createdAt,
    })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/users/:id/apps", requireAdmin, async (req, res) => {
  try {
    await connectDb();
    const userApps = await db.select().from(apps).where(eq(apps.ownerId, String(req.params.id))).orderBy(desc(apps.createdAt));
    res.json(userApps.map((a) => ({
      id: a.id, name: a.name, slug: a.slug, repoUrl: a.repoUrl,
      status: a.status, lastDeployedAt: a.lastDeployedAt, createdAt: a.createdAt,
    })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/admin/users/:id/status", requireAdmin, async (req, res) => {
  try {
    await connectDb();
    const { status } = req.body as { status: string };
    if (!["active", "suspended", "deactivated"].includes(status)) {
      res.status(400).json({ error: "Invalid status. Use: active, suspended, deactivated" }); return;
    }
    const [user] = await db.update(users).set({ status, updatedAt: new Date() }).where(eq(users.id, String(req.params.id))).returning();
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    if (status === "suspended" || status === "deactivated") {
      const runningApps = await db.select().from(apps).where(and(eq(apps.ownerId, user.id), eq(apps.status, "running")));
      await Promise.all(runningApps.map((a) => stopApp(a.id)));
      await db.update(users).set({ refreshTokens: [], updatedAt: new Date() }).where(eq(users.id, user.id));
    }
    res.json({ id: user.id, status: user.status });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/admin/users/:id", requireAdmin, async (req, res) => {
  try {
    await connectDb();
    const [user] = await db.select().from(users).where(eq(users.id, String(req.params.id))).limit(1);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    const userApps = await db.select().from(apps).where(eq(apps.ownerId, user.id));
    await Promise.all(userApps.map(async (a) => {
      try { await stopApp(a.id); } catch {}
      await db.delete(logs).where(eq(logs.appId, a.id));
      await db.delete(deployments).where(eq(deployments.appId, a.id));
      await db.delete(apps).where(eq(apps.id, a.id));
      deleteAppFiles(a.slug).catch(() => {});
    }));

    await db.delete(payments).where(eq(payments.userId, user.id));
    await db.delete(subscriptions).where(eq(subscriptions.userId, user.id));
    await db.delete(users).where(eq(users.id, user.id));
    res.json({ message: "User and all associated data deleted" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/password-requests", requireAdmin, async (req, res) => {
  try {
    await connectDb();
    const requests = await db.select().from(passwordResetRequests)
      .where(eq(passwordResetRequests.status, "pending"))
      .orderBy(desc(passwordResetRequests.createdAt));
    res.json(requests.map((r) => ({
      id: r.id, email: r.email, preferredPassword: r.preferredPassword,
      status: r.status, createdAt: r.createdAt,
    })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/admin/password-requests/:id/resolve", requireAdmin, async (req, res) => {
  try {
    await connectDb();
    const [request] = await db.select().from(passwordResetRequests).where(eq(passwordResetRequests.id, String(req.params.id))).limit(1);
    if (!request) { res.status(404).json({ error: "Request not found" }); return; }
    if (request.status !== "pending") { res.status(400).json({ error: "Request already resolved" }); return; }

    const [user] = await db.select().from(users).where(eq(users.email, request.email)).limit(1);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    const newHash = await bcrypt.hash(request.preferredPassword, 12);
    await db.update(users).set({ passwordHash: newHash, refreshTokens: [], updatedAt: new Date() }).where(eq(users.id, user.id));
    await db.update(passwordResetRequests).set({ status: "resolved", updatedAt: new Date() }).where(eq(passwordResetRequests.id, request.id));
    res.json({ message: "Password updated successfully" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/admin/password-requests/:id/reject", requireAdmin, async (req, res) => {
  try {
    await connectDb();
    const [request] = await db.select().from(passwordResetRequests).where(eq(passwordResetRequests.id, String(req.params.id))).limit(1);
    if (!request) { res.status(404).json({ error: "Request not found" }); return; }
    await db.update(passwordResetRequests).set({ status: "rejected", updatedAt: new Date() }).where(eq(passwordResetRequests.id, request.id));
    res.json({ message: "Request rejected" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/apps", requireAdmin, async (req, res) => {
  try {
    await connectDb();
    const allApps = await db.select().from(apps).orderBy(desc(apps.createdAt));
    const ownerIds = [...new Set(allApps.map((a) => a.ownerId))];
    const appUsers = ownerIds.length > 0
      ? await db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, ownerIds))
      : [];
    const userMap: Record<string, string> = {};
    for (const u of appUsers) userMap[u.id] = u.email;

    res.json(allApps.map((a) => ({
      id: a.id, name: a.name, slug: a.slug, repoUrl: a.repoUrl,
      status: a.status, ownerEmail: userMap[a.ownerId] ?? "Admin",
      lastDeployedAt: a.lastDeployedAt, createdAt: a.createdAt,
    })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/repo-meta", requireAdmin, async (req, res) => {
  try {
    const { repoUrl, pat, branch } = req.query as { repoUrl?: string; pat?: string; branch?: string };
    if (!repoUrl) { res.status(400).json({ error: "repoUrl is required" }); return; }
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/|$)/);
    if (!match) { res.status(400).json({ error: "Invalid GitHub repository URL" }); return; }
    const [, owner, repo] = match;
    const headers: Record<string, string> = pat ? { Authorization: `token ${pat}` } : {};
    const branchesToTry = branch ? [branch, "main", "master"].filter((v, i, a) => a.indexOf(v) === i) : ["main", "master"];
    let pkgJson: Record<string, unknown> | null = null;
    for (const b of branchesToTry) {
      const resp = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${b}/package.json`, { headers });
      if (resp.ok) { try { pkgJson = await resp.json() as Record<string, unknown>; } catch { pkgJson = null; } break; }
    }
    if (!pkgJson) { res.status(404).json({ error: "package.json not found in repository" }); return; }
    const scripts = (pkgJson.scripts as Record<string, string> | undefined) ?? {};
    let startCommand: string | null = scripts.start ?? scripts.serve ?? null;
    if (!startCommand && typeof pkgJson.main === "string" && pkgJson.main) startCommand = `node ${pkgJson.main}`;
    if (!startCommand) {
      for (const b of branchesToTry) {
        const pfResp = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${b}/Procfile`, { headers });
        if (pfResp.ok) { const t = await pfResp.text(); const w = t.split("\n").find((l) => l.startsWith("web:")); if (w) startCommand = w.replace(/^web:\s*/, "").trim(); break; }
      }
    }
    let installCommand = "npm install";
    if (pkgJson.packageManager && typeof pkgJson.packageManager === "string") {
      const pm = (pkgJson.packageManager as string).split("@")[0];
      installCommand = `${pm} install`;
    }
    res.json({ startCommand, buildCommand: scripts.build ?? null, installCommand, scripts: Object.keys(scripts) });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.get("/admin/env-template", requireAdmin, async (req, res) => {
  try {
    const { repoUrl, pat, branch } = req.query as { repoUrl?: string; pat?: string; branch?: string };
    if (!repoUrl) { res.status(400).json({ error: "repoUrl is required" }); return; }
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/|$)/);
    if (!match) { res.status(400).json({ error: "Invalid GitHub repository URL" }); return; }
    const [, owner, repo] = match;
    const headers: Record<string, string> = pat ? { Authorization: `token ${pat}` } : {};
    const branchesToTry = branch ? [branch, "main", "master"].filter((v, i, a) => a.indexOf(v) === i) : ["main", "master"];

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
        result.push({ key, defaultValue, comment: lastComment, required: defaultValue === "" });
        lastComment = null;
      }
      return result;
    }

    // 1. Try .env.example and .env.sample
    const envFiles = [".env.example", ".env.sample"];
    for (const b of branchesToTry) {
      for (const envFile of envFiles) {
        const resp = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${b}/${envFile}`, { headers });
        if (resp.ok) { res.json({ keys: parseEnvExample(await resp.text()), source: envFile }); return; }
      }
    }

    // 2. Fallback: scan source files for process.env.XXX — like Heroku config detection
    const sourceFiles = [
      "app.js", "app.ts", "index.js", "index.ts",
      "server.js", "server.ts", "bot.js", "bot.ts",
      "main.js", "main.ts", "src/app.js", "src/app.ts",
      "src/index.js", "src/index.ts", "src/server.js", "src/server.ts",
    ];
    const detectedKeys = new Set<string>();
    for (const b of branchesToTry) {
      for (const file of sourceFiles) {
        const resp = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${b}/${file}`, { headers });
        if (!resp.ok) continue;
        const text = await resp.text();
        // Match process.env.VAR_NAME (not followed by ?)
        const matches = text.matchAll(/process\.env\.([A-Z][A-Z0-9_]{1,})/g);
        for (const m of matches) detectedKeys.add(m[1]);
        if (detectedKeys.size > 0) break;
      }
      if (detectedKeys.size > 0) break;
    }

    if (detectedKeys.size > 0) {
      const keys = Array.from(detectedKeys)
        .sort()
        .map((key) => ({ key, defaultValue: "", comment: "Detected from source code", required: true }));
      res.json({ keys, source: "source scan" });
      return;
    }

    res.status(404).json({ error: "No .env.example found in repository" });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/admin/users/:id/apps", requireAdmin, async (req, res) => {
  try {
    await connectDb();
    const [user] = await db.select().from(users).where(eq(users.id, String(req.params.id))).limit(1);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    const { name, repoUrl, branch, startCommand, installCommand, port, autoRestart, envVars } = req.body as {
      name: string; repoUrl: string; branch?: string; startCommand?: string;
      installCommand?: string; port?: number; autoRestart?: boolean;
      envVars?: Array<{ key: string; value: string }>;
    };
    if (!name || !repoUrl) { res.status(400).json({ error: "name and repoUrl are required" }); return; }

    let baseSlug = slugify(name, { lower: true, strict: true }) || "app";
    let slug = baseSlug; let counter = 1;
    while (true) {
      const exists = await db.select({ id: apps.id }).from(apps).where(eq(apps.slug, slug)).limit(1);
      if (exists.length === 0) break;
      slug = `${baseSlug}-${counter++}`;
    }

    const [app] = await db.insert(apps).values({
      ownerId: user.id, name, slug, repoUrl,
      branch: branch ?? "main",
      startCommand: startCommand ?? null,
      installCommand: installCommand ?? null,
      port: port ?? null,
      autoRestart: autoRestart ?? false,
      envVars: encryptEnvVars(envVars ?? []),
      status: "idle",
    }).returning();

    startApp(app.id).catch(() => {});
    res.status(201).json({ id: app.id, name: app.name, slug: app.slug, status: app.status });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/users/:id/subscription", requireAdmin, async (req, res) => {
  try {
    await connectDb();
    const [user] = await db.select().from(users).where(eq(users.id, String(req.params.id))).limit(1);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const [payment] = await db.insert(payments).values({
      userId: user.id, email: user.email, phone: "",
      amount: "150", currency: "KES",
      pesapalOrderId: `manual-${Date.now()}`,
      pesapalTrackingId: `manual-${Date.now()}`,
      status: "completed",
    }).returning();

    await db.insert(subscriptions).values({
      userId: user.id, email: user.email, status: "active",
      paidAt: now, expiresAt, amount: "150", currency: "KES", paymentId: payment.id,
    });

    res.json({ message: "30-day subscription granted", expiresAt });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/admin/users/:id/subscription", requireAdmin, async (req, res) => {
  try {
    await connectDb();
    const [user] = await db.select().from(users).where(eq(users.id, String(req.params.id))).limit(1);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    await db.update(subscriptions)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(and(eq(subscriptions.userId, user.id), eq(subscriptions.status, "active")));
    res.json({ message: "Subscription deactivated" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

function toAdminAppJson(app: App) {
  return {
    id: app.id, name: app.name, slug: app.slug, repoUrl: app.repoUrl, branch: app.branch ?? "main",
    status: app.status, startCommand: app.startCommand, installCommand: app.installCommand,
    port: app.port, autoRestart: app.autoRestart,
    envVars: (app.envVars ?? []).map((e: { key: string; value: string }) => ({ key: e.key, value: safeDecrypt(e.value) })),
    lastDeployedAt: app.lastDeployedAt?.toISOString(),
    createdAt: app.createdAt.toISOString(),
  };
}

router.get("/admin/my-apps", requireAdmin, async (req, res) => {
  try {
    await connectDb();
    const adminApps = await db.select().from(apps).where(eq(apps.ownerId, ADMIN_OWNER_ID)).orderBy(desc(apps.createdAt));
    res.json(adminApps.map((a) => ({
      id: a.id, name: a.name, slug: a.slug, repoUrl: a.repoUrl,
      status: a.status, lastDeployedAt: a.lastDeployedAt?.toISOString(), createdAt: a.createdAt.toISOString(),
    })));
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/admin/my-apps", requireAdmin, async (req, res) => {
  try {
    await connectDb();
    const { name, repoUrl, branch, startCommand, installCommand, port, envVars } = req.body as {
      name: string; repoUrl: string; branch?: string; startCommand?: string;
      installCommand?: string; port?: number; envVars?: { key: string; value: string }[];
    };
    if (!name || !repoUrl) { res.status(400).json({ error: "name and repoUrl are required" }); return; }

    let base = slugify(name, { lower: true, strict: true }) || "admin-app";
    let slug = base; let counter = 1;
    while (true) {
      const exists = await db.select({ id: apps.id }).from(apps).where(eq(apps.slug, slug)).limit(1);
      if (exists.length === 0) break;
      slug = `${base}-${counter++}`;
    }

    const [app] = await db.insert(apps).values({
      ownerId: ADMIN_OWNER_ID, name, repoUrl, branch: branch ?? "main",
      slug, status: "idle", autoRestart: false,
      startCommand: startCommand ?? null, installCommand: installCommand ?? null,
      port: port ?? null, envVars: encryptEnvVars(envVars ?? []),
    }).returning();

    startApp(app.id).catch(() => {});
    res.status(201).json(toAdminAppJson(app));
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.get("/admin/my-apps/:id", requireAdmin, async (req, res) => {
  try {
    await connectDb();
    const [app] = await db.select().from(apps).where(and(eq(apps.id, String(req.params.id)), eq(apps.ownerId, ADMIN_OWNER_ID))).limit(1);
    if (!app) { res.status(404).json({ error: "App not found" }); return; }
    res.json(toAdminAppJson(app));
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.delete("/admin/my-apps/:id", requireAdmin, async (req, res) => {
  try {
    await connectDb();
    const [app] = await db.select().from(apps).where(and(eq(apps.id, String(req.params.id)), eq(apps.ownerId, ADMIN_OWNER_ID))).limit(1);
    if (!app) { res.status(404).json({ error: "App not found" }); return; }
    await stopApp(app.id);
    await db.delete(logs).where(eq(logs.appId, app.id));
    await db.delete(deployments).where(eq(deployments.appId, app.id));
    await db.delete(apps).where(eq(apps.id, app.id));
    deleteAppFiles(app.slug).catch(() => {});
    res.json({ message: "App deleted" });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/admin/my-apps/:id/start", requireAdmin, async (req, res) => {
  try {
    await connectDb();
    const [app] = await db.select().from(apps).where(and(eq(apps.id, String(req.params.id)), eq(apps.ownerId, ADMIN_OWNER_ID))).limit(1);
    if (!app) { res.status(404).json({ error: "App not found" }); return; }
    startApp(app.id).catch(() => {});
    res.json({ message: "Start initiated" });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/admin/my-apps/:id/stop", requireAdmin, async (req, res) => {
  try {
    await connectDb();
    const [app] = await db.select().from(apps).where(and(eq(apps.id, String(req.params.id)), eq(apps.ownerId, ADMIN_OWNER_ID))).limit(1);
    if (!app) { res.status(404).json({ error: "App not found" }); return; }
    await stopApp(app.id);
    res.json({ message: "App stopped" });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.post("/admin/my-apps/:id/restart", requireAdmin, async (req, res) => {
  try {
    await connectDb();
    const [app] = await db.select().from(apps).where(and(eq(apps.id, String(req.params.id)), eq(apps.ownerId, ADMIN_OWNER_ID))).limit(1);
    if (!app) { res.status(404).json({ error: "App not found" }); return; }
    restartApp(app.id).catch(() => {});
    res.json({ message: "Restart initiated" });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.get("/admin/my-apps/:id/logs/stream", async (req, res) => {
  const token = (req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : null)
    ?? (typeof req.query.token === "string" ? req.query.token : null);
  if (!token) { res.status(401).json({ error: "Admin authentication required" }); return; }
  try { const p = jwt.verify(token, getJwtSecret()) as { role?: string }; if (p.role !== "admin") { res.status(403).json({ error: "Admin access required" }); return; } }
  catch { res.status(401).json({ error: "Invalid or expired admin token" }); return; }

  try {
    await connectDb();
    const [app] = await db.select().from(apps).where(and(eq(apps.id, String(req.params.id)), eq(apps.ownerId, ADMIN_OWNER_ID))).limit(1);
    if (!app) { res.status(404).json({ error: "App not found" }); return; }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const flush = () => { if (typeof (res as any).flush === "function") (res as any).flush(); };
    const send = (data: unknown) => { res.write(`data: ${JSON.stringify(data)}\n\n`); flush(); };

    const sinceRaw = req.query.since as string | undefined;
    const buf = getLogBuffer(app.id);
    if (sinceRaw) {
      const since = new Date(sinceRaw);
      for (const log of buf) {
        if (log.timestamp > since) send({ line: log.line, stream: log.stream, timestamp: log.timestamp.toISOString() });
      }
    } else {
      for (const log of buf) send({ line: log.line, stream: log.stream, timestamp: log.timestamp.toISOString() });
    }

    const unsubscribe = subscribeToLogs(app.id, (ev) => send({ line: ev.line, stream: ev.stream, timestamp: ev.timestamp.toISOString() }));
    const keepAlive = setInterval(() => { res.write(": ping\n\n"); flush(); }, 15000);
    req.on("close", () => { unsubscribe(); clearInterval(keepAlive); });
  } catch (err) { req.log.error(err); res.status(500).json({ error: "Internal server error" }); }
});

router.patch("/admin/apps/:id/action", requireAdmin, async (req, res) => {
  try {
    await connectDb();
    const { action } = req.body as { action: "stop" | "start" };
    const [app] = await db.select().from(apps).where(eq(apps.id, String(req.params.id))).limit(1);
    if (!app) { res.status(404).json({ error: "App not found" }); return; }
    if (action === "stop") await stopApp(app.id);
    const [updated] = await db.select().from(apps).where(eq(apps.id, app.id)).limit(1);
    res.json({ id: app.id, status: updated?.status ?? app.status });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/admin/revenue", requireAdmin, async (req, res) => {
  try {
    await connectDb();
    const [allPayments, [revenueRow]] = await Promise.all([
      db.select().from(payments).orderBy(desc(payments.createdAt)),
      db.select({ total: sql<string>`COALESCE(SUM(amount),0)::text` }).from(payments).where(eq(payments.status, "completed")),
    ]);
    res.json({
      totalRevenue: parseFloat(revenueRow?.total ?? "0"),
      currency: "KES",
      payments: allPayments.map((p) => ({
        id: p.id, email: p.email, phone: p.phone,
        amount: parseFloat(p.amount), currency: p.currency,
        status: p.status, pesapalOrderId: p.pesapalOrderId,
        pesapalTrackingId: p.pesapalTrackingId, createdAt: p.createdAt,
      })),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/admin/settings/rawtest", requireAdmin, async (req, res) => {
  const { consumerKey, consumerSecret, isProduction } = req.body as {
    consumerKey: string; consumerSecret: string; isProduction?: boolean;
  };
  const key = (consumerKey ?? "").trim();
  const secret = (consumerSecret ?? "").trim();
  const prod = isProduction ?? false;
  const baseUrl = prod ? "https://pay.pesapal.com/v3" : "https://cybqa.pesapal.com/pesapalv3";
  const url = `${baseUrl}/api/Auth/RequestToken`;
  const payload = JSON.stringify({ consumer_key: key, consumer_secret: secret });
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: payload,
    });
    const data = await resp.json();
    res.json({ ok: resp.ok, status: resp.status, data });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/admin/settings", requireAdmin, async (req, res) => {
  try {
    await connectDb();
    const [settings] = await db.select().from(pesapalSettings).limit(1);
    if (!settings) { res.json({ consumerKey: "", consumerSecret: "", ipnId: "", isProduction: false }); return; }
    res.json({
      id: settings.id, consumerKey: settings.consumerKey, consumerSecret: settings.consumerSecret,
      ipnId: settings.ipnId, isProduction: settings.isProduction,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/admin/settings", requireAdmin, async (req, res) => {
  try {
    await connectDb();
    const { consumerKey, consumerSecret, isProduction } = req.body as {
      consumerKey: string; consumerSecret: string; isProduction?: boolean;
    };
    const [existing] = await db.select().from(pesapalSettings).limit(1);
    if (existing) {
      const [updated] = await db.update(pesapalSettings)
        .set({ consumerKey: consumerKey.trim(), consumerSecret: consumerSecret.trim(), isProduction: isProduction ?? false, updatedAt: new Date() })
        .where(eq(pesapalSettings.id, existing.id))
        .returning();
      res.json({ id: updated.id, consumerKey: updated.consumerKey, isProduction: updated.isProduction });
    } else {
      const [created] = await db.insert(pesapalSettings).values({
        consumerKey: consumerKey.trim(), consumerSecret: consumerSecret.trim(), isProduction: isProduction ?? false,
      }).returning();
      res.json({ id: created.id, consumerKey: created.consumerKey, isProduction: created.isProduction });
    }
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
