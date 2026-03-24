import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Terminal, Loader2, Users, Server, KeyRound, LogOut, MoreVertical,
  CheckCircle2, XCircle, RefreshCw, Trash2, ShieldOff, ShieldCheck,
  ShieldAlert, ChevronDown, ChevronRight, Rocket, CreditCard, Settings2,
  TrendingUp, Eye, EyeOff, Plus, AlertTriangle, Zap
} from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { clsx } from "clsx";

const ADMIN_TOKEN_KEY = "nutterx_admin_token";
const _nativeFetch: typeof fetch = window.fetch.bind(window);

interface AdminStats { totalUsers: number; totalApps: number; pendingResets: number; totalRevenue: number; }
interface AdminUser {
  id: string; email: string; phone: string; status: string;
  appCount: number; subscriptionActive: boolean; subscriptionExpiry: string | null; createdAt: string;
}
interface PasswordRequest { id: string; email: string; preferredPassword: string; status: string; createdAt: string; }
interface AdminApp { id: string; name: string; slug: string; repoUrl: string; status: string; ownerEmail: string; lastDeployedAt?: string; createdAt: string; }
interface UserApp { id: string; name: string; slug: string; repoUrl: string; status: string; lastDeployedAt?: string; }
interface PaymentRecord { id: string; email: string; phone: string; amount: number; currency: string; status: string; pesapalTrackingId: string; createdAt: string; }
interface PesapalConfig { consumerKey: string; consumerSecret: string; isProduction: boolean; configured: boolean; }

function adminFetch(path: string, options?: RequestInit) {
  const token = sessionStorage.getItem(ADMIN_TOKEN_KEY);
  return _nativeFetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers ?? {}),
    },
  });
}

const STATUS_COLOR: Record<string, string> = {
  active: "text-green-500 bg-green-500/10 border-green-500/20",
  suspended: "text-amber-500 bg-amber-500/10 border-amber-500/20",
  deactivated: "text-destructive bg-destructive/10 border-destructive/20",
};
const APP_STATUS_COLOR: Record<string, string> = {
  running: "text-green-500 bg-green-500/10 border-green-500/20",
  stopped: "text-muted-foreground bg-muted/20 border-border",
  crashed: "text-destructive bg-destructive/10 border-destructive/20",
  installing: "text-blue-500 bg-blue-500/10 border-blue-500/20",
  idle: "text-muted-foreground bg-muted/20 border-border",
  error: "text-destructive bg-destructive/10 border-destructive/20",
};
const PAYMENT_STATUS_COLOR: Record<string, string> = {
  completed: "text-green-500 bg-green-500/10 border-green-500/20",
  pending: "text-amber-500 bg-amber-500/10 border-amber-500/20",
  failed: "text-destructive bg-destructive/10 border-destructive/20",
  invalid: "text-muted-foreground bg-muted/20 border-border",
};

export default function Admin() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAuthChecked, setIsAuthChecked] = useState(false);
  const [username, setUsername] = useState("");
  const [key, setKey] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [requests, setRequests] = useState<PasswordRequest[]>([]);
  const [revenue, setRevenue] = useState<{ totalRevenue: number; currency: string; payments: PaymentRecord[] } | null>(null);
  const [pesapalConfig, setPesapalConfig] = useState<PesapalConfig | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // UI state
  const [showPassword, setShowPassword] = useState<Record<string, boolean>>({});
  const [deleteUser, setDeleteUser] = useState<AdminUser | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [userApps, setUserApps] = useState<Record<string, UserApp[]>>({});
  const [userAppsLoading, setUserAppsLoading] = useState<string | null>(null);

  // Manual subscription
  const [grantSubUserId, setGrantSubUserId] = useState<string | null>(null);
  const [isGrantingSub, setIsGrantingSub] = useState(false);

  // Deploy for user
  const [deployUserId, setDeployUserId] = useState<string | null>(null);
  const [deployName, setDeployName] = useState("");
  const [deployRepo, setDeployRepo] = useState("");
  const [deployStart, setDeployStart] = useState("");
  const [isDeployingForUser, setIsDeployingForUser] = useState(false);

  // PesaPal settings
  const [settingsKey, setSettingsKey] = useState("");
  const [settingsSecret, setSettingsSecret] = useState("");
  const [settingsProd, setSettingsProd] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; debug?: Record<string, any> } | null>(null);

  useEffect(() => {
    if (!window.location.href.includes("admin=nutterxadmin=true")) {
      setLocation("/");
      return;
    }
    const token = sessionStorage.getItem(ADMIN_TOKEN_KEY);
    if (token) setIsAuthenticated(true);
    setIsAuthChecked(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [statsRes, usersRes, reqRes, revRes, settRes] = await Promise.all([
        adminFetch("/api/admin/stats"),
        adminFetch("/api/admin/users"),
        adminFetch("/api/admin/password-requests"),
        adminFetch("/api/admin/revenue"),
        adminFetch("/api/admin/settings"),
      ]);
      if (!statsRes.ok || !usersRes.ok) {
        sessionStorage.removeItem(ADMIN_TOKEN_KEY);
        setIsAuthenticated(false);
        return;
      }
      setStats(await statsRes.json());
      setUsers(await usersRes.json());
      setRequests(await reqRes.json());
      if (revRes.ok) setRevenue(await revRes.json());
      if (settRes.ok) {
        const cfg = await settRes.json() as PesapalConfig;
        setPesapalConfig(cfg);
        setSettingsKey(cfg.consumerKey);
        setSettingsSecret(""); // never pre-fill with masked placeholder
        setSettingsProd(cfg.isProduction);
      }
    } catch {
      toast({ title: "Failed to load data", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (isAuthenticated) loadData();
  }, [isAuthenticated, loadData]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    try {
      const res = await _nativeFetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, key }),
      });
      const data = await res.json() as { adminToken?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Login failed");
      sessionStorage.setItem(ADMIN_TOKEN_KEY, data.adminToken!);
      setIsAuthenticated(true);
    } catch (err: any) {
      toast({ title: "Login failed", description: err.message, variant: "destructive" });
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleStatusChange = async (userId: string, status: string) => {
    setActionLoading(userId + status);
    try {
      const res = await adminFetch(`/api/admin/users/${userId}/status`, {
        method: "PATCH", body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, status } : u));
      toast({ title: `User ${status}` });
    } catch (err: any) {
      toast({ title: "Action failed", description: err.message, variant: "destructive" });
    } finally { setActionLoading(null); }
  };

  const handleDeleteUser = async () => {
    if (!deleteUser) return;
    setActionLoading("delete-" + deleteUser.id);
    try {
      const res = await adminFetch(`/api/admin/users/${deleteUser.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error);
      setUsers((prev) => prev.filter((u) => u.id !== deleteUser.id));
      toast({ title: "User deleted" });
      setDeleteUser(null);
      setDeleteConfirm("");
    } catch (err: any) {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    } finally { setActionLoading(null); }
  };

  const handleResolveRequest = async (id: string) => {
    setActionLoading("resolve-" + id);
    try {
      const res = await adminFetch(`/api/admin/password-requests/${id}/resolve`, { method: "PATCH" });
      if (!res.ok) throw new Error((await res.json()).error);
      setRequests((prev) => prev.filter((r) => r.id !== id));
      toast({ title: "Password updated" });
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    } finally { setActionLoading(null); }
  };

  const handleRejectRequest = async (id: string) => {
    setActionLoading("reject-" + id);
    try {
      const res = await adminFetch(`/api/admin/password-requests/${id}/reject`, { method: "PATCH" });
      if (!res.ok) throw new Error((await res.json()).error);
      setRequests((prev) => prev.filter((r) => r.id !== id));
      toast({ title: "Request rejected" });
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    } finally { setActionLoading(null); }
  };

  const toggleExpandUser = async (userId: string) => {
    if (expandedUser === userId) {
      setExpandedUser(null);
      return;
    }
    setExpandedUser(userId);
    if (userApps[userId]) return;
    setUserAppsLoading(userId);
    try {
      const res = await adminFetch(`/api/admin/users/${userId}/apps`);
      if (res.ok) {
        const data = await res.json();
        setUserApps((prev) => ({ ...prev, [userId]: data }));
      }
    } catch {} finally { setUserAppsLoading(null); }
  };

  const handleDeployForUser = async () => {
    if (!deployUserId || !deployName || !deployRepo) return;
    setIsDeployingForUser(true);
    try {
      const res = await adminFetch(`/api/admin/users/${deployUserId}/apps`, {
        method: "POST",
        body: JSON.stringify({ name: deployName, repoUrl: deployRepo, startCommand: deployStart }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast({ title: "App created", description: `${deployName} created for user.` });
      setUserApps((prev) => {
        const existing = prev[deployUserId] ?? [];
        const data = { id: Date.now().toString(), name: deployName, slug: deployName.toLowerCase(), repoUrl: deployRepo, status: "idle" };
        return { ...prev, [deployUserId]: [data, ...existing] };
      });
      setDeployUserId(null);
      setDeployName(""); setDeployRepo(""); setDeployStart("");
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    } finally { setIsDeployingForUser(false); }
  };

  const handleGrantSubscription = async (userId: string, email: string) => {
    setGrantSubUserId(userId);
    setIsGrantingSub(true);
    try {
      const res = await adminFetch(`/api/admin/users/${userId}/subscription`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed");
      toast({ title: "Subscription activated", description: `30-day subscription granted to ${email}.` });
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    } finally { setGrantSubUserId(null); setIsGrantingSub(false); }
  };

  const handleSaveSettings = async () => {
    const trimmedKey = settingsKey.trim();
    const trimmedSecret = settingsSecret.trim();
    if (!trimmedKey) { toast({ title: "Consumer Key is required", variant: "destructive" }); return; }
    setIsSavingSettings(true);
    setTestResult(null);
    try {
      const res = await adminFetch("/api/admin/settings", {
        method: "PUT",
        body: JSON.stringify({ consumerKey: trimmedKey, consumerSecret: trimmedSecret, isProduction: settingsProd }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setSettingsKey(trimmedKey);
      setSettingsSecret("");
      toast({ title: "Settings saved", description: "PesaPal credentials updated." });
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    } finally { setIsSavingSettings(false); }
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    // If credentials are typed in the fields, test them directly (bypass MongoDB).
    // Otherwise fall back to testing what's saved in the database.
    const currentKey = settingsKey.trim();
    const currentSecret = settingsSecret.trim();
    try {
      if (currentKey && currentSecret) {
        // Raw test — sends exactly what is typed, never touches DB
        const res = await adminFetch("/api/admin/settings/rawtest", {
          method: "POST",
          body: JSON.stringify({ consumerKey: currentKey, consumerSecret: currentSecret, isProduction: settingsProd }),
        });
        const data = await res.json() as { gotToken?: boolean; requestPayload?: string; pesapalResponse?: any; error?: string; httpStatus?: number; keyLength?: number; secretLength?: number };
        setTestResult({
          ok: !!data.gotToken,
          message: data.gotToken
            ? "Connection successful! PesaPal accepted these credentials."
            : `PesaPal rejected credentials: ${data.pesapalResponse?.error?.message ?? data.pesapalResponse?.message ?? JSON.stringify(data.pesapalResponse ?? data.error)}`,
          debug: {
            source: "Typed in fields (not from database)",
            environment: settingsProd ? "Production" : "Sandbox",
            keyLength: data.keyLength,
            secretLength: data.secretLength,
            requestPayload: data.requestPayload,
            httpStatus: data.httpStatus,
            pesapalResponse: data.pesapalResponse,
          },
        });
      } else {
        // Test what's saved in DB
        const res = await adminFetch("/api/admin/settings/test");
        const data = await res.json() as { ok: boolean; message: string; debug?: Record<string, any> };
        setTestResult(data);
      }
    } catch (err: any) {
      setTestResult({ ok: false, message: err.message ?? "Test failed" });
    } finally { setIsTesting(false); }
  };

  if (!isAuthChecked) return null;

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-3 mb-8 justify-center">
            <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Terminal className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="font-bold text-base">Nutterx Admin</p>
              <p className="text-xs text-muted-foreground">Restricted access</p>
            </div>
          </div>
          <form onSubmit={handleLogin} className="space-y-4 bg-card border border-border rounded-2xl p-6 shadow-xl">
            <div className="space-y-2">
              <Label htmlFor="admin-username">Username</Label>
              <Input id="admin-username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="admin-key">Admin Key</Label>
              <Input id="admin-key" type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="current-password" />
            </div>
            <Button type="submit" className="w-full" disabled={isLoggingIn}>
              {isLoggingIn ? <Loader2 className="w-4 h-4 animate-spin" /> : "Sign In"}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Admin nav */}
      <header className="sticky top-0 z-40 border-b border-border bg-card/80 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 h-12 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center">
              <Terminal className="w-3.5 h-3.5 text-primary" />
            </div>
            <span className="font-semibold text-sm">Nutterx Admin</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={loadData} disabled={isLoading} className="h-8 gap-1.5 text-xs">
              <RefreshCw className={clsx("w-3.5 h-3.5", isLoading && "animate-spin")} /> Refresh
            </Button>
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs text-muted-foreground" onClick={() => { sessionStorage.removeItem(ADMIN_TOKEN_KEY); setIsAuthenticated(false); }}>
              <LogOut className="w-3.5 h-3.5" /> Sign Out
            </Button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {[
              { label: "Total Users", value: stats.totalUsers, icon: Users, color: "text-blue-400" },
              { label: "Total Apps", value: stats.totalApps, icon: Server, color: "text-violet-400" },
              { label: "Pending Resets", value: stats.pendingResets, icon: KeyRound, color: "text-amber-400" },
              { label: "Total Revenue", value: `KSH ${stats.totalRevenue.toLocaleString()}`, icon: TrendingUp, color: "text-green-400" },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="bg-card border border-border rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Icon className={clsx("w-4 h-4", color)} />
                  <span className="text-xs text-muted-foreground">{label}</span>
                </div>
                <p className="text-2xl font-bold">{value}</p>
              </div>
            ))}
          </div>
        )}

        <Tabs defaultValue="users">
          <TabsList className="mb-6">
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="requests">
              Password Requests
              {requests.length > 0 && (
                <span className="ml-1.5 bg-amber-500/20 text-amber-400 text-[10px] px-1.5 py-0.5 rounded-full">{requests.length}</span>
              )}
            </TabsTrigger>
            <TabsTrigger value="revenue">Revenue</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          {/* ── Users Tab ── */}
          <TabsContent value="users">
            <div className="border border-border rounded-xl bg-card overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {["", "Email", "Phone", "Status", "Subscription", "Apps", "Registered", ""].map((h, i) => (
                      <th key={i} className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-4 py-2.5">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <>
                      <tr
                        key={user.id}
                        className="group border-b border-border/40 hover:bg-white/[0.02] transition-colors cursor-pointer"
                        onClick={() => toggleExpandUser(user.id)}
                      >
                        <td className="px-4 py-3 w-8">
                          {expandedUser === user.id
                            ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
                            : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                        </td>
                        <td className="px-4 py-3 text-sm font-medium">{user.email}</td>
                        <td className="px-4 py-3 text-sm text-muted-foreground font-mono">{user.phone || "—"}</td>
                        <td className="px-4 py-3">
                          <span className={clsx("text-xs px-2 py-0.5 rounded-full border capitalize", STATUS_COLOR[user.status] ?? STATUS_COLOR.active)}>
                            {user.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {user.subscriptionActive ? (
                            <span className="flex items-center gap-1 text-xs text-green-400">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Active
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground/60">None</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">{user.appCount}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                          {format(new Date(user.createdAt), "MMM d, yyyy")}
                        </td>
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7">
                                <MoreVertical className="w-3.5 h-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {user.status !== "active" && (
                                <DropdownMenuItem onClick={() => handleStatusChange(user.id, "active")} disabled={actionLoading === user.id + "active"}>
                                  <ShieldCheck className="w-4 h-4 mr-2 text-green-500" /> Activate
                                </DropdownMenuItem>
                              )}
                              {user.status !== "suspended" && (
                                <DropdownMenuItem onClick={() => handleStatusChange(user.id, "suspended")} disabled={actionLoading === user.id + "suspended"}>
                                  <ShieldAlert className="w-4 h-4 mr-2 text-amber-500" /> Suspend
                                </DropdownMenuItem>
                              )}
                              {user.status !== "deactivated" && (
                                <DropdownMenuItem onClick={() => handleStatusChange(user.id, "deactivated")} disabled={actionLoading === user.id + "deactivated"}>
                                  <ShieldOff className="w-4 h-4 mr-2 text-destructive" /> Deactivate
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => { setDeleteUser(user); setDeleteConfirm(""); }}>
                                <Trash2 className="w-4 h-4 mr-2" /> Delete User
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>

                      {/* Expanded user row — apps */}
                      {expandedUser === user.id && (
                        <tr key={user.id + "-expanded"} className="bg-muted/10 border-b border-border/40">
                          <td colSpan={8} className="px-6 py-4">
                            <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Apps for {user.email}</p>
                              <div className="flex items-center gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs gap-1.5"
                                  onClick={() => handleGrantSubscription(user.id, user.email)}
                                  disabled={isGrantingSub && grantSubUserId === user.id}
                                >
                                  {isGrantingSub && grantSubUserId === user.id
                                    ? <Loader2 className="w-3 h-3 animate-spin" />
                                    : <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />}
                                  Activate 30-day Sub
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs gap-1.5"
                                  onClick={() => { setDeployUserId(user.id); setDeployName(""); setDeployRepo(""); setDeployStart(""); }}
                                >
                                  <Plus className="w-3.5 h-3.5" /> Deploy App for User
                                </Button>
                              </div>
                            </div>

                            {userAppsLoading === user.id ? (
                              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                                <Loader2 className="w-4 h-4 animate-spin" /> Loading apps…
                              </div>
                            ) : (userApps[user.id] ?? []).length === 0 ? (
                              <p className="text-sm text-muted-foreground/60 italic">No apps deployed yet.</p>
                            ) : (
                              <div className="overflow-x-auto">
                                <table className="w-full min-w-[500px] border-collapse text-sm">
                                  <thead>
                                    <tr className="border-b border-border/50">
                                      {["App Name", "Status", "Last Deployed"].map((h) => (
                                        <th key={h} className="text-left text-xs text-muted-foreground font-medium py-1.5 pr-6">{h}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {(userApps[user.id] ?? []).map((app) => (
                                      <tr key={app.id} className="border-b border-border/20 last:border-0">
                                        <td className="py-2 pr-6">
                                          <p className="font-medium">{app.name}</p>
                                          <p className="text-[11px] text-muted-foreground font-mono">{app.slug}</p>
                                        </td>
                                        <td className="py-2 pr-6">
                                          <span className={clsx("text-xs px-2 py-0.5 rounded-full border capitalize", APP_STATUS_COLOR[app.status] ?? APP_STATUS_COLOR.idle)}>
                                            {app.status}
                                          </span>
                                        </td>
                                        <td className="py-2 text-xs text-muted-foreground">
                                          {app.lastDeployedAt ? format(new Date(app.lastDeployedAt), "MMM d, yyyy HH:mm") : "Never"}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
              {users.length === 0 && (
                <p className="text-center text-muted-foreground text-sm py-12">No users yet.</p>
              )}
            </div>
          </TabsContent>

          {/* ── Password Requests Tab ── */}
          <TabsContent value="requests">
            {requests.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground text-sm">No pending password requests.</div>
            ) : (
              <div className="space-y-3">
                {requests.map((req) => (
                  <div key={req.id} className="bg-card border border-border rounded-xl px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{req.email}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{format(new Date(req.createdAt), "MMM d, yyyy HH:mm")}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-xs text-muted-foreground">Preferred password:</span>
                        <code className="text-xs font-mono bg-muted/40 px-2 py-0.5 rounded">
                          {showPassword[req.id] ? req.preferredPassword : "••••••••"}
                        </code>
                        <button onClick={() => setShowPassword((p) => ({ ...p, [req.id]: !p[req.id] }))} className="text-muted-foreground hover:text-foreground transition-colors">
                          {showPassword[req.id] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => handleResolveRequest(req.id)} disabled={actionLoading === "resolve-" + req.id}>
                        {actionLoading === "resolve-" + req.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                        Set Password
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs text-muted-foreground" onClick={() => handleRejectRequest(req.id)} disabled={actionLoading === "reject-" + req.id}>
                        {actionLoading === "reject-" + req.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                        Reject
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Revenue Tab ── */}
          <TabsContent value="revenue">
            {revenue ? (
              <div className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="bg-card border border-border rounded-xl p-5 sm:col-span-1">
                    <div className="flex items-center gap-2 mb-2">
                      <TrendingUp className="w-4 h-4 text-green-400" />
                      <span className="text-xs text-muted-foreground">Total Revenue</span>
                    </div>
                    <p className="text-3xl font-black">KSH {revenue.totalRevenue.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground mt-1">{revenue.payments.filter(p => p.status === "completed").length} successful payments</p>
                  </div>
                  <div className="bg-card border border-border rounded-xl p-5">
                    <div className="flex items-center gap-2 mb-2">
                      <CheckCircle2 className="w-4 h-4 text-green-400" />
                      <span className="text-xs text-muted-foreground">Completed</span>
                    </div>
                    <p className="text-3xl font-black">{revenue.payments.filter(p => p.status === "completed").length}</p>
                  </div>
                  <div className="bg-card border border-border rounded-xl p-5">
                    <div className="flex items-center gap-2 mb-2">
                      <CreditCard className="w-4 h-4 text-amber-400" />
                      <span className="text-xs text-muted-foreground">Pending</span>
                    </div>
                    <p className="text-3xl font-black">{revenue.payments.filter(p => p.status === "pending").length}</p>
                  </div>
                </div>

                <div className="border border-border rounded-xl bg-card overflow-x-auto">
                  <table className="w-full min-w-[640px] border-collapse">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        {["Email", "Amount", "Status", "Tracking ID", "Date"].map((h) => (
                          <th key={h} className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-5 py-2.5">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {revenue.payments.map((p) => (
                        <tr key={p.id} className="border-b border-border/40 last:border-0 hover:bg-white/[0.02] transition-colors">
                          <td className="px-5 py-3 text-sm">{p.email}</td>
                          <td className="px-5 py-3 text-sm font-mono">{p.currency} {p.amount}</td>
                          <td className="px-5 py-3">
                            <span className={clsx("text-xs px-2 py-0.5 rounded-full border capitalize", PAYMENT_STATUS_COLOR[p.status] ?? PAYMENT_STATUS_COLOR.pending)}>
                              {p.status}
                            </span>
                          </td>
                          <td className="px-5 py-3 text-xs text-muted-foreground font-mono truncate max-w-[160px]">{p.pesapalTrackingId || "—"}</td>
                          <td className="px-5 py-3 text-xs text-muted-foreground whitespace-nowrap">{format(new Date(p.createdAt), "MMM d, yyyy HH:mm")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {revenue.payments.length === 0 && (
                    <p className="text-center text-muted-foreground text-sm py-10">No payments yet.</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-muted-foreground py-10 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading revenue data…
              </div>
            )}
          </TabsContent>

          {/* ── Settings Tab ── */}
          <TabsContent value="settings">
            <div className="max-w-xl">
              <div className="bg-card border border-border rounded-xl p-6 space-y-5">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2.5">
                    <Settings2 className="w-4 h-4 text-primary" />
                    <h3 className="font-semibold text-sm">PesaPal Integration</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSettingsKey("qkio1BGGYAXTu2JOfm7XSXNruoZsrqEW");
                      setSettingsSecret("osGQ364R49cXKeOYSpaOnT++rHs=");
                      setSettingsProd(false);
                      setTestResult(null);
                    }}
                    className="text-xs text-primary underline underline-offset-2 hover:no-underline"
                  >
                    Use official sandbox demo credentials
                  </button>
                </div>

                <div className="flex items-start gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2.5">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span className="leading-relaxed">
                    New PesaPal accounts require manual approval (1–3 business days). If your real credentials are rejected, use the sandbox demo credentials above to test the full payment flow while you wait.
                  </span>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="consumer-key">Consumer Key</Label>
                  <Input
                    id="consumer-key"
                    value={settingsKey}
                    onChange={(e) => setSettingsKey(e.target.value)}
                    placeholder="Enter PesaPal consumer key"
                    className="font-mono text-sm"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="consumer-secret">Consumer Secret</Label>
                  <div className="relative">
                    <Input
                      id="consumer-secret"
                      type={showSecret ? "text" : "password"}
                      value={settingsSecret}
                      onChange={(e) => setSettingsSecret(e.target.value)}
                      placeholder={pesapalConfig?.configured ? "Leave blank to keep existing" : "Enter PesaPal consumer secret"}
                      className="font-mono text-sm pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecret((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-3 py-2">
                  <button
                    onClick={() => setSettingsProd((v) => !v)}
                    className={clsx(
                      "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                      settingsProd ? "bg-green-500" : "bg-muted"
                    )}
                  >
                    <span className={clsx("inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform", settingsProd ? "translate-x-4" : "translate-x-0.5")} />
                  </button>
                  <Label className="cursor-pointer" onClick={() => setSettingsProd((v) => !v)}>
                    {settingsProd ? "Production environment" : "Sandbox environment (testing)"}
                  </Label>
                </div>

                {testResult && (
                  <div className={clsx(
                    "rounded-lg px-3 py-2.5 space-y-1.5",
                    testResult.ok
                      ? "text-green-400 bg-green-500/10 border border-green-500/20"
                      : "text-red-400 bg-red-500/10 border border-red-500/20"
                  )}>
                    <div className="flex items-start gap-2 text-xs">
                      {testResult.ok
                        ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        : <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
                      <span className="leading-relaxed font-medium">{testResult.message}</span>
                    </div>
                    {testResult.debug && !testResult.ok && (
                      <div className="text-xs font-mono bg-black/20 rounded p-2 space-y-0.5 text-muted-foreground">
                        {testResult.debug.source && <div>Source: <span className="text-foreground">{testResult.debug.source}</span></div>}
                        <div>Environment: <span className="text-foreground">{testResult.debug.environment}</span></div>
                        {testResult.debug.url && <div>URL: <span className="text-foreground break-all">{testResult.debug.url}</span></div>}
                        <div>Key length: <span className="text-foreground">{testResult.debug.keyLength} chars</span></div>
                        <div>Secret length: <span className="text-foreground">{testResult.debug.secretLength} chars</span></div>
                        <div>PesaPal HTTP status: <span className="text-foreground">{testResult.debug.httpStatus}</span></div>
                        {testResult.debug.requestPayload && (
                          <>
                            <div className="mt-1">Exact JSON sent to PesaPal:</div>
                            <pre className="whitespace-pre-wrap break-all text-yellow-400">{testResult.debug.requestPayload}</pre>
                          </>
                        )}
                        <div className="mt-1">PesaPal response:</div>
                        <pre className="whitespace-pre-wrap break-all text-foreground">{JSON.stringify(testResult.debug.pesapalResponse, null, 2)}</pre>
                      </div>
                    )}
                  </div>
                )}

                {!testResult && pesapalConfig?.configured && (
                  <div className="flex items-center gap-1.5 text-xs text-green-400 bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    PesaPal credentials are saved
                  </div>
                )}

                <div className="flex gap-3">
                  <Button onClick={handleSaveSettings} disabled={isSavingSettings} className="flex-1">
                    {isSavingSettings ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Save Settings
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleTestConnection}
                    disabled={isTesting}
                    className="gap-2"
                    title={settingsKey.trim() && settingsSecret.trim() ? "Test credentials typed above" : "Test credentials saved in database"}
                  >
                    {isTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                    {settingsKey.trim() && settingsSecret.trim() ? "Test these" : "Test saved"}
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground">
                  Get your credentials from{" "}
                  <a href="https://developer.pesapal.com/" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
                    developer.pesapal.com
                  </a>. Use sandbox mode for testing. Click <strong>Test</strong> after saving to verify your credentials work.
                </p>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Delete user dialog */}
      <Dialog open={!!deleteUser} onOpenChange={(open) => !open && setDeleteUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete User</DialogTitle>
            <DialogDescription>
              This permanently deletes <strong>{deleteUser?.email}</strong> and all their apps, logs, payments, and subscriptions. Type <strong>DELETE</strong> to confirm.
            </DialogDescription>
          </DialogHeader>
          <Input value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} placeholder="Type DELETE to confirm" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteUser(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDeleteUser} disabled={deleteConfirm !== "DELETE" || !!actionLoading}>
              {actionLoading?.startsWith("delete-") ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Trash2 className="w-4 h-4 mr-1" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deploy for user dialog */}
      <Dialog open={!!deployUserId} onOpenChange={(open) => !open && setDeployUserId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deploy App for User</DialogTitle>
            <DialogDescription>Create and register a new app for this user.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>App Name</Label>
              <Input value={deployName} onChange={(e) => setDeployName(e.target.value)} placeholder="my-bot" />
            </div>
            <div className="space-y-1.5">
              <Label>GitHub Repo URL</Label>
              <Input value={deployRepo} onChange={(e) => setDeployRepo(e.target.value)} placeholder="https://github.com/user/repo" />
            </div>
            <div className="space-y-1.5">
              <Label>Start Command (optional)</Label>
              <Input value={deployStart} onChange={(e) => setDeployStart(e.target.value)} placeholder="node index.js" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeployUserId(null)}>Cancel</Button>
            <Button onClick={handleDeployForUser} disabled={!deployName || !deployRepo || isDeployingForUser}>
              {isDeployingForUser ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Rocket className="w-4 h-4 mr-1" />}
              Create App
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
