import { AppLayout } from "@/components/AppLayout";
import { useListApps } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { PaymentModal } from "@/components/PaymentModal";
import { format } from "date-fns";
import { Plus, AlertCircle, Rocket, ChevronRight, CreditCard, CheckCircle2, AlertTriangle } from "lucide-react";
import { Link, useLocation } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useEffect, useCallback } from "react";

interface BillingStatus {
  active: boolean;
  expiresAt: string | null;
  daysLeft: number;
}

export default function Dashboard() {
  const { data: apps, isLoading, error } = useListApps({
    query: { refetchInterval: 5000 },
  });

  const [billing, setBilling] = useState<BillingStatus | null>(null);
  const [billingLoading, setBillingLoading] = useState(true);
  const [showPayment, setShowPayment] = useState(false);
  const [, setLocation] = useLocation();

  const fetchBilling = useCallback(async () => {
    try {
      const token = localStorage.getItem("access_token") ?? "";
      const res = await fetch("/api/billing/status", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) setBilling(await res.json());
    } catch {}
    finally { setBillingLoading(false); }
  }, []);

  useEffect(() => {
    fetchBilling();
    const params = new URLSearchParams(window.location.search);
    if (params.get("payment") === "done") {
      fetchBilling();
      setLocation("/dashboard", { replace: true });
    }
  }, [fetchBilling, setLocation]);

  return (
    <AppLayout>
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Applications</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {apps ? `${apps.length} app${apps.length !== 1 ? "s" : ""} deployed` : "Manage your deployed applications"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Billing badge */}
          {!billingLoading && (
            billing?.active ? (
              <div className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/20 text-green-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Active · {billing.daysLeft}d left
              </div>
            ) : (
              <button
                onClick={() => setShowPayment(true)}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/15 transition-colors"
              >
                <CreditCard className="w-3.5 h-3.5" />
                Pay KSH 150
              </button>
            )
          )}
          <Link href="/apps/new">
            <Button className="gap-2 shadow-lg shadow-primary/20">
              <Plus className="w-4 h-4" /> Deploy New App
            </Button>
          </Link>
        </div>
      </div>

      {/* Billing expiry warning */}
      {!billingLoading && billing?.active && billing.daysLeft <= 5 && (
        <div className="mb-5 flex items-center gap-3 px-4 py-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-sm">
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
          <span className="text-amber-300">
            Your subscription expires in <strong>{billing.daysLeft} day{billing.daysLeft !== 1 ? "s" : ""}</strong>. Renew to keep your apps running.
          </span>
          <button
            onClick={() => setShowPayment(true)}
            className="ml-auto text-xs text-amber-400 hover:text-amber-300 underline underline-offset-2 whitespace-nowrap"
          >
            Renew now
          </button>
        </div>
      )}

      {/* No subscription banner */}
      {!billingLoading && !billing?.active && (
        <div className="mb-5 flex items-center gap-3 px-4 py-3 bg-card border border-border rounded-xl text-sm">
          <CreditCard className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <span className="text-muted-foreground">
            No active subscription. Pay <strong className="text-foreground">KSH 150</strong> to deploy apps and keep them running.
          </span>
          <button
            onClick={() => setShowPayment(true)}
            className="ml-auto text-xs text-primary hover:text-primary/80 underline underline-offset-2 whitespace-nowrap"
          >
            Subscribe now
          </button>
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="border border-border rounded-xl bg-card overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {["App Name", "Status", "Date Deployed", ""].map((h) => (
                  <th key={h} className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-5 py-2.5">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[1, 2, 3].map((i) => (
                <tr key={i} className="border-b border-border/50 last:border-0">
                  <td className="px-5 py-4"><Skeleton className="h-4 w-36" /></td>
                  <td className="px-5 py-4"><Skeleton className="h-5 w-16" /></td>
                  <td className="px-5 py-4"><Skeleton className="h-4 w-32" /></td>
                  <td className="px-5 py-4"><Skeleton className="h-7 w-16" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : error ? (
        <div className="p-6 bg-destructive/10 border border-destructive/20 rounded-xl flex items-start gap-4">
          <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-medium text-destructive">Failed to load applications</h3>
            <p className="text-destructive/80 text-sm mt-0.5">Please refresh the page and try again.</p>
          </div>
        </div>
      ) : apps && apps.length > 0 ? (
        <div className="border border-border rounded-xl bg-card shadow-sm overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {["App Name", "Status", "Date Deployed", ""].map((h) => (
                  <th key={h} className="text-left text-xs font-medium text-muted-foreground uppercase tracking-wider px-5 py-2.5 first:rounded-tl-xl last:rounded-tr-xl">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {apps.map((app) => (
                <tr
                  key={app.id}
                  className="group border-b border-border/40 last:border-0 hover:bg-white/[0.02] transition-colors"
                >
                  <td className="px-5 py-3.5">
                    <Link href={`/apps/${app.id}`}>
                      <div className="flex items-center gap-3 cursor-pointer">
                        <div className="w-8 h-8 rounded bg-primary/10 border border-primary/15 flex items-center justify-center flex-shrink-0">
                          <span className="text-primary font-bold text-xs uppercase">{app.name.slice(0, 2)}</span>
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-sm group-hover:text-primary transition-colors truncate">{app.name}</p>
                          <p className="text-[11px] text-muted-foreground font-mono">{app.slug}</p>
                        </div>
                      </div>
                    </Link>
                  </td>
                  <td className="px-5 py-3.5">
                    <StatusBadge status={app.status} />
                  </td>
                  <td className="px-5 py-3.5 text-sm text-muted-foreground whitespace-nowrap">
                    {app.lastDeployedAt
                      ? format(new Date(app.lastDeployedAt), "MMM d, yyyy HH:mm")
                      : <span className="italic text-muted-foreground/50">Never deployed</span>}
                  </td>
                  <td className="px-5 py-3.5">
                    <Link href={`/apps/${app.id}`}>
                      <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:text-primary gap-0.5 px-2">
                        Manage <ChevronRight className="w-3.5 h-3.5" />
                      </Button>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-24 bg-card border border-border/50 rounded-xl">
          <div className="w-16 h-16 bg-primary/10 text-primary rounded-xl flex items-center justify-center mx-auto mb-5 border border-primary/20">
            <Rocket className="w-8 h-8" />
          </div>
          <h3 className="text-xl font-bold">No apps deployed yet</h3>
          <p className="mt-2 text-muted-foreground text-sm max-w-sm mx-auto mb-7">
            Connect any GitHub repository and deploy your first application in seconds.
          </p>
          <Link href="/apps/new">
            <Button className="gap-2 shadow-lg shadow-primary/20">
              <Plus className="w-4 h-4" /> Deploy Your First App
            </Button>
          </Link>
        </div>
      )}

      <PaymentModal
        open={showPayment}
        onClose={() => setShowPayment(false)}
        onSuccess={fetchBilling}
        title="Subscribe to Nutterx"
      />
    </AppLayout>
  );
}
