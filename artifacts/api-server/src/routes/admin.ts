import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { connectMongo, User, App, Log, PasswordResetRequest } from "@workspace/mongo";
import { stopApp } from "../services/processManager.js";

const router: IRouter = Router();

const ADMIN_USERNAME = "BILLnutter001002";
const ADMIN_KEY = "42819408hosting";

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET not configured");
  return secret;
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
  if (!token) {
    res.status(401).json({ error: "Admin authentication required" });
    return;
  }
  try {
    const payload = jwt.verify(token, getJwtSecret()) as { role?: string };
    if (payload.role !== "admin") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired admin token" });
  }
}

// POST /api/admin/login
router.post("/admin/login", (req, res) => {
  const { username, key } = req.body as { username: string; key: string };
  if (!username || !key) {
    res.status(400).json({ error: "Username and key are required" });
    return;
  }
  if (username !== ADMIN_USERNAME || key !== ADMIN_KEY) {
    res.status(401).json({ error: "Invalid admin credentials" });
    return;
  }
  const token = jwt.sign({ role: "admin", adminId: username }, getJwtSecret(), { expiresIn: "8h" });
  res.json({ adminToken: token });
});

// GET /api/admin/stats
router.get("/admin/stats", requireAdmin, async (req, res) => {
  try {
    await connectMongo();
    const [totalUsers, totalApps, pendingResets] = await Promise.all([
      User.countDocuments(),
      App.countDocuments(),
      PasswordResetRequest.countDocuments({ status: "pending" }),
    ]);
    res.json({ totalUsers, totalApps, pendingResets });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/admin/users
router.get("/admin/users", requireAdmin, async (req, res) => {
  try {
    await connectMongo();
    const users = await User.find({}).sort({ createdAt: -1 }).lean();
    const userIds = users.map((u) => u._id);
    const appCounts = await App.aggregate([
      { $match: { owner: { $in: userIds } } },
      { $group: { _id: "$owner", count: { $sum: 1 } } },
    ]);
    const countMap: Record<string, number> = {};
    for (const { _id, count } of appCounts) {
      countMap[_id.toString()] = count;
    }
    const result = users.map((u) => ({
      id: u._id.toString(),
      email: u.email,
      phone: u.phone ?? "",
      status: u.status ?? "active",
      appCount: countMap[u._id.toString()] ?? 0,
      createdAt: u.createdAt,
    }));
    res.json(result);
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/admin/users/:id/status
router.patch("/admin/users/:id/status", requireAdmin, async (req, res) => {
  try {
    await connectMongo();
    const { status } = req.body as { status: string };
    if (!["active", "suspended", "deactivated"].includes(status)) {
      res.status(400).json({ error: "Invalid status. Use: active, suspended, deactivated" });
      return;
    }
    const user = await User.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    if (status === "suspended" || status === "deactivated") {
      const apps = await App.find({ owner: user._id, status: "running" });
      await Promise.all(apps.map((a) => stopApp(a._id.toString())));
      user.refreshTokens = [];
      await user.save();
    }

    res.json({ id: user._id.toString(), status: user.status });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/admin/users/:id
router.delete("/admin/users/:id", requireAdmin, async (req, res) => {
  try {
    await connectMongo();
    const user = await User.findById(req.params.id);
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const apps = await App.find({ owner: user._id });
    await Promise.all(apps.map(async (a) => {
      try { await stopApp(a._id.toString()); } catch {}
      await Log.deleteMany({ appId: a._id });
      await a.deleteOne();
    }));
    await user.deleteOne();
    res.json({ message: "User and all associated data deleted" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/admin/password-requests
router.get("/admin/password-requests", requireAdmin, async (req, res) => {
  try {
    await connectMongo();
    const requests = await PasswordResetRequest.find({ status: "pending" })
      .sort({ createdAt: -1 })
      .lean();
    res.json(requests.map((r) => ({
      id: r._id.toString(),
      email: r.email,
      preferredPassword: r.preferredPassword,
      status: r.status,
      createdAt: r.createdAt,
    })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/admin/password-requests/:id/resolve
router.patch("/admin/password-requests/:id/resolve", requireAdmin, async (req, res) => {
  try {
    await connectMongo();
    const request = await PasswordResetRequest.findById(req.params.id);
    if (!request) {
      res.status(404).json({ error: "Request not found" });
      return;
    }
    if (request.status !== "pending") {
      res.status(400).json({ error: "Request already resolved" });
      return;
    }
    const user = await User.findOne({ email: request.email });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    user.passwordHash = await bcrypt.hash(request.preferredPassword, 12);
    user.refreshTokens = [];
    await user.save();
    request.status = "resolved";
    await request.save();
    res.json({ message: "Password updated successfully" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/admin/password-requests/:id/reject
router.patch("/admin/password-requests/:id/reject", requireAdmin, async (req, res) => {
  try {
    await connectMongo();
    const request = await PasswordResetRequest.findById(req.params.id);
    if (!request) {
      res.status(404).json({ error: "Request not found" });
      return;
    }
    request.status = "rejected";
    await request.save();
    res.json({ message: "Request rejected" });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/admin/apps
router.get("/admin/apps", requireAdmin, async (req, res) => {
  try {
    await connectMongo();
    const apps = await App.find({}).sort({ createdAt: -1 }).lean();
    const ownerIds = [...new Set(apps.map((a) => a.owner.toString()))];
    const users = await User.find({ _id: { $in: ownerIds } }, "email").lean();
    const userMap: Record<string, string> = {};
    for (const u of users) userMap[u._id.toString()] = u.email;
    res.json(apps.map((a) => ({
      id: a._id.toString(),
      name: a.name,
      slug: a.slug,
      repoUrl: a.repoUrl,
      status: a.status,
      ownerEmail: userMap[a.owner.toString()] ?? "Unknown",
      lastDeployedAt: a.lastDeployedAt,
      createdAt: a.createdAt,
    })));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
