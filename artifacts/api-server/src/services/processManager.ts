import { spawn, type ChildProcess } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { rm } from "fs/promises";
import path from "path";
import os from "os";
import { connectMongo, App, Log, type AppStatus } from "@workspace/mongo";
import mongoose from "mongoose";
import { decrypt } from "../lib/crypto.js";

const APPS_DIR = path.join(os.homedir(), ".nutterx-apps");

interface RunningProcess {
  process: ChildProcess;
  appId: string;
  restartCount: number;
  stopped: boolean;
}

const processes = new Map<string, RunningProcess>();

function getAppDir(slug: string): string {
  if (!existsSync(APPS_DIR)) {
    mkdirSync(APPS_DIR, { recursive: true });
  }
  return path.join(APPS_DIR, slug);
}

async function writeLog(appId: string, line: string, stream: "stdout" | "stderr" | "system") {
  try {
    await connectMongo();
    const col = mongoose.connection.db?.collection("logs");
    if (col) {
      await col.insertOne({
        appId: new mongoose.Types.ObjectId(appId),
        line,
        stream,
        timestamp: new Date(),
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

async function runCommand(cmd: string, args: string[], cwd: string, appId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, env: process.env, shell: true });
    proc.stdout?.on("data", (d: Buffer) => {
      writeLog(appId, d.toString().trim(), "system").catch(() => {});
    });
    proc.stderr?.on("data", (d: Buffer) => {
      writeLog(appId, d.toString().trim(), "stderr").catch(() => {});
    });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Process exited with code ${code}`));
    });
    proc.on("error", reject);
  });
}

export async function startApp(appId: string): Promise<void> {
  await connectMongo();
  const app = await App.findById(appId);
  if (!app) throw new Error("App not found");

  if (processes.has(appId)) {
    throw new Error("App is already running");
  }

  await setStatus(appId, "installing");
  await writeLog(appId, `Starting deployment for ${app.name}...`, "system");

  const appDir = getAppDir(app.slug);

  if (existsSync(appDir)) {
    await rm(appDir, { recursive: true, force: true });
  }

  try {
    const cloneUrl = app.pat
      ? app.repoUrl.replace("https://", `https://${app.pat}@`)
      : app.repoUrl;

    await writeLog(appId, `Cloning repository: ${app.repoUrl}`, "system");
    await runCommand("git", ["clone", cloneUrl, appDir], os.homedir(), appId);

    const pm = detectPackageManager(appDir);
    const installCmd = app.installCommand || `${pm} install`;
    const [installBin, ...installArgs] = installCmd.split(" ");

    await writeLog(appId, `Installing dependencies with: ${installCmd}`, "system");
    await runCommand(installBin, installArgs, appDir, appId);

    const envVars: Record<string, string> = { ...process.env } as Record<string, string>;
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
    await writeLog(appId, `Deployment failed: ${message}`, "system");
    await setStatus(appId, "error", message);
    throw err;
  }
}

export async function stopApp(appId: string): Promise<void> {
  const entry = processes.get(appId);
  if (!entry) {
    await setStatus(appId, "stopped");
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
  if (processes.has(appId)) {
    await stopApp(appId);
  }
  await startApp(appId);
}

export function getProcessStatus(appId: string): boolean {
  return processes.has(appId);
}

export function streamLogs(appId: string, onLine: (line: string, stream: string, timestamp: Date) => void): () => void {
  let active = true;
  let changeStream: mongoose.mongo.ChangeStream | null = null;

  const setup = async () => {
    await connectMongo();
    const col = mongoose.connection.db?.collection("logs");
    if (!col) return;

    try {
      changeStream = col.watch([
        { $match: { "fullDocument.appId": new mongoose.Types.ObjectId(appId) } },
      ], { fullDocument: "updateLookup" }) as unknown as mongoose.mongo.ChangeStream;

      changeStream.on("change", (change: Record<string, unknown>) => {
        if (!active) return;
        if (change.operationType === "insert" && change.fullDocument) {
          const doc = change.fullDocument as Record<string, unknown>;
          onLine(doc.line as string, doc.stream as string, doc.timestamp as Date);
        }
      });
    } catch {
    }
  };

  setup().catch(() => {});

  return () => {
    active = false;
    if (changeStream) {
      changeStream.close().catch(() => {});
    }
  };
}
