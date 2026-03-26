import { spawn, exec, execSync, type ChildProcess } from "child_process";
import { existsSync, mkdirSync, rm } from "fs";
import net from "net";
import path from "path";
import os from "os";
import { EventEmitter } from "events";
import { eq, or, sql } from "drizzle-orm";
import { connectDb, db, apps, logs } from "@workspace/db";
import type { App } from "@workspace/db";
import { decrypt } from "../lib/crypto.js";

export interface LogEvent {
  line: string;
  stream: "stdout" | "stderr" | "system";
  timestamp: Date;
}

const logBus = new EventEmitter();
logBus.setMaxListeners(200);

export function subscribeToLogs(appId: string, cb: (ev: LogEvent) => void): () => void {
  logBus.on(appId, cb);
  return () => logBus.off(appId, cb);
}

const APPS_DIR = process.env.APPS_DIR ?? path.join(os.homedir(), ".nutterx-apps");
const NPM_CACHE_DIR = path.join(os.tmpdir(), "nutterx-npm-cache");
const PNPM_STORE_DIR = path.join(os.tmpdir(), "nutterx-pnpm-store");

let _pythonPath: string | null = null;
function getPythonPath(): Promise<string> {
  if (_pythonPath !== null) return Promise.resolve(_pythonPath);
  return new Promise((resolve) => {
    exec("which python3 || which python", (err, stdout) => {
      _pythonPath = err ? "" : stdout.trim();
      resolve(_pythonPath);
    });
  });
}

interface RunningProcess {
  process: ChildProcess;
  appId: string;
  restartCount: number;
  stopped: boolean;
}

const processes = new Map<string, RunningProcess>();
const buildProcs = new Map<string, ChildProcess>();
const stopRequested = new Set<string>();
const installingApps = new Set<string>();

const NPM_GLOBAL_BIN = (() => {
  try {
    return execSync("npm root -g", { encoding: "utf8" }).trim().replace(/node_modules$/, "bin");
  } catch {
    return "";
  }
})();

function getAppDir(slug: string): string {
  if (!existsSync(APPS_DIR)) mkdirSync(APPS_DIR, { recursive: true });
  return path.join(APPS_DIR, slug);
}

function removeDir(dir: string): Promise<void> {
  return new Promise((resolve) => { rm(dir, { recursive: true, force: true }, () => resolve()); });
}

const PORT_RANGE_START = 4000;
const PORT_RANGE_END   = 5999;

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => { s.close(() => resolve(true)); });
    s.listen(port, "0.0.0.0");
  });
}

async function findFreePort(): Promise<number> {
  for (let p = PORT_RANGE_START; p <= PORT_RANGE_END; p++) {
    if (await isPortFree(p)) return p;
  }
  throw new Error(`No free port found in range ${PORT_RANGE_START}–${PORT_RANGE_END}`);
}

function killPort(port: number): Promise<void> {
  return new Promise((resolve) => {
    exec(`fuser -k ${port}/tcp 2>/dev/null; true`, () => resolve());
  });
}

async function writeLog(appId: string, line: string, stream: "stdout" | "stderr" | "system") {
  const timestamp = new Date();
  logBus.emit(appId, { line, stream, timestamp } satisfies LogEvent);
  try {
    await connectDb();
    await db.insert(logs).values({ appId, line, stream, timestamp });
    // Trim old logs: keep at most 500 per app (fire-and-forget)
    db.execute(
      sql`DELETE FROM logs WHERE app_id = ${appId} AND id NOT IN (SELECT id FROM logs WHERE app_id = ${appId} ORDER BY timestamp DESC LIMIT 500)`
    ).catch(() => {});
  } catch {}
}

export type AppStatus = "idle" | "installing" | "running" | "stopped" | "crashed" | "error";

async function setStatus(appId: string, status: AppStatus, errorMessage?: string) {
  await connectDb();
  const update: Record<string, unknown> = { status, updatedAt: new Date() };
  if (errorMessage !== undefined) update.errorMessage = errorMessage;
  if (status === "running") update.lastDeployedAt = new Date();
  await db.update(apps).set(update as any).where(eq(apps.id, appId));
}

function detectPackageManager(appDir: string): string {
  if (existsSync(path.join(appDir, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(path.join(appDir, "yarn.lock"))) return "yarn";
  return "npm";
}

function emitLines(appId: string, chunk: Buffer, stream: "stdout" | "stderr" | "system") {
  const lines = chunk.toString().split(/\r?\n|\r/).filter((l) => l.trim());
  for (const line of lines) writeLog(appId, line, stream).catch(() => {});
}

async function runCommand(cmd: string, args: string[], cwd: string, appId: string, env?: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    if (stopRequested.has(appId)) { reject(new Error("Build cancelled by user")); return; }
    const proc = spawn(cmd, args, { cwd, env: env ?? process.env, shell: true });
    buildProcs.set(appId, proc);
    proc.stdout?.on("data", (d: Buffer) => emitLines(appId, d, "system"));
    proc.stderr?.on("data", (d: Buffer) => emitLines(appId, d, "stderr"));
    proc.on("close", (code) => {
      buildProcs.delete(appId);
      if (code === 0) resolve();
      else if (code === null && stopRequested.has(appId)) reject(new Error("Build cancelled by user"));
      else reject(new Error(`Process exited with code ${code}`));
    });
    proc.on("error", (err) => { buildProcs.delete(appId); reject(err); });
  });
}

function checkAbort(appId: string): boolean {
  return stopRequested.has(appId);
}

export async function startApp(appId: string): Promise<void> {
  await connectDb();
  const [app] = await db.select().from(apps).where(eq(apps.id, appId)).limit(1);
  if (!app) throw new Error("App not found");

  if (processes.has(appId)) throw new Error("App is already running");
  if (installingApps.has(appId)) throw new Error("App is already installing");

  stopRequested.delete(appId);
  installingApps.add(appId);
  await setStatus(appId, "installing");
  await writeLog(appId, `Starting deployment for ${app.name}...`, "system");

  const appDir = getAppDir(app.slug);
  await removeDir(appDir);

  try {
    if (checkAbort(appId)) throw new Error("Build cancelled by user");

    const cloneUrl = app.pat
      ? app.repoUrl.replace("https://", `https://${app.pat}@`)
      : app.repoUrl;
    const branch = app.branch || "main";
    await writeLog(appId, `Cloning repository: ${app.repoUrl} (branch: ${branch})`, "system");
    await runCommand("git", ["clone", "--depth", "1", "--branch", branch, "--single-branch", cloneUrl, appDir], os.homedir(), appId);

    if (checkAbort(appId)) throw new Error("Build cancelled by user");

    const pm = detectPackageManager(appDir);
    const hasPackageLock = existsSync(path.join(appDir, "package-lock.json"));
    const hasPnpmLock    = existsSync(path.join(appDir, "pnpm-lock.yaml"));
    const hasYarnLock    = existsSync(path.join(appDir, "yarn.lock"));

    // Default: use ci/frozen-lockfile variant when lockfile is present (much faster)
    let installCmd = app.installCommand || (
      pm === "pnpm" ? "pnpm install" :
      pm === "yarn" ? "yarn install"  :
      hasPackageLock ? "npm ci" : "npm install"
    );

    if (/^\s*npm\s+ci(\s|$)/.test(installCmd)) {
      if (!/--ignore-scripts/.test(installCmd))  installCmd += " --ignore-scripts";
      if (!/--no-audit/.test(installCmd))        installCmd += " --no-audit";
      if (!/--no-fund/.test(installCmd))         installCmd += " --no-fund";
      if (!/--cache/.test(installCmd))           installCmd += ` --cache ${NPM_CACHE_DIR}`;
    } else if (/^\s*npm(\s|$)/.test(installCmd)) {
      if (!/--ignore-platform/.test(installCmd)) installCmd += " --ignore-platform";
      if (!/--no-audit/.test(installCmd))        installCmd += " --no-audit";
      if (!/--no-fund/.test(installCmd))         installCmd += " --no-fund";
      if (!/--prefer-offline/.test(installCmd))  installCmd += " --prefer-offline";
      if (!/--cache/.test(installCmd))           installCmd += ` --cache ${NPM_CACHE_DIR}`;
    } else if (/^\s*pnpm(\s|$)/.test(installCmd)) {
      if (!/--ignore-platform/.test(installCmd))  installCmd += " --ignore-platform";
      if (!/--store-dir/.test(installCmd))        installCmd += ` --store-dir ${PNPM_STORE_DIR}`;
      if (hasPnpmLock && !/--frozen-lockfile/.test(installCmd)) installCmd += " --frozen-lockfile";
      if (!hasPnpmLock && !/--prefer-offline/.test(installCmd)) installCmd += " --prefer-offline";
    } else if (/^\s*yarn(\s|$)/.test(installCmd)) {
      if (hasYarnLock && !/--frozen-lockfile/.test(installCmd)) installCmd += " --frozen-lockfile";
      if (!hasYarnLock && !/--prefer-offline/.test(installCmd)) installCmd += " --prefer-offline";
    }

    const pythonPath = await getPythonPath();
    const installEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      npm_config_ignore_platform: "true",
      PNPM_IGNORE_PLATFORM: "true",
      npm_config_audit: "false",
      npm_config_fund: "false",
      npm_config_prefer_offline: "true",
      ...(pythonPath ? { npm_config_python: pythonPath, PYTHON: pythonPath } : {}),
      ...(NPM_GLOBAL_BIN ? { PATH: `${NPM_GLOBAL_BIN}:${process.env.PATH ?? ""}` } : {}),
    };

    const [installBin, ...installArgs] = installCmd.split(" ");
    await writeLog(appId, `Installing dependencies with: ${installCmd}`, "system");
    try {
      await runCommand(installBin, installArgs, appDir, appId, installEnv);
    } catch (installErr) {
      const errMsg = installErr instanceof Error ? installErr.message : String(installErr);
      await writeLog(appId, `Dependency install failed: ${errMsg}`, "stderr");
      await writeLog(appId, `Retrying without native module compilation (--ignore-scripts)...`, "system");
      const fallbackArgs = [...installArgs, "--ignore-scripts"];
      await runCommand(installBin, fallbackArgs, appDir, appId, installEnv);
      await writeLog(appId, `Dependencies installed without native modules. Some features may use JS fallbacks.`, "system");
    }

    if (checkAbort(appId)) throw new Error("Build cancelled by user");

    // Assign a port: use the one saved on the app, or find a new free one
    let assignedPort = app.port ?? 0;
    if (!assignedPort) {
      assignedPort = await findFreePort();
      // Persist so restarts reuse the same port
      await db.update(apps).set({ port: assignedPort, updatedAt: new Date() }).where(eq(apps.id, appId));
    }
    // Clear any stale process holding this port
    await killPort(assignedPort);
    await writeLog(appId, `Assigned port: ${assignedPort}`, "system");

    const envVars: Record<string, string> = { ...process.env } as Record<string, string>;
    if (NPM_GLOBAL_BIN) envVars["PATH"] = `${NPM_GLOBAL_BIN}:${envVars["PATH"] ?? ""}`;
    for (const envVar of (app.envVars ?? [])) {
      try { envVars[envVar.key] = decrypt(envVar.value); }
      catch { envVars[envVar.key] = envVar.value; }
    }
    // Always inject PORT — overrides anything in app envVars or process.env
    envVars["PORT"] = String(assignedPort);

    let startCmd = app.startCommand;
    if (!startCmd) {
      startCmd = existsSync(path.join(appDir, "package.json")) ? `${pm} start` : "node index.js";
    }

    const pm2SimpleMatch = startCmd.trim().match(/^pm2\s+start\s+([\w./\\-]+(?:\.[cm]?js)?)\s*(.*)/i);
    if (pm2SimpleMatch) {
      const script = pm2SimpleMatch[1];
      if (!script.includes("config.js") && !script.includes("ecosystem")) {
        const oldCmd = startCmd;
        startCmd = `node ${script}`;
        await writeLog(appId, `Converted "${oldCmd}" → "${startCmd}" for proper process control`, "system");
      }
    }

    const [startBin, ...startArgs] = startCmd.split(" ");
    await writeLog(appId, `Starting app with: ${startCmd}`, "system");

    // Mark running in DB before spawning. Retry once on transient DB failure.
    installingApps.delete(appId);
    try {
      await setStatus(appId, "running");
    } catch {
      await new Promise<void>((r) => setTimeout(r, 1500));
      await setStatus(appId, "running");
    }

    const proc = spawn(startBin, startArgs, { cwd: appDir, env: envVars, shell: true });
    const entry: RunningProcess = { process: proc, appId, restartCount: 0, stopped: false };
    processes.set(appId, entry);

    proc.stdout?.on("data", (d: Buffer) => { writeLog(appId, d.toString().trimEnd(), "stdout").catch(() => {}); });
    proc.stderr?.on("data", (d: Buffer) => { writeLog(appId, d.toString().trimEnd(), "stderr").catch(() => {}); });

    proc.on("close", async (code) => {
      const current = processes.get(appId);
      if (!current || current.stopped) {
        await setStatus(appId, "stopped");
        await writeLog(appId, `App stopped (exit code: ${code})`, "system");
        processes.delete(appId);
        return;
      }

      await writeLog(appId, `App crashed (exit code: ${code})`, "system");

      const [freshApp] = await db.select({ autoRestart: apps.autoRestart }).from(apps).where(eq(apps.id, appId)).limit(1);
      if (freshApp?.autoRestart && current.restartCount < 5) {
        current.restartCount++;
        await writeLog(appId, `Auto-restarting (attempt ${current.restartCount}/5)...`, "system");
        processes.delete(appId);
        setTimeout(() => {
          startApp(appId).catch(async (e) => {
            await writeLog(appId, `Auto-restart failed: ${e.message}`, "system");
            await setStatus(appId, "crashed");
          });
        }, 2000 * current.restartCount);
      } else {
        processes.delete(appId);
        await setStatus(appId, "crashed");
      }
    });

    proc.on("error", async (err) => {
      await writeLog(appId, `Process error: ${err.message}`, "system");
      await setStatus(appId, "error", err.message);
      processes.delete(appId);
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isCancelled = message === "Build cancelled by user";
    stopRequested.delete(appId);
    installingApps.delete(appId);
    buildProcs.delete(appId);
    if (isCancelled) {
      await writeLog(appId, "Deployment cancelled by user.", "system");
      await setStatus(appId, "stopped");
    } else {
      await writeLog(appId, `Deployment failed: ${message}`, "system");
      await setStatus(appId, "error", message);
      throw err;
    }
  }
}

export async function stopApp(appId: string): Promise<void> {
  stopRequested.add(appId);
  installingApps.delete(appId);

  const buildProc = buildProcs.get(appId);
  if (buildProc && !buildProc.killed) {
    buildProc.kill("SIGTERM");
    setTimeout(() => { if (!buildProc.killed) buildProc.kill("SIGKILL"); }, 3000);
    buildProcs.delete(appId);
  }

  const entry = processes.get(appId);
  if (!entry) {
    if (!buildProc) await setStatus(appId, "stopped");
    return;
  }

  entry.stopped = true;
  entry.process.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    setTimeout(() => { if (!entry.process.killed) entry.process.kill("SIGKILL"); resolve(); }, 5000);
  });
  processes.delete(appId);
  await setStatus(appId, "stopped");
  await writeLog(appId, "App stopped by user", "system");
}

export async function restartApp(appId: string): Promise<void> {
  if (processes.has(appId) || buildProcs.has(appId)) {
    await stopApp(appId);
    await new Promise<void>((r) => setTimeout(r, 500));
  }
  await startApp(appId);
}

export function getProcessStatus(appId: string): boolean {
  return processes.has(appId);
}

export async function recoverApps(): Promise<void> {
  try {
    await connectDb();
    const staleApps = await db.select().from(apps).where(or(eq(apps.status, "running"), eq(apps.status, "installing")));
    if (staleApps.length === 0) return;

    await db.update(apps)
      .set({ status: "stopped", updatedAt: new Date() })
      .where(or(eq(apps.status, "running"), eq(apps.status, "installing")));

    console.info(`[recovery] Restarting ${staleApps.length} app(s) from previous session…`);

    for (let i = 0; i < staleApps.length; i++) {
      const app = staleApps[i];
      const delay = i * 3000;
      setTimeout(() => {
        startApp(app.id).catch((err: Error) => {
          console.error(`[recovery] Failed to restart ${app.slug}: ${err.message}`);
        });
      }, delay);
    }
  } catch (err) {
    console.error("[recovery] Error during app recovery:", err);
  }
}
