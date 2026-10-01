import { createHmac } from "node:crypto";

type TokenPurpose = "access" | "refresh";

export function getJwtSigningSecret(purpose: TokenPurpose): string {
  const keyName = purpose === "access" ? "JWT_SECRET" : "JWT_REFRESH_SECRET";
  const configuredSecret = process.env[keyName];
  if (configuredSecret?.trim()) return configuredSecret;

  // Local Replit development already provides SESSION_SECRET. Derive separate
  // stable keys for each JWT purpose without exposing or reusing the seed.
  const sessionSecret = process.env.SESSION_SECRET;
  if (process.env.NODE_ENV !== "production" && sessionSecret?.trim()) {
    return createHmac("sha256", sessionSecret)
      .update(`nutterx-hosting:jwt:${purpose}:v1`)
      .digest("hex");
  }

  throw new Error(`${keyName} environment variable is not set`);
}