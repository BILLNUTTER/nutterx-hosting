import {
  pgTable,
  text,
  boolean,
  integer,
  numeric,
  timestamp,
  jsonb,
  uuid,
  index,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  phone: text("phone").notNull().default(""),
  passwordHash: text("password_hash").notNull(),
  refreshTokens: jsonb("refresh_tokens").$type<string[]>().notNull().default([]),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const apps = pgTable("apps", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull(),
  repoUrl: text("repo_url").notNull(),
  branch: text("branch").notNull().default("main"),
  pat: text("pat"),
  slug: text("slug").notNull().unique(),
  status: text("status").notNull().default("idle"),
  autoRestart: boolean("auto_restart").notNull().default(false),
  startCommand: text("start_command"),
  installCommand: text("install_command"),
  workDir: text("work_dir"),
  port: integer("port"),
  envVars: jsonb("env_vars").$type<Array<{ key: string; value: string }>>().notNull().default([]),
  lastDeployedAt: timestamp("last_deployed_at"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const logs = pgTable(
  "logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appId: text("app_id").notNull(),
    line: text("line").notNull(),
    stream: text("stream").notNull().default("stdout"),
    timestamp: timestamp("timestamp").notNull().defaultNow(),
  },
  (table) => [
    index("logs_app_id_idx").on(table.appId),
    index("logs_app_timestamp_idx").on(table.appId, table.timestamp),
  ]
);

export const passwordResetRequests = pgTable("password_reset_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  preferredPassword: text("preferred_password").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    email: text("email").notNull(),
    phone: text("phone").notNull().default(""),
    amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("KES"),
    pesapalOrderId: text("pesapal_order_id").notNull().unique(),
    pesapalTrackingId: text("pesapal_tracking_id").notNull().default(""),
    status: text("status").notNull().default("pending"),
    description: text("description").notNull().default("Nutterx Hosting - 1 Month Subscription"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("payments_user_status_idx").on(table.userId, table.status),
    index("payments_tracking_idx").on(table.pesapalTrackingId),
  ]
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    email: text("email").notNull(),
    status: text("status").notNull().default("active"),
    paidAt: timestamp("paid_at").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("KES"),
    paymentId: text("payment_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("subscriptions_user_status_idx").on(table.userId, table.status),
    index("subscriptions_expires_idx").on(table.expiresAt),
  ]
);

export const pesapalSettings = pgTable("pesapal_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  consumerKey: text("consumer_key").notNull().default(""),
  consumerSecret: text("consumer_secret").notNull().default(""),
  ipnId: text("ipn_id").notNull().default(""),
  isProduction: boolean("is_production").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const deployments = pgTable(
  "deployments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appId: text("app_id").notNull(),
    status: text("status").notNull().default("building"), // building | success | failed | cancelled
    branch: text("branch").notNull().default("main"),
    commitHash: text("commit_hash"),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    finishedAt: timestamp("finished_at"),
    durationMs: integer("duration_ms"),
    errorMessage: text("error_message"),
    triggeredBy: text("triggered_by").notNull().default("user"), // user | auto-restart | recovery
  },
  (table) => [
    index("deployments_app_id_idx").on(table.appId),
    index("deployments_app_started_idx").on(table.appId, table.startedAt),
  ]
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type App = typeof apps.$inferSelect;
export type NewApp = typeof apps.$inferInsert;
export type Log = typeof logs.$inferSelect;
export type NewLog = typeof logs.$inferInsert;
export type PasswordResetRequest = typeof passwordResetRequests.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
export type PesapalSettings = typeof pesapalSettings.$inferSelect;
export type Deployment = typeof deployments.$inferSelect;
export type NewDeployment = typeof deployments.$inferInsert;
