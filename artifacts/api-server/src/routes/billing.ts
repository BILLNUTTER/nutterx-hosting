import { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import { eq, and, gt } from "drizzle-orm";
import { connectDb, db, payments, pesapalSettings, subscriptions, apps } from "@workspace/db";
import { requireAuth } from "../middlewares/auth.js";
import {
  getPesapalToken,
  registerIPNUrl,
  submitOrder,
  getTransactionStatus,
} from "../services/pesapal.js";

const router: IRouter = Router();

const SUBSCRIPTION_AMOUNT = 150;
const SUBSCRIPTION_CURRENCY = "KES";
const SUBSCRIPTION_DAYS = 30;

async function getPesapalConfig() {
  await connectDb();
  const [settings] = await db.select().from(pesapalSettings).limit(1);
  if (!settings?.consumerKey || !settings?.consumerSecret) {
    throw new Error("PesaPal not configured. Please contact the administrator.");
  }
  return {
    consumerKey: settings.consumerKey.trim(),
    consumerSecret: settings.consumerSecret.trim(),
    isProduction: settings.isProduction ?? false,
    ipnId: settings.ipnId ?? "",
    settingsId: settings.id,
  };
}

function getServerBase(req: { protocol: string; get: (h: string) => string | undefined }): string {
  const replitDomains = process.env.REPLIT_DOMAINS;
  if (replitDomains) return `https://${replitDomains.split(",")[0].trim()}`;
  return `${req.protocol}://${req.get("host") ?? "localhost"}`;
}

router.get("/billing/status", requireAuth, async (req, res) => {
  try {
    await connectDb();
    const userId = (req as any).user.userId;
    const now = new Date();

    const [sub] = await db.select().from(subscriptions)
      .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, "active"), gt(subscriptions.expiresAt, now)))
      .orderBy(subscriptions.expiresAt)
      .limit(1);

    if (!sub) {
      res.json({ active: false, expiresAt: null, daysLeft: 0 });
      return;
    }

    const daysLeft = Math.ceil((sub.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    res.json({ active: true, expiresAt: sub.expiresAt, daysLeft });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Internal server error" });
  }
});

router.post("/billing/initiate", requireAuth, async (req, res) => {
  try {
    const config = await getPesapalConfig();
    const userId = (req as any).user.userId;
    const email = (req as any).user.email;
    const { phone } = req.body as { phone?: string };

    const token = await getPesapalToken(config);
    const serverBase = getServerBase(req as any);
    const ipnUrl = `${serverBase}/api/billing/ipn`;

    let ipnId = config.ipnId;
    if (!ipnId) {
      ipnId = await registerIPNUrl(config, token, ipnUrl);
      await db.update(pesapalSettings)
        .set({ ipnId, updatedAt: new Date() })
        .where(eq(pesapalSettings.id, config.settingsId));
    }

    const orderId = randomUUID();

    const [payment] = await db.insert(payments).values({
      userId,
      email,
      phone: phone ?? "",
      amount: String(SUBSCRIPTION_AMOUNT),
      currency: SUBSCRIPTION_CURRENCY,
      pesapalOrderId: orderId,
      pesapalTrackingId: "",
      status: "pending",
    }).returning();

    const callbackUrl = `${serverBase}/api/billing/callback?paymentId=${payment.id}`;

    const { orderTrackingId, redirectUrl } = await submitOrder(config, token, {
      orderId,
      amount: SUBSCRIPTION_AMOUNT,
      currency: SUBSCRIPTION_CURRENCY,
      description: "Nutterx Hosting – 1 Month Subscription",
      email,
      phone: phone ?? "",
      callbackUrl,
      ipnId,
    });

    await db.update(payments)
      .set({ pesapalTrackingId: orderTrackingId, updatedAt: new Date() })
      .where(eq(payments.id, payment.id));

    res.json({ redirectUrl, orderTrackingId, paymentId: payment.id });
  } catch (err: any) {
    res.status(400).json({ error: err.message ?? "Failed to initiate payment" });
  }
});

router.get("/billing/ipn", async (req, res) => {
  try {
    const { OrderTrackingId, OrderMerchantReference, OrderNotificationType } =
      req.query as Record<string, string>;

    if (!OrderTrackingId) { res.status(400).json({ error: "Missing OrderTrackingId" }); return; }

    const config = await getPesapalConfig();
    const token = await getPesapalToken(config);
    const result = await getTransactionStatus(config, token, OrderTrackingId);

    const [payment] = await db.select().from(payments).where(eq(payments.pesapalTrackingId, OrderTrackingId)).limit(1);

    if (payment && result.status === "Completed") {
      await db.update(payments).set({ status: "completed", updatedAt: new Date() }).where(eq(payments.id, payment.id));

      const now = new Date();
      const expiresAt = new Date(now.getTime() + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000);
      await db.insert(subscriptions).values({
        userId: payment.userId, email: payment.email, status: "active",
        paidAt: now, expiresAt, amount: payment.amount, currency: payment.currency, paymentId: payment.id,
      });
    } else if (payment && ["Failed", "Invalid"].includes(result.status)) {
      await db.update(payments)
        .set({ status: result.status === "Failed" ? "failed" : "invalid", updatedAt: new Date() })
        .where(eq(payments.id, payment.id));
    }

    res.json({
      orderNotificationType: OrderNotificationType ?? "IPNCHANGE",
      orderTrackingId: OrderTrackingId,
      orderMerchantReference: OrderMerchantReference ?? "",
      status: 200,
    });
  } catch (err: any) {
    res.status(200).json({ status: 500, error: err.message });
  }
});

router.get("/billing/callback", async (req, res) => {
  const { OrderTrackingId } = req.query as Record<string, string>;

  try {
    if (OrderTrackingId) {
      const config = await getPesapalConfig();
      const token = await getPesapalToken(config);
      const result = await getTransactionStatus(config, token, OrderTrackingId);

      const [payment] = await db.select().from(payments).where(eq(payments.pesapalTrackingId, OrderTrackingId)).limit(1);

      if (payment && result.status === "Completed" && payment.status !== "completed") {
        await db.update(payments).set({ status: "completed", updatedAt: new Date() }).where(eq(payments.id, payment.id));

        const now = new Date();
        const expiresAt = new Date(now.getTime() + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000);
        await db.insert(subscriptions).values({
          userId: payment.userId, email: payment.email, status: "active",
          paidAt: now, expiresAt, amount: payment.amount, currency: payment.currency, paymentId: payment.id,
        });
      }
    }
  } catch {}

  res.redirect(`/dashboard?payment=done`);
});

router.get("/billing/check/:trackingId", requireAuth, async (req, res) => {
  try {
    const trackingId = String(req.params.trackingId);
    await connectDb();
    const [payment] = await db.select().from(payments).where(eq(payments.pesapalTrackingId, trackingId)).limit(1);

    if (!payment) { res.status(404).json({ error: "Payment not found" }); return; }

    if (payment.status === "completed") { res.json({ status: "completed" }); return; }

    const config = await getPesapalConfig();
    const token = await getPesapalToken(config);
    const result = await getTransactionStatus(config, token, trackingId);

    if (result.status === "Completed") {
      await db.update(payments).set({ status: "completed", updatedAt: new Date() }).where(eq(payments.id, payment.id));

      const now = new Date();
      const expiresAt = new Date(now.getTime() + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000);
      const [existingSub] = await db.select().from(subscriptions).where(eq(subscriptions.paymentId, payment.id)).limit(1);
      if (!existingSub) {
        await db.insert(subscriptions).values({
          userId: payment.userId, email: payment.email, status: "active",
          paidAt: now, expiresAt, amount: payment.amount, currency: payment.currency, paymentId: payment.id,
        });
      }
    } else if (["Failed", "Invalid"].includes(result.status)) {
      await db.update(payments)
        .set({ status: result.status === "Failed" ? "failed" : "invalid", updatedAt: new Date() })
        .where(eq(payments.id, payment.id));
    }

    res.json({ status: result.status === "Completed" ? "completed" : result.status.toLowerCase() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
