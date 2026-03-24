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
import { Terminal, Loader2, Users, Server, KeyRound, LogOut, MoreVertical, CheckCircle2, XCircle, RefreshCw, Trash2, ShieldOff, ShieldCheck, ShieldAlert } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { clsx } from "clsx";

const ADMIN_TOKEN_KEY = "nutterx_admin_token";

interface AdminStats { totalUsers: number; totalApps: number; pendingResets: number; }
interface AdminUser { id: string; email: string; phone: string; status: string; appCount: number; createdAt: string; }
interface PasswordRequest { id: string; email: string; preferredPassword: string; status: string; createdAt: string; }
interface AdminApp { id: string; name: string; slug: string; repoUrl: string; status: string; ownerEmail: string; lastDeployedAt?: string; createdAt: string; }

function adminFetch(path: string, options?: RequestInit) {
  const token = sessionStorage.getItem(ADMIN_TOKEN_KEY);
  return fetch(path, {
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
  const [apps, setApps] = useState<AdminApp[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const [showPassword, setShowPassword] = useState<Record<string, boolean>>({});
  const [deleteUser, setDeleteUser] = useState<AdminUser | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Check access via URL param
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("admin") !== "nutterxadmin=true") {
      setLocation("/");
      return;
    }
    const token = sessionStorage.getItem(ADMIN_TOKEN_KEY);
    if (token) setIsAuthenticated(true);
    setIsAuthChecked(true);
  }, [setLocation]);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [statsRes, usersRes, reqRes, appsRes] = await Promise.all([
        adminFetch("/api/admin/stats"),
        adminFetch("/api/admin/users"),
        adminFetch("/api/admin/password-requests"),
        adminFetch("/api/admin/apps"),
      ]);
      if (!statsRes.ok || !usersRes.ok) {
        sessionStorage.removeItem(ADMIN_TOKEN_KEY);
        setIsAuthenticated(false);
        return;
      }
      setStats(await statsRes.json());
      setUsers(await usersRes.json());
      setRequests(await reqRes.json());
      setApps(await appsRes.json());
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
      const res = await fetch("/api/admin/login", {
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
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, status } : u));
      toast({ title: `User ${status}`, description: `Account has been ${status}.` });
    } catch (err: any) {
      toast({ title: "Action failed", description: err.message, variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteUser = async () => {
    if (!deleteUser) return;
    setActionLoading("delete-" + deleteUser.id);
    try {
      const res = await adminFetch(`/api/admin/users/${deleteUser.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error);
      setUsers((prev) => prev.filter((u) => u.id !== deleteUser.id));
      toast({ title: "User deleted", description: `${deleteUser.email} and all their data has been removed.` });
      setDeleteUser(null);
      setDeleteConfirm("");
      loadData();
    } catch (err: any) {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  const handleResolveRequest = async (reqId: string) => {
    setActionLoading("resolve-" + reqId);
    try {
      const res = await adminFetch(`/api/admin/password-requests/${reqId}/resolve`, { method: "PATCH" });
      if (!res.ok) throw new Error((await res.json()).error);
      setRequests((prev) => prev.filter((r) => r.id !== reqId));
      toast({ title: "Password updated", description: "User's password has been set." });
      if (stats) setStats({ ...stats, pendingResets: stats.pendingResets - 1 });
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  const handleRejectRequest = async (reqId: string) => {
    setActionLoading("reject-" + reqId);
    try {
      const res = await adminFetch(`/api/admin/password-requests/${reqId}/reject`, { method: "PATCH" });
      if (!res.ok) throw new Error((await res.json()).error);
      setRequests((prev) => prev.filter((r) => r.id !== reqId));
      toast({ title: "Request rejected" });
      if (stats) setStats({ ...stats, pendingResets: stats.pendingResets - 1 });
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  const handleAdminLogout = () => {
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    setIsAuthenticated(false);
    setStats(null);
    setUsers([]);
    setRequests([]);
    setApps([]);
  };

  if (!isAuthChecked) return null;

  // --- LOGIN FORM ---
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-2.5 mb-8">
            <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/25 flex items-center justify-center">
              <Terminal className="w-4 h-4 text-primary" />
            </div>
            <div>
              <div className="font-bold text-sm">Nutterx Admin</div>
              <div className="text-[10px] text-muted-foreground">Restricted access</div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-xl p-6">
            <h1 className="text-lg font-bold mb-1">Admin sign in</h1>
            <p className="text-sm text-muted-foreground mb-6">Enter your admin credentials to continue.</p>

            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="adminUsername">Username</Label>
                <Input id="adminUsername" required className="h-10 bg-background" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="adminKey">Admin key</Label>
                <Input id="adminKey" type="password" required className="h-10 bg-background" value={key} onChange={(e) => setKey(e.target.value)} />
              </div>
              <Button type="submit" className="w-full h-10" disabled={isLoggingIn}>
                {isLoggingIn ? <Loader2 className="w-4 h-4 animate-spin" /> : "Sign In"}
              </Button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // --- ADMIN DASHBOARD ---
  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-12 flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-primary/10 border border-primary/25 flex items-center justify-center">
              <Terminal className="w-3.5 h-3.5 text-primary" />
            </div>
            <span className="font-bold text-sm">Nutterx</span>
            <span className="text-[10px] font-mono text-primary uppercase tracking-widest bg-primary/10 border border-primary/20 px-1.5 py-0.5 rounded-full">Admin</span>
          </div>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={loadData} disabled={isLoading} className="gap-1.5 text-xs text-muted-foreground h-8">
            <RefreshCw className={clsx("w-3.5 h-3.5", isLoading && "animate-spin")} /> Refresh
          </Button>
          <Button variant="ghost" size="sm" onClick={handleAdminLogout} className="gap-1.5 text-xs text-muted-foreground h-8">
            <LogOut className="w-3.5 h-3.5" /> Sign Out
          </Button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[
            { icon: Users, label: "Total Users", value: stats?.totalUsers ?? "—", color: "text-blue-500" },
            { icon: Server, label: "Total Apps", value: stats?.totalApps ?? "—", color: "text-green-500" },
            { icon: KeyRound, label: "Pending Resets", value: stats?.pendingResets ?? "—", color: "text-amber-500" },
          ].map(({ icon: Icon, label, value, color }) => (
            <div key={label} className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Icon className={clsx("w-4 h-4", color)} />
                <span className="text-xs text-muted-foreground">{label}</span>
              </div>
              <p className="text-2xl font-bold">{value}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <Tabs defaultValue="users">
          <TabsList className="mb-6 bg-card border border-border">
            <TabsTrigger value="users" className="gap-1.5"><Users className="w-3.5 h-3.5" /> Users ({users.length})</TabsTrigger>
            <TabsTrigger value="resets" className="gap-1.5"><KeyRound className="w-3.5 h-3.5" /> Password Requests {stats?.pendingResets ? `(${stats.pendingResets})` : ""}</TabsTrigger>
            <TabsTrigger value="apps" className="gap-1.5"><Server className="w-3.5 h-3.5" /> All Apps ({apps.length})</TabsTrigger>
          </TabsList>

          {/* ── USERS TAB ── */}
          <TabsContent value="users">
            <div className="rounded-xl border border-border overflow-hidden bg-card">
              <div className="hidden md:grid grid-cols-[minmax(200px,2fr)_130px_100px_70px_140px_100px] gap-4 px-5 py-2.5 border-b border-border bg-muted/30">
                {["Email", "Phone", "Status", "Apps", "Joined", "Actions"].map((h) => (
                  <span key={h} className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{h}</span>
                ))}
              </div>

              {users.length === 0 && (
                <div className="py-16 text-center text-muted-foreground text-sm">No users found.</div>
              )}

              {users.map((u) => (
                <div key={u.id} className="grid grid-cols-1 md:grid-cols-[minmax(200px,2fr)_130px_100px_70px_140px_100px] gap-3 md:gap-4 px-5 py-3.5 border-b border-border/40 last:border-0 items-center">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{u.email}</p>
                  </div>
                  <p className="text-sm text-muted-foreground">{u.phone || <span className="italic opacity-50">—</span>}</p>
                  <span className={clsx("inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border w-fit capitalize", STATUS_COLOR[u.status] ?? STATUS_COLOR.active)}>
                    {u.status}
                  </span>
                  <span className="text-sm text-muted-foreground">{u.appCount}</span>
                  <span className="text-xs text-muted-foreground">{format(new Date(u.createdAt), "MMM d, yyyy")}</span>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0" disabled={actionLoading?.startsWith(u.id)}>
                        {actionLoading?.startsWith(u.id) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MoreVertical className="w-3.5 h-3.5" />}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      {u.status !== "active" && (
                        <DropdownMenuItem onClick={() => handleStatusChange(u.id, "active")} className="gap-2">
                          <ShieldCheck className="w-3.5 h-3.5 text-green-500" /> Activate
                        </DropdownMenuItem>
                      )}
                      {u.status !== "suspended" && (
                        <DropdownMenuItem onClick={() => handleStatusChange(u.id, "suspended")} className="gap-2">
                          <ShieldAlert className="w-3.5 h-3.5 text-amber-500" /> Suspend
                        </DropdownMenuItem>
                      )}
                      {u.status !== "deactivated" && (
                        <DropdownMenuItem onClick={() => handleStatusChange(u.id, "deactivated")} className="gap-2">
                          <ShieldOff className="w-3.5 h-3.5 text-orange-500" /> Deactivate
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => { setDeleteUser(u); setDeleteConfirm(""); }}
                        className="gap-2 text-destructive focus:text-destructive focus:bg-destructive/10"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Delete User
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
          </TabsContent>

          {/* ── PASSWORD REQUESTS TAB ── */}
          <TabsContent value="resets">
            <div className="rounded-xl border border-border overflow-hidden bg-card">
              <div className="hidden md:grid grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)_150px_160px] gap-4 px-5 py-2.5 border-b border-border bg-muted/30">
                {["User Email", "Preferred Password", "Requested", "Actions"].map((h) => (
                  <span key={h} className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{h}</span>
                ))}
              </div>

              {requests.length === 0 && (
                <div className="py-16 text-center text-muted-foreground text-sm">No pending password reset requests.</div>
              )}

              {requests.map((r) => (
                <div key={r.id} className="grid grid-cols-1 md:grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)_150px_160px] gap-3 md:gap-4 px-5 py-4 border-b border-border/40 last:border-0 items-center">
                  <p className="text-sm font-medium">{r.email}</p>

                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm select-all">
                      {showPassword[r.id] ? r.preferredPassword : "••••••••"}
                    </span>
                    <button
                      onClick={() => setShowPassword((p) => ({ ...p, [r.id]: !p[r.id] }))}
                      className="text-xs text-primary hover:underline flex-shrink-0"
                    >
                      {showPassword[r.id] ? "Hide" : "Show"}
                    </button>
                  </div>

                  <span className="text-xs text-muted-foreground">
                    {format(new Date(r.createdAt), "MMM d, yyyy HH:mm")}
                  </span>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      className="h-7 text-xs gap-1"
                      disabled={!!actionLoading}
                      onClick={() => handleResolveRequest(r.id)}
                    >
                      {actionLoading === "resolve-" + r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                      Set Password
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs gap-1 text-destructive hover:text-destructive"
                      disabled={!!actionLoading}
                      onClick={() => handleRejectRequest(r.id)}
                    >
                      {actionLoading === "reject-" + r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>

          {/* ── ALL APPS TAB ── */}
          <TabsContent value="apps">
            <div className="rounded-xl border border-border overflow-hidden bg-card">
              <div className="hidden md:grid grid-cols-[minmax(160px,2fr)_100px_minmax(140px,1fr)_130px_150px] gap-4 px-5 py-2.5 border-b border-border bg-muted/30">
                {["App Name", "Status", "Owner", "Last Deploy", "Created"].map((h) => (
                  <span key={h} className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{h}</span>
                ))}
              </div>

              {apps.length === 0 && (
                <div className="py-16 text-center text-muted-foreground text-sm">No apps deployed yet.</div>
              )}

              {apps.map((a) => (
                <div key={a.id} className="grid grid-cols-1 md:grid-cols-[minmax(160px,2fr)_100px_minmax(140px,1fr)_130px_150px] gap-3 md:gap-4 px-5 py-3.5 border-b border-border/40 last:border-0 items-center">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{a.name}</p>
                    <p className="text-[11px] font-mono text-muted-foreground">{a.slug}</p>
                  </div>
                  <span className={clsx("inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border w-fit capitalize", APP_STATUS_COLOR[a.status] ?? APP_STATUS_COLOR.idle)}>
                    {a.status}
                  </span>
                  <p className="text-xs text-muted-foreground truncate">{a.ownerEmail}</p>
                  <span className="text-xs text-muted-foreground">
                    {a.lastDeployedAt ? format(new Date(a.lastDeployedAt), "MMM d, HH:mm") : <span className="italic opacity-50">Never</span>}
                  </span>
                  <span className="text-xs text-muted-foreground">{format(new Date(a.createdAt), "MMM d, yyyy")}</span>
                </div>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Delete user dialog */}
      <Dialog open={!!deleteUser} onOpenChange={(open) => { if (!open) { setDeleteUser(null); setDeleteConfirm(""); } }}>
        <DialogContent className="sm:max-w-md border-destructive/30">
          <DialogHeader>
            <DialogTitle className="text-destructive">Delete user account</DialogTitle>
            <DialogDescription className="pt-1">
              This will permanently delete <strong>{deleteUser?.email}</strong> and all their apps, logs, and configuration.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 space-y-3">
            <p className="text-sm text-muted-foreground">
              Type <strong className="font-mono text-foreground">{deleteUser?.email}</strong> to confirm.
            </p>
            <Input
              placeholder={deleteUser?.email}
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              className="font-mono bg-black/30 border-destructive/30"
              autoFocus
            />
          </div>
          <DialogFooter className="mt-4 gap-2">
            <Button variant="outline" onClick={() => { setDeleteUser(null); setDeleteConfirm(""); }}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={deleteConfirm !== deleteUser?.email || !!actionLoading}
              onClick={handleDeleteUser}
              className="gap-2"
            >
              {actionLoading?.startsWith("delete-") ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              Delete User
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
