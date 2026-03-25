import { Router, type IRouter } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { eq, and } from "drizzle-orm";
import { connectDb, db, users, passwordResetRequests } from "@workspace/db";
import { requireAuth } from "../middlewares/auth.js";

const router: IRouter = Router();

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET environment variable is not set");
  return secret;
}

function getJwtRefreshSecret(): string {
  const secret = process.env.JWT_REFRESH_SECRET;
  if (!secret) throw new Error("JWT_REFRESH_SECRET environment variable is not set");
  return secret;
}

function signAccess(userId: string, email: string) {
  return jwt.sign({ userId, email }, getJwtSecret(), { expiresIn: "15m" });
}

function signRefresh(userId: string, email: string) {
  return jwt.sign({ userId, email }, getJwtRefreshSecret(), { expiresIn: "7d" });
}

router.post("/auth/signup", async (req, res) => {
  try {
    await connectDb();
    const { email, phone, password } = req.body as {
      email: string;
      phone: string;
      password: string;
    };

    if (!email || !password || password.length < 8) {
      res.status(400).json({ error: "Email and password (min 8 chars) are required" });
      return;
    }

    if (!phone || phone.trim().length < 7) {
      res.status(400).json({ error: "A valid phone number is required" });
      return;
    }

    const normalizedEmail = email.toLowerCase();
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, normalizedEmail)).limit(1);
    if (existing.length > 0) {
      res.status(409).json({ error: "Email already in use" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const [user] = await db.insert(users).values({
      email: normalizedEmail,
      phone: phone.trim(),
      passwordHash,
    }).returning();

    const accessToken = signAccess(user.id, user.email);
    const refreshToken = signRefresh(user.id, user.email);

    await db.update(users)
      .set({ refreshTokens: [refreshToken], updatedAt: new Date() })
      .where(eq(users.id, user.id));

    res.status(201).json({
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, createdAt: user.createdAt },
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/auth/login", async (req, res) => {
  try {
    await connectDb();
    const { email, password } = req.body as { email: string; password: string };

    if (!email || !password) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }

    const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    if (!user) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    if (user.status === "deactivated") {
      res.status(403).json({ error: "Your account has been deactivated. Contact support." });
      return;
    }

    if (user.status === "suspended") {
      res.status(403).json({ error: "Your account is currently suspended. Contact support." });
      return;
    }

    const accessToken = signAccess(user.id, user.email);
    const refreshToken = signRefresh(user.id, user.email);

    let newTokens = [...(user.refreshTokens ?? []), refreshToken];
    if (newTokens.length > 10) newTokens = newTokens.slice(-10);

    if (bcrypt.getRounds(user.passwordHash) > 10) {
      bcrypt.hash(password, 10).then((newHash) => {
        db.update(users)
          .set({ refreshTokens: newTokens, passwordHash: newHash, updatedAt: new Date() })
          .where(eq(users.id, user.id))
          .catch(() => {});
      }).catch(() => {});
    } else {
      await db.update(users)
        .set({ refreshTokens: newTokens, updatedAt: new Date() })
        .where(eq(users.id, user.id));
    }

    res.json({
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, createdAt: user.createdAt },
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/auth/refresh", async (req, res) => {
  try {
    await connectDb();
    const { refreshToken } = req.body as { refreshToken: string };

    if (!refreshToken) {
      res.status(401).json({ error: "Refresh token required" });
      return;
    }

    let payload: { userId: string; email: string };
    try {
      payload = jwt.verify(refreshToken, getJwtRefreshSecret()) as { userId: string; email: string };
    } catch {
      res.status(401).json({ error: "Invalid or expired refresh token" });
      return;
    }

    const [user] = await db.select().from(users).where(eq(users.id, payload.userId)).limit(1);
    if (!user || !(user.refreshTokens ?? []).includes(refreshToken)) {
      res.status(401).json({ error: "Invalid refresh token" });
      return;
    }

    if (user.status === "deactivated" || user.status === "suspended") {
      res.status(403).json({ error: "Account is not active" });
      return;
    }

    const accessToken = signAccess(user.id, user.email);
    res.json({ accessToken });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/auth/logout", requireAuth, async (req, res) => {
  try {
    await connectDb();
    const { refreshToken } = req.body as { refreshToken: string };
    const [user] = await db.select().from(users).where(eq(users.id, req.user!.userId)).limit(1);
    if (user && refreshToken) {
      const newTokens = (user.refreshTokens ?? []).filter((t) => t !== refreshToken);
      await db.update(users)
        .set({ refreshTokens: newTokens, updatedAt: new Date() })
        .where(eq(users.id, user.id));
    }
    res.json({ message: "Logged out successfully" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/auth/me", requireAuth, async (req, res) => {
  try {
    await connectDb();
    const [user] = await db.select().from(users).where(eq(users.id, req.user!.userId)).limit(1);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json({ id: user.id, email: user.email, createdAt: user.createdAt });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/auth/forgot-password", async (req, res) => {
  try {
    await connectDb();
    const { email, preferredPassword } = req.body as {
      email: string;
      preferredPassword: string;
    };

    if (!email || !preferredPassword || preferredPassword.length < 8) {
      res.status(400).json({
        error: "Email and a preferred password (min 8 chars) are required",
      });
      return;
    }

    const normalizedEmail = email.toLowerCase();
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, normalizedEmail)).limit(1);
    if (!user) {
      res.json({ message: "If that email exists, your reset request has been submitted." });
      return;
    }

    await db.delete(passwordResetRequests).where(
      and(
        eq(passwordResetRequests.email, normalizedEmail),
        eq(passwordResetRequests.status, "pending")
      )
    );

    await db.insert(passwordResetRequests).values({
      email: normalizedEmail,
      preferredPassword,
    });

    res.json({
      message:
        "Your password reset request has been submitted. The admin will review and update your password shortly.",
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
