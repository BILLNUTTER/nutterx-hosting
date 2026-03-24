import { Router, type IRouter } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { connectMongo, User, PasswordResetRequest } from "@workspace/mongo";
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
    await connectMongo();
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

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      res.status(409).json({ error: "Email already in use" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      email: email.toLowerCase(),
      phone: phone.trim(),
      passwordHash,
    });

    const accessToken = signAccess(user._id.toString(), user.email);
    const refreshToken = signRefresh(user._id.toString(), user.email);
    user.refreshTokens.push(refreshToken);
    await user.save();

    res.status(201).json({
      accessToken,
      refreshToken,
      user: { id: user._id.toString(), email: user.email, createdAt: user.createdAt },
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/auth/login", async (req, res) => {
  try {
    await connectMongo();
    const { email, password } = req.body as { email: string; password: string };

    if (!email || !password) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }

    const user = await User.findOne({ email: email.toLowerCase() });
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

    const accessToken = signAccess(user._id.toString(), user.email);
    const refreshToken = signRefresh(user._id.toString(), user.email);
    user.refreshTokens.push(refreshToken);
    if (user.refreshTokens.length > 10) {
      user.refreshTokens = user.refreshTokens.slice(-10);
    }

    // Silently upgrade hashes stored with more than 10 rounds (e.g. legacy 12-round
    // hashes) so subsequent logins are faster. Fire-and-forget — never blocks the response.
    if (bcrypt.getRounds(user.passwordHash) > 10) {
      bcrypt.hash(password, 10).then((newHash) => {
        user.passwordHash = newHash;
        return user.save();
      }).catch(() => {});
    } else {
      await user.save();
    }

    res.json({
      accessToken,
      refreshToken,
      user: { id: user._id.toString(), email: user.email, createdAt: user.createdAt },
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/auth/refresh", async (req, res) => {
  try {
    await connectMongo();
    const { refreshToken } = req.body as { refreshToken: string };

    if (!refreshToken) {
      res.status(401).json({ error: "Refresh token required" });
      return;
    }

    const refreshSecret = process.env.JWT_REFRESH_SECRET!;
    let payload: { userId: string; email: string };
    try {
      payload = jwt.verify(refreshToken, refreshSecret) as { userId: string; email: string };
    } catch {
      res.status(401).json({ error: "Invalid or expired refresh token" });
      return;
    }

    const user = await User.findById(payload.userId);
    if (!user || !user.refreshTokens.includes(refreshToken)) {
      res.status(401).json({ error: "Invalid refresh token" });
      return;
    }

    if (user.status === "deactivated" || user.status === "suspended") {
      res.status(403).json({ error: "Account is not active" });
      return;
    }

    const accessToken = signAccess(user._id.toString(), user.email);
    res.json({ accessToken });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/auth/logout", requireAuth, async (req, res) => {
  try {
    await connectMongo();
    const { refreshToken } = req.body as { refreshToken: string };
    const user = await User.findById(req.user!.userId);
    if (user && refreshToken) {
      user.refreshTokens = user.refreshTokens.filter((t) => t !== refreshToken);
      await user.save();
    }
    res.json({ message: "Logged out successfully" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/auth/me", requireAuth, async (req, res) => {
  try {
    await connectMongo();
    const user = await User.findById(req.user!.userId);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json({ id: user._id.toString(), email: user.email, createdAt: user.createdAt });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Forgot password — user submits email + preferred new password
router.post("/auth/forgot-password", async (req, res) => {
  try {
    await connectMongo();
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

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      // Generic response to avoid email enumeration
      res.json({ message: "If that email exists, your reset request has been submitted." });
      return;
    }

    // Prevent duplicate pending requests for same email
    await PasswordResetRequest.deleteMany({ email: email.toLowerCase(), status: "pending" });

    await PasswordResetRequest.create({
      email: email.toLowerCase(),
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
