import { eq, and, lte } from "drizzle-orm";
import { connectDb, db, subscriptions, apps } from "@workspace/db";
import { stopApp } from "./processManager.js";

let cronStarted = false;

export function startSubscriptionCron() {
  if (cronStarted) return;
  cronStarted = true;

  async function tick() {
    try {
      await connectDb();
      const now = new Date();

      const expired = await db.select().from(subscriptions).where(
        and(eq(subscriptions.status, "active"), lte(subscriptions.expiresAt, now))
      );

      for (const sub of expired) {
        await db.update(subscriptions)
          .set({ status: "expired", updatedAt: new Date() })
          .where(eq(subscriptions.id, sub.id));

        const runningApps = await db.select().from(apps).where(
          and(eq(apps.ownerId, sub.userId), eq(apps.status, "running"))
        );
        await Promise.all(runningApps.map(async (app) => {
          try { await stopApp(app.id); } catch {}
        }));
      }
    } catch {}
  }

  setInterval(tick, 5 * 60 * 1000);
  tick();
}
