import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import { fileURLToPath } from "url";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";
import { connectDb } from "@workspace/db";
import { startSubscriptionCron } from "./services/subscriptionCron.js";
import { recoverApps } from "./services/processManager.js";

// ── Required environment variable validation ──────────────────────────────────
const REQUIRED_ENV_VARS = [
  { key: "JWT_SECRET",       desc: "JWT signing secret for access tokens" },
  { key: "JWT_REFRESH_SECRET", desc: "JWT signing secret for refresh tokens" },
  { key: "ENCRYPTION_KEY",   desc: "AES-256 key for encrypting app env vars" },
];
const missingVars = REQUIRED_ENV_VARS.filter(({ key }) => !process.env[key]);
if (missingVars.length > 0) {
  const list = missingVars.map(({ key, desc }) => `  • ${key}  (${desc})`).join("\n");
  logger.fatal(`\n\n❌  MISSING REQUIRED ENVIRONMENT VARIABLES — the server cannot start safely.\n\nPlease add these to your Render environment settings:\n\n${list}\n\nSee: Render Dashboard → Your Service → Environment\n`);
  process.exit(1);
}
// ─────────────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// In production, serve the pre-built frontend and let React Router handle client-side routing.
// FRONTEND_DIST can be overridden via env var; the default resolves relative to this compiled file.
if (process.env.NODE_ENV === "production") {
  const frontendDist =
    process.env.FRONTEND_DIST ??
    path.join(__dirname, "../../nutterx-hosting/dist/public");
  app.use(express.static(frontendDist));
  app.get("/*path", (_req, res) => {
    res.sendFile(path.join(frontendDist, "index.html"));
  });
}

connectDb().then(() => {
  logger.info("Connected to PostgreSQL");
  startSubscriptionCron();
  recoverApps().catch((err) => logger.error({ err }, "App recovery failed"));
}).catch((err) => {
  logger.error({ err }, "Failed to connect to PostgreSQL");
});

export default app;
