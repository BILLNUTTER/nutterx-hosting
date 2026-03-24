import { spawn, type ChildProcess } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { rm } from "fs/promises";
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

const APPS_DIR = path.join(os.homedir(), ".nutterx-apps");

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

function getAppDir(slug: string): string {
  if (!existsSync(APPS_DIR)) {
    mkdirSync(APPS_DIR, { recursive: true });
  }
  return path.join(APPS_DIR, slug);
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

  if (existsSync(appDir)) {
    await rm(appDir, { recursive: true, force: true });
  }

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

    if (/^\s*npm\s/.test(installCmd) && !/--ignore-platform/.test(installCmd)) {
      installCmd = installCmd.trim() + " --ignore-platform";
    } else if (/^\s*pnpm\s/.test(installCmd) && !/--ignore-platform/.test(installCmd)) {
      installCmd = installCmd.trim() + " --ignore-platform";
    }

    // Locate python3 for node-gyp (native module compilation)
    let pythonPath = "";
    try {
      const { execSync } = await import("child_process");
      pythonPath = execSync("which python3 || which python", { encoding: "utf8" }).trim();
    } catch {}

    const installEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      npm_config_ignore_platform: "true",
      PNPM_IGNORE_PLATFORM: "true",
      // Help node-gyp find Python for native module compilation
      ...(pythonPath ? { npm_config_python: pythonPath, PYTHON: pythonPath } : {}),
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
