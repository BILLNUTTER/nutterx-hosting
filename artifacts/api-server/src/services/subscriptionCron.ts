import { connectMongo, Subscription, App } from "@workspace/mongo";
import { stopApp } from "./processManager.js";

let cronStarted = false;

export function startSubscriptionCron() {
  if (cronStarted) return;
  cronStarted = true;

  async function tick() {
    try {
      await connectMongo();
      const now = new Date();

      const expired = await Subscription.find({
        status: "active",
        expiresAt: { $lte: now },
      }).lean();

      for (const sub of expired) {
        await Subscription.findByIdAndUpdate(sub._id, { status: "expired" });

        const apps = await App.find({ owner: sub.userId, status: "running" }).lean();
        await Promise.all(
          apps.map(async (app) => {
            try {
              await stopApp(app._id.toString());
            } catch {}
          })
        );
      }
    } catch {}
  }

  setInterval(tick, 5 * 60 * 1000);
  tick();
}
