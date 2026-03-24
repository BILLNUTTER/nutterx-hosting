import { AppLayout } from "@/components/AppLayout";
import { useListApps } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import { format } from "date-fns";
import { Rocket, Plus, Terminal, RefreshCw, AlertCircle, Link2, Github } from "lucide-react";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { motion } from "framer-motion";

export default function Dashboard() {
  const { data: apps, isLoading, error } = useListApps({
    query: { refetchInterval: 5000 } // Poll for status changes
  });

  return (
    <AppLayout>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Manage your deployed applications</p>
        </div>
        <Link href="/apps/new">
          <Button size="lg" className="shadow-lg shadow-primary/20 gap-2">
            <Plus className="w-5 h-5" />
            Deploy App
          </Button>
        </Link>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map(i => (
            <Card key={i} className="p-6 space-y-4">
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-10 w-full mt-4" />
            </Card>
          ))}
        </div>
      ) : error ? (
        <div className="p-6 bg-destructive/10 border border-destructive/20 rounded-xl flex items-start gap-4">
          <AlertCircle className="w-6 h-6 text-destructive flex-shrink-0" />
          <div>
            <h3 className="text-lg font-medium text-destructive">Failed to load apps</h3>
            <p className="text-destructive/80 text-sm">Please try refreshing the page.</p>
          </div>
        </div>
      ) : apps && apps.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {apps.map((app, i) => (
            <motion.div 
              key={app.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Card className="group flex flex-col h-full bg-card hover:bg-card/80 border-border hover:border-primary/50 transition-all duration-300 shadow-sm hover:shadow-xl hover:shadow-primary/5 overflow-hidden">
                <div className="p-6 flex-1">
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-12 h-12 rounded-lg bg-black/50 border border-white/5 flex items-center justify-center shadow-inner">
                      <Terminal className="w-6 h-6 text-primary/80" />
                    </div>
                    <StatusBadge status={app.status} />
                  </div>
                  
                  <h3 className="text-xl font-bold truncate" title={app.name}>{app.name}</h3>
                  
                  <div className="mt-4 space-y-2">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Link2 className="w-4 h-4" />
                      <a href={`https://${app.slug}.nutterxhost.com`} target="_blank" rel="noreferrer" className="hover:text-primary hover:underline truncate">
                        {app.slug}.nutterxhost.com
                      </a>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Github className="w-4 h-4" />
                      <a href={app.repoUrl} target="_blank" rel="noreferrer" className="hover:text-foreground hover:underline truncate">
                        {app.repoUrl.replace('https://github.com/', '')}
                      </a>
                    </div>
                  </div>
                </div>
                
                <div className="px-6 py-4 bg-black/20 border-t border-white/5 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground font-mono flex items-center gap-1.5">
                    <RefreshCw className="w-3 h-3" />
                    {app.lastDeployedAt ? format(new Date(app.lastDeployedAt), 'MMM d, HH:mm') : 'Never'}
                  </span>
                  <Link href={`/apps/${app.id}`}>
                    <Button variant="secondary" size="sm" className="bg-white/5 hover:bg-white/10 text-white">
                      Manage
                    </Button>
                  </Link>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      ) : (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center py-24 bg-card border border-border/50 rounded-2xl shadow-xl shadow-black/20"
        >
          <div className="w-20 h-20 bg-primary/10 text-primary rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-inner border border-primary/20">
            <Rocket className="w-10 h-10" />
          </div>
          <h3 className="text-2xl font-bold text-foreground">No apps deployed yet</h3>
          <p className="mt-2 text-muted-foreground max-w-sm mx-auto mb-8">
            Connect your GitHub repository and deploy your first application in minutes.
          </p>
          <Link href="/apps/new">
            <Button size="lg" className="rounded-xl px-8 shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all font-semibold">
              Deploy New App
            </Button>
          </Link>
        </motion.div>
      )}
    </AppLayout>
  );
}
