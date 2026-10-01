import { Link } from "wouter";
import { useMemo } from "react";
import { formatDistanceToNow } from "date-fns";
import { Activity, ArrowUpRight, Boxes, CircleAlert, Clock3, GitBranch, Plus, Rocket, Server, Zap } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useListApps, getListAppsQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";

export default function Dashboard() {
  const { user } = useAuth();
  const { data: apps, isLoading, error, refetch } = useListApps({ query: { queryKey: getListAppsQueryKey(), refetchInterval: 8000 } });
  const running = useMemo(() => apps?.filter((app) => app.status === "running").length ?? 0, [apps]);
  const needsAttention = useMemo(() => apps?.filter((app) => ["crashed", "error"].includes(app.status)).length ?? 0, [apps]);

  return (
    <AppLayout>
      <div className="nx-enter">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="nx-kicker mb-3">Workspace / overview</p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Good to see you, <span className="text-primary">{user?.email?.split("@")[0]}</span>.</h1>
            <p className="mt-2 text-muted-foreground">Your production surface, at a glance.</p>
          </div>
          <Link href="/apps/new" data-testid="link-deploy-new">
            <Button className="h-11 gap-2 px-5 shadow-[0_10px_32px_hsl(var(--primary)/.18)]"><Plus className="h-4 w-4" /> Deploy an app</Button>
          </Link>
        </div>

        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          <Metric label="Total applications" value={apps?.length ?? 0} icon={Boxes} accent="text-primary" />
          <Metric label="Running now" value={running} icon={Activity} accent="text-primary" detail={apps ? "Live processes" : "Loading"} />
          <Metric label="Needs attention" value={needsAttention} icon={CircleAlert} accent={needsAttention ? "text-accent" : "text-muted-foreground"} detail={needsAttention ? "Check the console" : "All clear"} />
        </div>

        <div className="mt-10 flex items-center justify-between">
          <div><p className="nx-kicker">Your applications</p><h2 className="mt-1 text-xl font-semibold">The fleet</h2></div>
          <div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex"><span className="h-2 w-2 rounded-full bg-primary nx-pulse" /> Refreshing every 8 seconds</div>
        </div>

        {isLoading ? <AppSkeleton /> : error ? (
          <div className="nx-panel mt-4 flex items-center justify-between gap-4 rounded-2xl p-6" data-testid="state-apps-error">
            <div className="flex gap-3"><CircleAlert className="mt-0.5 h-5 w-5 text-accent" /><div><p className="font-medium">We couldn't read your fleet.</p><p className="mt-1 text-sm text-muted-foreground">The control plane may be waking up. Try again in a moment.</p></div></div>
            <Button variant="outline" onClick={() => refetch()} data-testid="button-retry-apps">Retry</Button>
          </div>
        ) : apps && apps.length > 0 ? (
          <div className="mt-4 grid gap-3 lg:grid-cols-2" data-testid="list-apps">
            {apps.map((app, index) => <Link href={`/apps/${app.id}`} key={app.id} data-testid={`card-app-${app.id}`} className={`nx-panel group rounded-2xl p-5 transition duration-200 hover:-translate-y-0.5 hover:border-primary/50 ${index === 0 ? "lg:col-span-2" : ""}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 font-mono text-sm font-bold text-primary">{app.name.slice(0, 2).toUpperCase()}</div>
                  <div className="min-w-0"><h3 className="truncate font-medium group-hover:text-primary">{app.name}</h3><p className="mt-1 flex items-center gap-1 truncate font-mono text-xs text-muted-foreground"><GitBranch className="h-3 w-3" />{app.slug}</p></div>
                </div>
                <StatusBadge status={app.status} />
              </div>
              <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border/70 pt-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5"><Server className="h-3.5 w-3.5" /> {app.port ? `Port ${app.port}` : "Port assigned at deploy"}</span>
                <span className="flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" /> {app.lastDeployedAt ? formatDistanceToNow(new Date(app.lastDeployedAt), { addSuffix: true }) : "Not deployed yet"}</span>
                <ArrowUpRight className="ml-auto h-4 w-4 opacity-0 transition group-hover:opacity-100" />
              </div>
            </Link>)}
          </div>
        ) : (
          <div className="nx-panel nx-grid mt-4 rounded-2xl p-10 text-center sm:p-16" data-testid="state-apps-empty">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/25 bg-primary/10 text-primary"><Rocket className="h-7 w-7" /></div>
            <p className="nx-kicker mt-6">Nothing in orbit yet</p><h2 className="mt-2 text-2xl font-semibold">Ship your first app.</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">Connect a GitHub repository and Nutterx will clone, install, launch, and keep an eye on it.</p>
            <Link href="/apps/new" data-testid="link-empty-deploy"><Button className="mt-6 gap-2"><Zap className="h-4 w-4" /> Start a deployment</Button></Link>
          </div>
        )}
      </div>
    </AppLayout>
  );
}

function Metric({ label, value, icon: Icon, accent, detail = "Across your workspace" }: { label: string; value: number; icon: typeof Boxes; accent: string; detail?: string }) {
  return <div className="nx-panel rounded-2xl p-4" data-testid={`metric-${label.toLowerCase().replaceAll(" ", "-")}`}><div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">{label}</span><Icon className={`h-4 w-4 ${accent}`} /></div><div className="mt-3 text-3xl font-semibold tracking-tight">{value}</div><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>;
}

function AppSkeleton() {
  return <div className="mt-4 grid gap-3 lg:grid-cols-2"><Skeleton className="h-36 rounded-2xl lg:col-span-2" /><Skeleton className="h-36 rounded-2xl" /><Skeleton className="h-36 rounded-2xl" /></div>;
}