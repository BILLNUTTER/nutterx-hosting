import { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import {
  connectMongo,
  Payment,
  PesapalSettings,
  Subscription,
  App,
} from "@workspace/mongo";
import { requireAuth } from "../middlewares/auth.js";
import {
  getPesapalToken,
  registerIPNUrl,
  submitOrder,
  getTransactionStatus,
} from "../services/pesapal.js";
import { stopApp } from "../services/processManager.js";

const router: IRouter = Router();

const SUBSCRIPTION_AMOUNT = 150;
const SUBSCRIPTION_CURRENCY = "KES";
const SUBSCRIPTION_DAYS = 30;

async function getPesapalConfig() {
  await connectMongo();
  const settings = await PesapalSettings.findOne({}).lean();
  if (!settings?.consumerKey || !settings?.consumerSecret) {
    throw new Error("PesaPal not configured. Please contact the administrator.");
  }
  return {
    consumerKey: settings.consumerKey.trim(),
    consumerSecret: settings.consumerSecret.trim(),
    isProduction: settings.isProduction ?? false,
    ipnId: settings.ipnId ?? "",
    settingsId: settings._id.toString(),
  };
}

function getServerBase(req: { protocol: string; get: (h: string) => string | undefined }): string {
  const replitDomains = process.env.REPLIT_DOMAINS;
  if (replitDomains) {
    return `https://${replitDomains.split(",")[0].trim()}`;
  }
  return `${req.protocol}://${req.get("host") ?? "localhost"}`;
}

// GET /api/billing/status
router.get("/billing/status", requireAuth, async (req, res) => {
  try {
    await connectMongo();
    const userId = (req as any).user.userId;
    const now = new Date();

    const sub = await Subscription.findOne({
      userId,
      status: "active",
      expiresAt: { $gt: now },
    })
      .sort({ expiresAt: -1 })
      .lean();

    if (!sub) {
      res.json({ active: false, expiresAt: null, daysLeft: 0 });
      return;
    }

    const daysLeft = Math.ceil(
      (sub.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );
    res.json({ active: true, expiresAt: sub.expiresAt, daysLeft });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Internal server error" });
  }
});

// POST /api/billing/initiate
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
      await PesapalSettings.findByIdAndUpdate(config.settingsId, { ipnId });
    }

    const orderId = randomUUID();

    const payment = await Payment.create({
      userId,
      email,
      phone: phone ?? "",
      amount: SUBSCRIPTION_AMOUNT,
      currency: SUBSCRIPTION_CURRENCY,
      pesapalOrderId: orderId,
      pesapalTrackingId: "",
      status: "pending",
    });

    const callbackUrl = `${serverBase}/api/billing/callback?paymentId=${payment._id.toString()}`;

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

    await Payment.findByIdAndUpdate(payment._id, {
      pesapalTrackingId: orderTrackingId,
    });

    res.json({
      redirectUrl,
      orderTrackingId,
      paymentId: payment._id.toString(),
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message ?? "Failed to initiate payment" });
  }
});

// GET /api/billing/ipn  — called by PesaPal
router.get("/billing/ipn", async (req, res) => {
  try {
    const { OrderTrackingId, OrderMerchantReference, OrderNotificationType } =
      req.query as Record<string, string>;

    if (!OrderTrackingId) {
      res.status(400).json({ error: "Missing OrderTrackingId" });
      return;
    }

    const config = await getPesapalConfig();
    const token = await getPesapalToken(config);
    const result = await getTransactionStatus(config, token, OrderTrackingId);

    const payment = await Payment.findOne({
      pesapalTrackingId: OrderTrackingId,
    });

    if (payment && result.status === "Completed") {
      payment.status = "completed";
      await payment.save();

      const now = new Date();
      const expiresAt = new Date(
        now.getTime() + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000
      );
      await Subscription.create({
        userId: payment.userId,
        email: payment.email,
        status: "active",
        paidAt: now,
        expiresAt,
        amount: payment.amount,
        currency: payment.currency,
        paymentId: payment._id,
      });
    } else if (payment && ["Failed", "Invalid"].includes(result.status)) {
      payment.status = result.status === "Failed" ? "failed" : "invalid";
      await payment.save();
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

// GET /api/billing/callback — PesaPal redirects user here after payment
router.get("/billing/callback", async (req, res) => {
  const { OrderTrackingId, paymentId } = req.query as Record<string, string>;

  try {
    if (OrderTrackingId) {
      const config = await getPesapalConfig();
      const token = await getPesapalToken(config);
      const result = await getTransactionStatus(config, token, OrderTrackingId);

      const payment = await Payment.findOne({
        pesapalTrackingId: OrderTrackingId,
      });

      if (payment && result.status === "Completed" && payment.status !== "completed") {
        payment.status = "completed";
        await payment.save();

        const now = new Date();
        const expiresAt = new Date(
          now.getTime() + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000
        );
        await Subscription.create({
          userId: payment.userId,
          email: payment.email,
          status: "active",
          paidAt: now,
          expiresAt,
          amount: payment.amount,
          currency: payment.currency,
          paymentId: payment._id,
        });
      }
    }
  } catch {}

  res.redirect(`/dashboard?payment=done`);
});

// GET /api/billing/check/:trackingId — frontend polls this
router.get("/billing/check/:trackingId", requireAuth, async (req, res) => {
  try {
    const { trackingId } = req.params;
    await connectMongo();
    const payment = await Payment.findOne({ pesapalTrackingId: trackingId }).lean();

    if (!payment) {
      res.status(404).json({ error: "Payment not found" });
      return;
    }

    if (payment.status === "completed") {
      res.json({ status: "completed" });
      return;
    }

    const config = await getPesapalConfig();
    const token = await getPesapalToken(config);
    const result = await getTransactionStatus(config, token, trackingId);

    if (result.status === "Completed" && payment.status !== "completed") {
      await Payment.findByIdAndUpdate(payment._id, { status: "completed" });

      const now = new Date();
      const expiresAt = new Date(
        now.getTime() + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000
      );
      const existing = await Subscription.findOne({ paymentId: payment._id });
      if (!existing) {
        await Subscription.create({
          userId: payment.userId,
          email: payment.email,
          status: "active",
          paidAt: now,
          expiresAt,
          amount: payment.amount,
          currency: payment.currency,
          paymentId: payment._id,
        });
      }
    } else if (["Failed", "Invalid"].includes(result.status)) {
      await Payment.findByIdAndUpdate(payment._id, {
        status: result.status === "Failed" ? "failed" : "invalid",
      });
    }

    res.json({ status: payment.status === "completed" ? "completed" : result.status.toLowerCase() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
