import { AppLayout } from "@/components/AppLayout";
import { useListApps } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { format } from "date-fns";
import { Plus, AlertCircle, Rocket, ChevronRight } from "lucide-react";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";

export default function Dashboard() {
  const { data: apps, isLoading, error } = useListApps({
    query: { refetchInterval: 5000 },
  });

  return (
    <AppLayout>
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Applications</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {apps ? `${apps.length} app${apps.length !== 1 ? "s" : ""} deployed` : "Manage your deployed applications"}
          </p>
        </div>
        <Link href="/apps/new">
          <Button className="gap-2 shadow-lg shadow-primary/20">
            <Plus className="w-4 h-4" /> Deploy New App
          </Button>
        </Link>
      </div>

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
            {/* Table header */}
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
                  {/* Name */}
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

                  {/* Status */}
                  <td className="px-5 py-3.5">
                    <StatusBadge status={app.status} />
                  </td>

                  {/* Date deployed */}
                  <td className="px-5 py-3.5 text-sm text-muted-foreground whitespace-nowrap">
                    {app.lastDeployedAt
                      ? format(new Date(app.lastDeployedAt), "MMM d, yyyy HH:mm")
                      : <span className="italic text-muted-foreground/50">Never deployed</span>}
                  </td>

                  {/* Action */}
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
        /* Empty state */
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
    </AppLayout>
  );
}
