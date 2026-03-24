import { spawn, execSync, type ChildProcess } from "child_process";
import { existsSync, mkdirSync } from "fs";
import path from "path";
import os from "os";
import { EventEmitter } from "events";
import { connectMongo, App, Log, type AppStatus } from "@workspace/mongo";
import mongoose from "mongoose";
import { decrypt } from "../lib/crypto.js";

// ---------------------------------------------------------------------------
// In-memory log bus — instant delivery to SSE clients, no MongoDB polling
// ---------------------------------------------------------------------------
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

// Allow overriding via env so persistent disks (Render, Railway, etc.) can be mounted
const APPS_DIR = process.env.APPS_DIR ?? path.join(os.homedir(), ".nutterx-apps");

// Shared package manager caches — survive across deploys within the same server
// session, so packages only get downloaded once per process lifetime.
const NPM_CACHE_DIR = path.join(os.tmpdir(), "nutterx-npm-cache");
const PNPM_STORE_DIR = path.join(os.tmpdir(), "nutterx-pnpm-store");

interface RunningProcess {
  process: ChildProcess;
  appId: string;
  restartCount: number;
  stopped: boolean;
}

// Running app processes (post-deploy)
const processes = new Map<string, RunningProcess>();

// Build-phase subprocesses (git clone / npm install) — tracked for cancellation
const buildProcs = new Map<string, ChildProcess>();

// Apps for which Stop was requested — checked at every build stage boundary
const stopRequested = new Set<string>();

// Path to globally-installed npm binaries (pm2, nodemon, etc.)
const NPM_GLOBAL_BIN = (() => {
  try {
    return execSync("npm root -g", { encoding: "utf8" }).trim().replace(/node_modules$/, "bin");
  } catch {
    return "";
  }
})();

function getAppDir(slug: string): string {
  if (!existsSync(APPS_DIR)) {
    mkdirSync(APPS_DIR, { recursive: true });
  }
  return path.join(APPS_DIR, slug);
}

/** Reliably delete a directory tree. Uses shell rm -rf to avoid Node fs.rm race conditions. */
function removeDir(dir: string): void {
  try {
    execSync(`rm -rf ${JSON.stringify(dir)}`, { stdio: "ignore" });
  } catch {
    // ignore — directory may not exist
  }
}

async function writeLog(appId: string, line: string, stream: "stdout" | "stderr" | "system") {
  const timestamp = new Date();
  logBus.emit(appId, { line, stream, timestamp } satisfies LogEvent);
  try {
    await connectMongo();
    const col = mongoose.connection.db?.collection("logs");
    if (col) {
      await col.insertOne({
        appId: new mongoose.Types.ObjectId(appId),
        line,
        stream,
        timestamp,
      });
    }
  } catch {
  }
}

async function setStatus(appId: string, status: AppStatus, errorMessage?: string) {
  await connectMongo();
  const update: Record<string, unknown> = { status };
  if (errorMessage !== undefined) update.errorMessage = errorMessage;
  if (status === "running") update.lastDeployedAt = new Date();
  await App.findByIdAndUpdate(appId, update);
}

function detectPackageManager(appDir: string): string {
  if (existsSync(path.join(appDir, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(path.join(appDir, "yarn.lock"))) return "yarn";
  return "npm";
}

function emitLines(appId: string, chunk: Buffer, stream: "stdout" | "stderr" | "system") {
  const lines = chunk.toString().split(/\r?\n|\r/).filter((l) => l.trim());
  for (const line of lines) {
    writeLog(appId, line, stream).catch(() => {});
  }
}

/**
 * Run a shell command, tracking the subprocess in buildProcs so it can be
 * killed if Stop is requested mid-build.  Resolves on exit code 0, rejects
 * otherwise (including if the process is killed by Stop).
 */
async function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
  appId: string,
  env?: Record<string, string>
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Honour a stop request that arrived before this command started
    if (stopRequested.has(appId)) {
      reject(new Error("Build cancelled by user"));
      return;
    }

    const proc = spawn(cmd, args, { cwd, env: env ?? process.env, shell: true });
    buildProcs.set(appId, proc);

    proc.stdout?.on("data", (d: Buffer) => emitLines(appId, d, "system"));
    proc.stderr?.on("data", (d: Buffer) => emitLines(appId, d, "stderr"));

    proc.on("close", (code) => {
      buildProcs.delete(appId);
      // null = killed by signal (stop requested) — treat as cancelled
      if (code === 0) resolve();
      else if (code === null && stopRequested.has(appId)) reject(new Error("Build cancelled by user"));
      else reject(new Error(`Process exited with code ${code}`));
    });

    proc.on("error", (err) => {
      buildProcs.delete(appId);
      reject(err);
    });
  });
}

/** Check if a stop was requested for this app at a stage boundary. */
function checkAbort(appId: string): boolean {
  return stopRequested.has(appId);
}

export async function startApp(appId: string): Promise<void> {
  await connectMongo();
  const app = await App.findById(appId);
  if (!app) throw new Error("App not found");

  if (processes.has(appId)) {
    throw new Error("App is already running");
  }

  // Clear any stale stop flag from a previous cycle
  stopRequested.delete(appId);

  await setStatus(appId, "installing");
  await writeLog(appId, `Starting deployment for ${app.name}...`, "system");

  const appDir = getAppDir(app.slug);

  removeDir(appDir);

  try {
    // ── Stage: clone ───────────────────────────────────────────────────────
    if (checkAbort(appId)) throw new Error("Build cancelled by user");

    const cloneUrl = app.pat
      ? app.repoUrl.replace("https://", `https://${app.pat}@`)
      : app.repoUrl;

    const branch = app.branch || "main";
    await writeLog(appId, `Cloning repository: ${app.repoUrl} (branch: ${branch})`, "system");
    await runCommand("git", ["clone", "--progress", "--branch", branch, "--single-branch", cloneUrl, appDir], os.homedir(), appId);

    // ── Stage: install ────────────────────────────────────────────────────
    if (checkAbort(appId)) throw new Error("Build cancelled by user");

    const pm = detectPackageManager(appDir);
    let installCmd = app.installCommand || `${pm} install`;

    // Inject speed flags based on which package manager is being used.
    // These skip slow network round-trips (audit/fund) and reuse a shared
    // cache so packages downloaded for one app benefit all subsequent apps.
    if (/^\s*npm(\s|$)/.test(installCmd)) {
      if (!/--ignore-platform/.test(installCmd)) installCmd += " --ignore-platform";
      if (!/--no-audit/.test(installCmd))        installCmd += " --no-audit";
      if (!/--no-fund/.test(installCmd))         installCmd += " --no-fund";
      if (!/--prefer-offline/.test(installCmd))  installCmd += " --prefer-offline";
      if (!/--cache/.test(installCmd))           installCmd += ` --cache ${NPM_CACHE_DIR}`;
    } else if (/^\s*pnpm(\s|$)/.test(installCmd)) {
      if (!/--ignore-platform/.test(installCmd))  installCmd += " --ignore-platform";
      if (!/--store-dir/.test(installCmd))        installCmd += ` --store-dir ${PNPM_STORE_DIR}`;
      if (!/--prefer-offline/.test(installCmd))   installCmd += " --prefer-offline";
    } else if (/^\s*yarn(\s|$)/.test(installCmd)) {
      if (!/--prefer-offline/.test(installCmd))   installCmd += " --prefer-offline";
    }

    // Locate python3 for node-gyp (native module compilation)
    let pythonPath = "";
    try {
      pythonPath = execSync("which python3 || which python", { encoding: "utf8" }).trim();
    } catch {}

    const installEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      npm_config_ignore_platform: "true",
      PNPM_IGNORE_PLATFORM: "true",
      // Disable npm audit/fund globally in env too (catches sub-processes)
      npm_config_audit: "false",
      npm_config_fund: "false",
      npm_config_prefer_offline: "true",
      // Help node-gyp find Python for native module compilation
      ...(pythonPath ? { npm_config_python: pythonPath, PYTHON: pythonPath } : {}),
      // Make globally-installed npm packages (pm2, nodemon, etc.) available
      ...(NPM_GLOBAL_BIN ? { PATH: `${NPM_GLOBAL_BIN}:${process.env.PATH ?? ""}` } : {}),
    };

    const [installBin, ...installArgs] = installCmd.split(" ");

    await writeLog(appId, `Installing dependencies with: ${installCmd}`, "system");
    try {
      await runCommand(installBin, installArgs, appDir, appId, installEnv);
    } catch (installErr) {
      // Native module compilation can fail (e.g. no pre-built binary for this Node ABI).
      // Retry with --ignore-scripts so the app can still be deployed without native addons.
      const errMsg = installErr instanceof Error ? installErr.message : String(installErr);
      await writeLog(appId, `Dependency install failed: ${errMsg}`, "stderr");
      await writeLog(appId, `Retrying without native module compilation (--ignore-scripts)...`, "system");
      const fallbackArgs = [...installArgs, "--ignore-scripts"];
      await runCommand(installBin, fallbackArgs, appDir, appId, installEnv);
      await writeLog(appId, `Dependencies installed without native modules. Some features may use JS fallbacks.`, "system");
    }

    // ── Stage: start ──────────────────────────────────────────────────────
    if (checkAbort(appId)) throw new Error("Build cancelled by user");

    const envVars: Record<string, string> = { ...process.env } as Record<string, string>;
    // Remove PORT inherited from the platform process — deployed apps must not
    // compete with the API server on the same port.  They may set their own
    // PORT via envVars below, or fall back to their own default (e.g. 3000).
    delete envVars["PORT"];
    // Make globally-installed npm packages (pm2, nodemon, tsx, etc.) available
    if (NPM_GLOBAL_BIN) {
      envVars["PATH"] = `${NPM_GLOBAL_BIN}:${envVars["PATH"] ?? ""}`;
    }
    for (const envVar of app.envVars) {
      try {
        envVars[envVar.key] = decrypt(envVar.value);
      } catch {
        envVars[envVar.key] = envVar.value;
      }
    }
    if (app.port) envVars["PORT"] = String(app.port);

    let startCmd = app.startCommand;
    if (!startCmd) {
      if (existsSync(path.join(appDir, "package.json"))) {
        startCmd = `${pm} start`;
      } else {
        startCmd = "node index.js";
      }
    }

    // Intercept "pm2 start <script>" commands — pm2's --attach mode causes the
    // actual app to survive SIGTERM (it daemonises), so our stop/restart won't
    // work correctly.  Convert simple pm2 start commands to direct node execution.
    const pm2SimpleMatch = startCmd.trim().match(
      /^pm2\s+start\s+([\w./\\-]+(?:\.[cm]?js)?)\s*(.*)/i
    );
    if (pm2SimpleMatch) {
      const script = pm2SimpleMatch[1];
      // Only redirect scripts — ecosystem config files (*.config.js) stay as-is
      if (!script.includes("config.js") && !script.includes("ecosystem")) {
        const oldCmd = startCmd;
        startCmd = `node ${script}`;
        await writeLog(appId, `Converted "${oldCmd}" → "${startCmd}" for proper process control`, "system");
      }
    }

    const [startBin, ...startArgs] = startCmd.split(" ");

    await writeLog(appId, `Starting app with: ${startCmd}`, "system");
    await setStatus(appId, "running");

    const proc = spawn(startBin, startArgs, {
      cwd: appDir,
      env: envVars,
      shell: true,
    });

    const entry: RunningProcess = { process: proc, appId, restartCount: 0, stopped: false };
    processes.set(appId, entry);

    proc.stdout?.on("data", (d: Buffer) => {
      writeLog(appId, d.toString().trimEnd(), "stdout").catch(() => {});
    });
    proc.stderr?.on("data", (d: Buffer) => {
      writeLog(appId, d.toString().trimEnd(), "stderr").catch(() => {});
    });

    proc.on("close", async (code) => {
      const current = processes.get(appId);
      if (!current || current.stopped) {
        await setStatus(appId, "stopped");
        await writeLog(appId, `App stopped (exit code: ${code})`, "system");
        processes.delete(appId);
        return;
      }

      await writeLog(appId, `App crashed (exit code: ${code})`, "system");

      const freshApp = await App.findById(appId);
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
  // Signal any ongoing build to abort at the next stage check
  stopRequested.add(appId);

  // Kill any currently running build subprocess immediately
  const buildProc = buildProcs.get(appId);
  if (buildProc && !buildProc.killed) {
    buildProc.kill("SIGTERM");
    setTimeout(() => {
      if (!buildProc.killed) buildProc.kill("SIGKILL");
    }, 3000);
    buildProcs.delete(appId);
  }

  // Kill the running app process if there is one
  const entry = processes.get(appId);
  if (!entry) {
    // No running process — if no build was active either, just set stopped
    if (!buildProc) {
      await setStatus(appId, "stopped");
    }
    return;
  }

  entry.stopped = true;
  entry.process.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    setTimeout(() => {
      if (!entry.process.killed) {
        entry.process.kill("SIGKILL");
      }
      resolve();
    }, 5000);
  });
  processes.delete(appId);
  await setStatus(appId, "stopped");
  await writeLog(appId, "App stopped by user", "system");
}

export async function restartApp(appId: string): Promise<void> {
  if (processes.has(appId) || buildProcs.has(appId)) {
    await stopApp(appId);
    // Brief pause to let cleanup settle
    await new Promise<void>((r) => setTimeout(r, 500));
  }
  await startApp(appId);
}

export function getProcessStatus(appId: string): boolean {
  return processes.has(appId);
}

/**
 * Called once at server startup.
 * Finds every app that was "running" or "installing" (mid-deploy) when the
 * server last exited and re-deploys them so they come back to life automatically.
 */
export async function recoverApps(): Promise<void> {
  try {
    await connectMongo();
    const staleApps = await App.find({ status: { $in: ["running", "installing"] } }).lean();
    if (staleApps.length === 0) return;

    // Reset their status to stopped — startApp will set it correctly as it runs
    await App.updateMany(
      { status: { $in: ["running", "installing"] } },
      { $set: { status: "stopped" } }
    );

    console.info(`[recovery] Restarting ${staleApps.length} app(s) from previous session…`);

    // Stagger restarts by 3 s so we don't hammer GitHub/npm all at once
    for (let i = 0; i < staleApps.length; i++) {
      const app = staleApps[i];
      const delay = i * 3000;
      setTimeout(() => {
        startApp(app._id.toString()).catch((err: Error) => {
          console.error(`[recovery] Failed to restart ${app.slug}: ${err.message}`);
        });
      }, delay);
    }
  } catch (err) {
    // Don't crash the server if recovery fails
    console.error("[recovery] Error during app recovery:", err);
  }
}
