import { spawn, exec, execSync, type ChildProcess } from "child_process";
import { existsSync, mkdirSync, rm } from "fs";
import path from "path";
import os from "os";
import { EventEmitter } from "events";
import { eq, or } from "drizzle-orm";
import { connectDb, db, apps, deployments } from "@workspace/db";
import type { App } from "@workspace/db";
import { decrypt, isEncrypted } from "../lib/crypto.js";

// In-memory log ring buffer — no DB writes for logs.
// Capped at LOG_BUFFER_SIZE lines per app so memory stays bounded.
const LOG_BUFFER_SIZE = 500;
const logBuffers = new Map<string, LogEvent[]>();

export function getLogBuffer(appId: string): LogEvent[] {
  return logBuffers.get(appId) ?? [];
}

function bufferLog(appId: string, ev: LogEvent) {
  let buf = logBuffers.get(appId);
  if (!buf) { buf = []; logBuffers.set(appId, buf); }
  buf.push(ev);
  if (buf.length > LOG_BUFFER_SIZE) buf.splice(0, buf.length - LOG_BUFFER_SIZE);
}

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

function writeLog(appId: string, line: string, stream: "stdout" | "stderr" | "system") {
  const ev: LogEvent = { line, stream, timestamp: new Date() };
  bufferLog(appId, ev);
  logBus.emit(appId, ev);
}

// Tracks the active deployment record so we can finalize it on success/failure
const activeDeployments = new Map<string, { id: string; startedAt: number }>();

async function createDeploymentRecord(appId: string, branch: string, triggeredBy: string): Promise<void> {
  try {
    const [rec] = await db.insert(deployments).values({ appId, branch, triggeredBy, status: "building" }).returning({ id: deployments.id });
    if (rec) activeDeployments.set(appId, { id: rec.id, startedAt: Date.now() });
  } catch { /* non-fatal — deployment history is best-effort */ }
}

async function finalizeDeploymentRecord(appId: string, status: "success" | "failed" | "cancelled", errorMessage?: string): Promise<void> {
  const entry = activeDeployments.get(appId);
  if (!entry) return;
  activeDeployments.delete(appId);
  try {
    const finishedAt = new Date();
    const durationMs = Date.now() - entry.startedAt;
    await db.update(deployments).set({
      status,
      finishedAt,
      durationMs,
      errorMessage: errorMessage ?? null,
    }).where(eq(deployments.id, entry.id));
  } catch { /* non-fatal */ }
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
  for (const line of lines) writeLog(appId, line, stream);
}

async function runCommand(
  cmd: string, args: string[], cwd: string, appId: string,
  env?: Record<string, string>, timeoutMs = 10 * 60 * 1000,
  heartbeatIntervalMs?: number,
): Promise<{ timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    if (stopRequested.has(appId)) { reject(new Error("Build cancelled by user")); return; }
    const proc = spawn(cmd, args, { cwd, env: env ?? process.env, shell: true });
    buildProcs.set(appId, proc);
    proc.stdout?.on("data", (d: Buffer) => emitLines(appId, d, "system"));
    proc.stderr?.on("data", (d: Buffer) => emitLines(appId, d, "stderr"));

    let timedOut = false;
    const startMs = Date.now();

    // Optional heartbeat: print "still running..." every N seconds so log stream
    // doesn't appear frozen during long silent downloads.
    const heartbeat = heartbeatIntervalMs
      ? setInterval(() => {
          const elapsed = Math.round((Date.now() - startMs) / 1000);
          writeLog(appId, `  ⏳ Still installing… (${elapsed}s elapsed)`, "system");
        }, heartbeatIntervalMs)
      : null;

    const timer = setTimeout(() => {
      timedOut = true;
      if (heartbeat) clearInterval(heartbeat);
      proc.kill("SIGKILL");
      buildProcs.delete(appId);
      reject(Object.assign(new Error(`Command timed out after ${Math.round(timeoutMs / 60000)} minutes: ${cmd} ${args.join(" ")}`), { timedOut: true }));
    }, timeoutMs);

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (heartbeat) clearInterval(heartbeat);
      buildProcs.delete(appId);
      if (code === 0) resolve({ timedOut: false });
      else if (code === null && stopRequested.has(appId)) reject(new Error("Build cancelled by user"));
      else reject(new Error(`Process exited with code ${code}`));
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      if (heartbeat) clearInterval(heartbeat);
      buildProcs.delete(appId);
      reject(err);
    });
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
  logBuffers.delete(appId); // fresh buffer for new deploy
  await setStatus(appId, "installing");
  writeLog(appId, `Starting deployment for ${app.name}...`, "system");

  const branch = app.branch || "main";
  await createDeploymentRecord(appId, branch, "user");

  const appDir = getAppDir(app.slug);

  try {
    if (checkAbort(appId)) throw new Error("Build cancelled by user");

    const cloneUrl = app.pat
      ? app.repoUrl.replace("https://", `https://${app.pat}@`)
      : app.repoUrl;

    // Always do a fresh clone — avoids stale .git state causing git fetch to
    // hang for minutes before timing out. The shared npm cache (~/.nutterx-npm-cache)
    // is the real speed win: packages only download from the internet once.
    writeLog(appId, `Cloning repository: ${app.repoUrl} (branch: ${branch})`, "system");
    await removeDir(appDir);
    await runCommand("git", ["clone", "--depth", "1", "--branch", branch, "--single-branch", cloneUrl, appDir], os.homedir(), appId, undefined, 3 * 60_000);

    // Capture commit hash, then remove git history (not needed at runtime)
    try {
      const commitHash = execSync("git rev-parse HEAD", { cwd: appDir }).toString().trim();
      const deployment = activeDeployments.get(appId);
      if (deployment && commitHash) {
        db.update(deployments).set({ commitHash }).where(eq(deployments.id, deployment.id)).catch(() => {});
      }
    } catch { /* non-fatal */ }
    removeDir(path.join(appDir, ".git")).catch(() => {});

    if (checkAbort(appId)) throw new Error("Build cancelled by user");

    const pm = detectPackageManager(appDir);
    const hasPackageLock = existsSync(path.join(appDir, "package-lock.json"));
    const hasPnpmLock    = existsSync(path.join(appDir, "pnpm-lock.yaml"));
    const hasYarnLock    = existsSync(path.join(appDir, "yarn.lock"));

    // Use npm ci when a lockfile is present (faster, exact installs)
    let installCmd = app.installCommand || (
      pm === "pnpm" ? "pnpm install" :
      pm === "yarn" ? "yarn install"  :
      hasPackageLock ? "npm ci" : "npm install"
    );

    // Append speed flags without overriding anything the user already set.
    // --no-optional skips optionalDependencies (e.g. canvas, sharp in baileys)
    // which are the #1 cause of slow native-compilation stalls on limited servers.
    if (/^\s*npm(\s|$)/.test(installCmd)) {
      if (!/--ignore-platform/.test(installCmd))   installCmd += " --ignore-platform";
      if (!/--no-audit/.test(installCmd))          installCmd += " --no-audit";
      if (!/--no-fund/.test(installCmd))           installCmd += " --no-fund";
      if (!/--prefer-offline/.test(installCmd))    installCmd += " --prefer-offline";
      if (!/--no-optional/.test(installCmd))       installCmd += " --no-optional";
      if (!/--legacy-peer-deps/.test(installCmd))  installCmd += " --legacy-peer-deps";
    } else if (/^\s*pnpm(\s|$)/.test(installCmd)) {
      if (!/--ignore-platform/.test(installCmd))   installCmd += " --ignore-platform";
      if (!/--prefer-offline/.test(installCmd))    installCmd += " --prefer-offline";
      if (hasPnpmLock && !/--frozen-lockfile/.test(installCmd)) installCmd += " --frozen-lockfile";
    } else if (/^\s*yarn(\s|$)/.test(installCmd)) {
      if (!/--prefer-offline/.test(installCmd))    installCmd += " --prefer-offline";
      if (hasYarnLock && !/--frozen-lockfile/.test(installCmd)) installCmd += " --frozen-lockfile";
    }

    // Shared package cache — all apps share one download cache so packages are
    // only fetched from the internet once; every subsequent install is local.
    const npmCacheDir = path.join(os.homedir(), ".nutterx-npm-cache");
    if (!existsSync(npmCacheDir)) mkdirSync(npmCacheDir, { recursive: true });

    const pythonPath = await getPythonPath();
    const installEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      npm_config_ignore_platform: "true",
      PNPM_IGNORE_PLATFORM: "true",
      npm_config_audit: "false",
      npm_config_fund: "false",
      npm_config_cache: npmCacheDir,
      YARN_CACHE_FOLDER: path.join(npmCacheDir, "yarn"),
      PNPM_STORE_DIR: path.join(npmCacheDir, "pnpm-store"),
      ...(pythonPath ? { npm_config_python: pythonPath, PYTHON: pythonPath } : {}),
      ...(NPM_GLOBAL_BIN ? { PATH: `${NPM_GLOBAL_BIN}:${process.env.PATH ?? ""}` } : {}),
    };

    // 15-minute install timeout. Heavy bots (baileys + 500 deps) typically finish
    // in 5-8 min. Heartbeat every 30s so the log stream doesn't look frozen.
    const INSTALL_TIMEOUT    = 15 * 60_000;
    const HEARTBEAT_INTERVAL = 30_000;

    const [installBin, ...installArgs] = installCmd.split(" ");
    writeLog(appId, `Installing dependencies with: ${installCmd}`, "system");
    try {
      await runCommand(installBin, installArgs, appDir, appId, installEnv, INSTALL_TIMEOUT, HEARTBEAT_INTERVAL);
      writeLog(appId, `✅ Dependencies installed successfully.`, "system");
    } catch (installErr) {
      const isTimeout = (installErr as { timedOut?: boolean }).timedOut === true;
      const errMsg = installErr instanceof Error ? installErr.message : String(installErr);

      if (isTimeout) {
        // No point retrying — if 15 min wasn't enough, another 15 won't be.
        // Clean up partially-written node_modules so next deploy starts fresh.
        writeLog(appId, `Install timed out after 15 minutes. Cleaning up for next attempt...`, "stderr");
        await removeDir(path.join(appDir, "node_modules")).catch(() => {});
        throw new Error("Dependency installation timed out after 15 minutes. The app may have too many packages. Try setting a custom install command in the app settings.");
      }

      // Non-timeout failure: retry with npm install (not npm ci — ci is strict about
      // lockfile sync and fails on mismatches; install is lenient) + skip postinstall.
      writeLog(appId, `Install failed: ${errMsg}`, "stderr");
      writeLog(appId, `Retrying with npm install --ignore-scripts...`, "system");
      await removeDir(path.join(appDir, "node_modules")).catch(() => {});

      // Always use "npm install" for the retry regardless of what the first attempt was.
      // Replace "ci" sub-command with "install" so npm stops enforcing lockfile purity.
      const fallbackArgs = installArgs
        .map(a => a === "ci" ? "install" : a)
        .filter(a => a !== "--ignore-scripts");
      fallbackArgs.push("--ignore-scripts");
      await runCommand(installBin, fallbackArgs, appDir, appId, installEnv, INSTALL_TIMEOUT, HEARTBEAT_INTERVAL);
      writeLog(appId, `✅ Dependencies installed (postinstall scripts skipped).`, "system");
    }

    if (checkAbort(appId)) throw new Error("Build cancelled by user");

    const envVars: Record<string, string> = { ...process.env } as Record<string, string>;
    delete envVars["PORT"];
    if (NPM_GLOBAL_BIN) envVars["PATH"] = `${NPM_GLOBAL_BIN}:${envVars["PATH"] ?? ""}`;
    for (const envVar of (app.envVars ?? [])) {
      try {
        envVars[envVar.key] = decrypt(envVar.value);
      } catch {
        // If decryption fails and the value looks like ciphertext, skip it
        // rather than injecting hex garbage into the app's environment.
        if (!isEncrypted(envVar.value)) {
          envVars[envVar.key] = envVar.value; // plaintext stored (no encryption key at save time)
        } else {
          writeLog(appId, `⚠️  Could not decrypt env var "${envVar.key}" — ENCRYPTION_KEY mismatch? Skipping.`, "system");
        }
      }
    }
    if (app.port) envVars["PORT"] = String(app.port);

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
        writeLog(appId, `Converted "${oldCmd}" → "${startCmd}" for proper process control`, "system");
      }
    }

    const [startBin, ...startArgs] = startCmd.split(" ");
    writeLog(appId, `Starting app with: ${startCmd}`, "system");

    // Mark running in DB before spawning. Retry once on transient DB failure.
    installingApps.delete(appId);
    try {
      await setStatus(appId, "running");
    } catch {
      await new Promise<void>((r) => setTimeout(r, 1500));
      await setStatus(appId, "running");
    }
    await finalizeDeploymentRecord(appId, "success");

    const proc = spawn(startBin, startArgs, { cwd: appDir, env: envVars, shell: true });
    const entry: RunningProcess = { process: proc, appId, restartCount: 0, stopped: false };
    processes.set(appId, entry);

    proc.stdout?.on("data", (d: Buffer) => emitLines(appId, d, "stdout"));
    proc.stderr?.on("data", (d: Buffer) => emitLines(appId, d, "stderr"));

    proc.on("close", async (code) => {
      const current = processes.get(appId);
      if (!current || current.stopped) {
        writeLog(appId, `App stopped (exit code: ${code})`, "system");
        processes.delete(appId);
        await setStatus(appId, "stopped");
        return;
      }

      writeLog(appId, `App crashed (exit code: ${code})`, "system");

      const [freshApp] = await db.select({ autoRestart: apps.autoRestart }).from(apps).where(eq(apps.id, appId)).limit(1);
      if (freshApp?.autoRestart && current.restartCount < 5) {
        current.restartCount++;
        writeLog(appId, `Auto-restarting (attempt ${current.restartCount}/5)...`, "system");
        processes.delete(appId);
        setTimeout(() => {
          startApp(appId).catch(async (e) => {
            writeLog(appId, `Auto-restart failed: ${e.message}`, "system");
            await setStatus(appId, "crashed");
          });
        }, 2000 * current.restartCount);
      } else {
        processes.delete(appId);
        await setStatus(appId, "crashed");
      }
    });

    proc.on("error", async (err) => {
      writeLog(appId, `Process error: ${err.message}`, "system");
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
      writeLog(appId, "Deployment cancelled by user.", "system");
      await finalizeDeploymentRecord(appId, "cancelled");
      await setStatus(appId, "stopped");
    } else {
      writeLog(appId, `Deployment failed: ${message}`, "system");
      await finalizeDeploymentRecord(appId, "failed", message);
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
  writeLog(appId, "App stopped by user", "system");
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

export async function deleteAppFiles(slug: string): Promise<void> {
  const appDir = getAppDir(slug);
  await removeDir(appDir);
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
