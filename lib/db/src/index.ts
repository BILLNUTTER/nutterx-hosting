import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.js";

const { Pool } = pg;

const primaryUrl = process.env.PG_DATABASE_URL;
const fallbackUrl = process.env.DATABASE_URL;

if (!primaryUrl && !fallbackUrl) {
  throw new Error("PG_DATABASE_URL or DATABASE_URL must be set");
}

let _pool: pg.Pool | null = null;
let _db: NodePgDatabase<typeof schema> | null = null;

export function getPool(): pg.Pool {
  if (!_pool) throw new Error("connectDb() has not been called yet");
  return _pool;
}

export function getDb(): NodePgDatabase<typeof schema> {
  if (!_db) throw new Error("connectDb() has not been called yet");
  return _db;
}

export { schema };

export * from "./schema/index.js";

const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  refresh_tokens JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS apps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  repo_url TEXT NOT NULL,
  branch TEXT NOT NULL DEFAULT 'main',
  pat TEXT,
  slug TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle',
  auto_restart BOOLEAN NOT NULL DEFAULT false,
  start_command TEXT,
  install_command TEXT,
  work_dir TEXT,
  port INTEGER,
  env_vars JSONB NOT NULL DEFAULT '[]',
  last_deployed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS apps_owner_idx ON apps(owner_id);

CREATE TABLE IF NOT EXISTS logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id TEXT NOT NULL,
  line TEXT NOT NULL,
  stream TEXT NOT NULL DEFAULT 'stdout',
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS logs_app_id_idx ON logs(app_id);
CREATE INDEX IF NOT EXISTS logs_app_timestamp_idx ON logs(app_id, timestamp);

CREATE TABLE IF NOT EXISTS password_reset_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  preferred_password TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  amount NUMERIC(10,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'KES',
  pesapal_order_id TEXT UNIQUE NOT NULL,
  pesapal_tracking_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  description TEXT NOT NULL DEFAULT 'Nutterx Hosting - 1 Month Subscription',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payments_user_status_idx ON payments(user_id, status);
CREATE INDEX IF NOT EXISTS payments_tracking_idx ON payments(pesapal_tracking_id);

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  paid_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'KES',
  payment_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscriptions_user_status_idx ON subscriptions(user_id, status);
CREATE INDEX IF NOT EXISTS subscriptions_expires_idx ON subscriptions(expires_at);

CREATE TABLE IF NOT EXISTS pesapal_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consumer_key TEXT NOT NULL DEFAULT '',
  consumer_secret TEXT NOT NULL DEFAULT '',
  ipn_id TEXT NOT NULL DEFAULT '',
  is_production BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'building',
  branch TEXT NOT NULL DEFAULT 'main',
  commit_hash TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER,
  error_message TEXT,
  triggered_by TEXT NOT NULL DEFAULT 'user'
);

CREATE INDEX IF NOT EXISTS deployments_app_id_idx ON deployments(app_id);
CREATE INDEX IF NOT EXISTS deployments_app_started_idx ON deployments(app_id, started_at);
`;

async function tryConnect(url: string, attempts = 3): Promise<pg.Pool | null> {
  for (let i = 0; i < attempts; i++) {
    const testPool = new Pool({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      max: 1,
      connectionTimeoutMillis: 15000,
      idleTimeoutMillis: 5000,
    });
    try {
      const client = await testPool.connect();
      client.release();
      await testPool.end().catch(() => {});
      return new Pool({
        connectionString: url,
        ssl: { rejectUnauthorized: false },
        max: 10,
        connectionTimeoutMillis: 15000,
        idleTimeoutMillis: 30000,
      });
    } catch (err) {
      await testPool.end().catch(() => {});
      if (i < attempts - 1) {
        const delay = (i + 1) * 2000;
        console.warn(`[db] Connection attempt ${i + 1} failed, retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  return null;
}

let migrated = false;

export async function connectDb(): Promise<void> {
  if (migrated) return;

  if (primaryUrl) {
    const pool = await tryConnect(primaryUrl);
    if (pool) {
      _pool = pool;
      _db = drizzle(pool, { schema });
      console.log("[db] Connected to Supabase PostgreSQL");
    } else {
      console.warn("[db] Supabase unreachable from this environment, trying fallback...");
    }
  }

  if (!_pool && fallbackUrl) {
    const pool = await tryConnect(fallbackUrl);
    if (pool) {
      _pool = pool;
      _db = drizzle(pool, { schema });
      console.log("[db] Connected to fallback PostgreSQL");
    }
  }

  if (!_pool || !_db) {
    throw new Error("Could not connect to any PostgreSQL database");
  }

  await _pool.query(MIGRATION_SQL);
  migrated = true;
}

export const db = new Proxy({} as NodePgDatabase<typeof schema>, {
  get(_target, prop) {
    return getDb()[prop as keyof NodePgDatabase<typeof schema>];
  },
});

export const pool = new Proxy({} as pg.Pool, {
  get(_target, prop) {
    return getPool()[prop as keyof pg.Pool];
  },
});
