import { AppLayout } from "@/components/AppLayout";
import { useListApps } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { format } from "date-fns";
import { Plus, AlertCircle, Github, ArrowRight, Rocket, Clock, ChevronRight } from "lucide-react";
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
        <div className="border border-border rounded-xl overflow-hidden bg-card">
          <div className="px-4 py-3 border-b border-border bg-muted/30 grid grid-cols-[2fr_1fr_2fr_1fr_auto] gap-4">
            {["App", "Status", "Repository", "Deployed", ""].map((h) => (
              <span key={h} className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{h}</span>
            ))}
          </div>
          {[1, 2, 3].map((i) => (
            <div key={i} className="px-4 py-4 border-b border-border/50 last:border-0 grid grid-cols-[2fr_1fr_2fr_1fr_auto] gap-4 items-center">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-8 w-16" />
            </div>
          ))}
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
        <div className="border border-border rounded-xl overflow-hidden bg-card shadow-sm">
          {/* Table header */}
          <div className="hidden md:grid grid-cols-[minmax(160px,2fr)_120px_minmax(180px,2fr)_140px_80px] gap-4 px-5 py-3 border-b border-border bg-muted/20">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">App Name</span>
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</span>
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Repository</span>
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Last Deploy</span>
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider"></span>
          </div>

          {/* Table rows */}
          {apps.map((app, i) => (
            <Link key={app.id} href={`/apps/${app.id}`}>
              <div className={`group flex flex-col md:grid md:grid-cols-[minmax(160px,2fr)_120px_minmax(180px,2fr)_140px_80px] gap-3 md:gap-4 items-start md:items-center px-5 py-4 hover:bg-white/[0.03] cursor-pointer transition-colors border-b border-border/50 last:border-0 ${i === 0 ? "" : ""}`}>
                {/* Name */}
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-md bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-primary font-bold text-xs uppercase">{app.name.slice(0, 2)}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate group-hover:text-primary transition-colors">{app.name}</p>
                    <p className="text-xs text-muted-foreground font-mono truncate">{app.slug}</p>
                  </div>
                </div>

                {/* Status */}
                <div className="md:block">
                  <StatusBadge status={app.status} />
                </div>

                {/* Repo */}
                <div className="flex items-center gap-2 min-w-0 text-sm text-muted-foreground">
                  <Github className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="truncate text-xs font-mono">
                    {app.repoUrl.replace("https://github.com/", "")}
                  </span>
                </div>

                {/* Last deployed */}
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="w-3.5 h-3.5" />
                  <span>
                    {app.lastDeployedAt
                      ? format(new Date(app.lastDeployedAt), "MMM d, HH:mm")
                      : "Never"}
                  </span>
                </div>

                {/* Action */}
                <div className="flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs text-muted-foreground hover:text-primary gap-1 px-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Link href={`/apps/${app.id}`}>
                      <span className="flex items-center gap-1">Manage <ChevronRight className="w-3.5 h-3.5" /></span>
                    </Link>
                  </Button>
                </div>
              </div>
            </Link>
          ))}
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
