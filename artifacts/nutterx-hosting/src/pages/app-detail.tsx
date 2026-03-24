import { useState, useRef, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { AppLayout } from "@/components/AppLayout";
import { StatusBadge } from "@/components/StatusBadge";
import { useGetApp, useStartApp, useStopApp, useRestartApp, useDeleteApp, useUpdateEnvVars, getGetAppQueryKey } from "@workspace/api-client-react";
import { useLogStream } from "@/hooks/use-log-stream";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Play, Square, RefreshCw, Trash2, Terminal, Settings, ArrowLeft, Loader2, Save, Trash } from "lucide-react";
import { format } from "date-fns";
import { clsx } from "clsx";

export default function AppDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("logs");

  const { data: app, isLoading } = useGetApp(id!, {
    query: { refetchInterval: 3000 }
  });

  const { mutate: startApp, isPending: isStarting } = useStartApp({
    mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetAppQueryKey(id!) }) }
  });
  const { mutate: stopApp, isPending: isStopping } = useStopApp({
    mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetAppQueryKey(id!) }) }
  });
  const { mutate: restartApp, isPending: isRestarting } = useRestartApp({
    mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetAppQueryKey(id!) }) }
  });
  const { mutateAsync: deleteApp } = useDeleteApp();
  const { mutateAsync: updateEnvVars, isPending: isUpdatingEnv } = useUpdateEnvVars();

  const { logs, clearLogs } = useLogStream(id!);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const handleStart = () => {
    clearLogs();
    setActiveTab("logs");
    startApp({ id: app!.id });
  };

  const handleRestart = () => {
    clearLogs();
    setActiveTab("logs");
    restartApp({ id: app!.id });
  };

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Env vars state
  const [envForm, setEnvForm] = useState<{key: string, value: string}[]>([]);
  useEffect(() => {
    if (app?.envVars) setEnvForm(app.envVars);
  }, [app?.envVars]);

  const handleDelete = async () => {
    try {
      await deleteApp({ id: id! });
      toast({ title: "App deleted successfully" });
      setLocation("/dashboard");
    } catch (e: any) {
      toast({ title: "Failed to delete app", description: e.message, variant: "destructive" });
    }
  };

  const handleSaveEnv = async () => {
    try {
      await updateEnvVars({ id: id!, data: { envVars: envForm } });
      toast({ title: "Environment variables saved" });
      queryClient.invalidateQueries({ queryKey: getGetAppQueryKey(id!) });
    } catch (e: any) {
      toast({ title: "Failed to save variables", description: e.message, variant: "destructive" });
    }
  };

  if (isLoading && !app) {
    return (
      <AppLayout>
        <div className="flex justify-center items-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  if (!app) return null;

  const isProcessActive = app.status === "running" || app.status === "installing";

  return (
    <AppLayout>
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <button onClick={() => setLocation("/dashboard")} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1.5 mb-2 transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back to Dashboard
          </button>
          <div className="flex items-center gap-4">
            <h1 className="text-3xl font-bold tracking-tight">{app.name}</h1>
            <StatusBadge status={app.status} className="px-3 py-1 text-sm" />
          </div>
          <p className="text-sm text-primary font-mono mt-2 bg-primary/10 inline-block px-2 py-0.5 rounded border border-primary/20">
            {app.slug}.nutterxhost.com
          </p>
        </div>

        <div className="flex items-center gap-2">
          {!isProcessActive ? (
            <Button 
              onClick={handleStart}
              disabled={isStarting} 
              className="bg-green-600 hover:bg-green-700 text-white gap-2 shadow-[0_0_15px_rgba(34,197,94,0.3)]"
            >
              {isStarting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />} Start
            </Button>
          ) : (
            <Button 
              variant="outline" 
              onClick={() => stopApp({ id: app.id })} 
              disabled={isStopping} 
              className="hover:bg-red-500/10 hover:text-red-500 hover:border-red-500/30 gap-2"
            >
              {isStopping ? <Loader2 className="w-4 h-4 animate-spin" /> : <Square className="w-4 h-4 fill-current" />} Stop
            </Button>
          )}
          <Button 
            variant="outline" 
            onClick={handleRestart}
            disabled={isRestarting}
            className="gap-2"
          >
            {isRestarting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Restart
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="bg-card border border-border w-full justify-start h-12 rounded-xl mb-6">
          <TabsTrigger value="logs" className="gap-2 data-[state=active]:bg-background"><Terminal className="w-4 h-4" /> Console Logs</TabsTrigger>
          <TabsTrigger value="settings" className="gap-2 data-[state=active]:bg-background"><Settings className="w-4 h-4" /> Settings & Env</TabsTrigger>
        </TabsList>

        <TabsContent value="logs" className="mt-0 outline-none">
          <Card className="bg-[#0a0a0a] border-white/10 shadow-2xl overflow-hidden flex flex-col h-[calc(100vh-280px)] min-h-[500px]">
            <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 bg-white/[0.02]">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-red-500" />
                <div className="w-2 h-2 rounded-full bg-yellow-500" />
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-xs text-zinc-500 font-mono ml-2">bash - {app.slug}</span>
              </div>
              <Button variant="ghost" size="sm" onClick={clearLogs} className="h-6 text-xs text-zinc-500 hover:text-white">
                <Trash className="w-3 h-3 mr-1.5" /> Clear
              </Button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 font-mono text-[13px] leading-relaxed custom-scrollbar">
              {logs.length === 0 ? (
                <div className="text-zinc-600 italic">Waiting for logs...</div>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="flex gap-4 hover:bg-white/5 px-2 rounded -mx-2 group">
                    <span className="text-zinc-600 select-none flex-shrink-0 opacity-50 group-hover:opacity-100 transition-opacity">
                      {format(new Date(log.timestamp), 'HH:mm:ss')}
                    </span>
                    <span className={clsx(
                      "flex-1 break-all",
                      log.stream === 'stderr' ? 'text-red-400' :
                      log.stream === 'system' ? 'text-amber-400' : 'text-zinc-300'
                    )}>
                      {log.line}
                    </span>
                  </div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="settings" className="mt-0 outline-none">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <Card className="p-6">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h3 className="text-lg font-bold">Environment Variables</h3>
                    <p className="text-sm text-muted-foreground">Manage secrets and configuration.</p>
                  </div>
                  <Button onClick={handleSaveEnv} disabled={isUpdatingEnv} className="gap-2">
                    {isUpdatingEnv ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save Changes
                  </Button>
                </div>
                
                <div className="space-y-3">
                  {envForm.map((ev, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <Input 
                        placeholder="KEY" 
                        value={ev.key} 
                        onChange={e => {
                          const n = [...envForm]; n[i].key = e.target.value; setEnvForm(n);
                        }} 
                        className="font-mono text-sm bg-black/20 flex-1"
                      />
                      <Input 
                        placeholder="VALUE" 
                        value={ev.value} 
                        onChange={e => {
                          const n = [...envForm]; n[i].value = e.target.value; setEnvForm(n);
                        }} 
                        className="font-mono text-sm bg-black/20 flex-[2]"
                      />
                      <Button variant="ghost" size="icon" onClick={() => setEnvForm(envForm.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-destructive">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                  <Button variant="outline" onClick={() => setEnvForm([...envForm, { key: "", value: "" }])} className="w-full border-dashed mt-2">
                    + Add Variable
                  </Button>
                </div>
              </Card>

              <Card className="p-6 border-destructive/20 bg-destructive/5">
                <h3 className="text-lg font-bold text-destructive mb-2">Danger Zone</h3>
                <p className="text-sm text-muted-foreground mb-6">Irreversible actions for this application.</p>
                
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="destructive" className="gap-2">
                      <Trash2 className="w-4 h-4" /> Delete Application
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="border-destructive/20">
                    <DialogHeader>
                      <DialogTitle>Are you absolutely sure?</DialogTitle>
                      <DialogDescription>
                        This will permanently delete the application <strong>{app.name}</strong> and remove all associated data, logs, and configuration.
                      </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="mt-6">
                      <Button variant="outline">Cancel</Button>
                      <Button variant="destructive" onClick={handleDelete}>Yes, Delete App</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </Card>
            </div>

            <div className="space-y-6">
              <Card className="p-6">
                <h3 className="font-bold mb-4">Application Details</h3>
                <div className="space-y-4 text-sm">
                  <div>
                    <span className="text-muted-foreground block mb-1">Repository</span>
                    <a href={app.repoUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline font-mono truncate block">
                      {app.repoUrl}
                    </a>
                  </div>
                  <div>
                    <span className="text-muted-foreground block mb-1">Created At</span>
                    <span className="text-foreground">{format(new Date(app.createdAt), 'PPP p')}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block mb-1">Port</span>
                    <span className="text-foreground font-mono">{app.port || "Auto-detected"}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block mb-1">Start Command</span>
                    <span className="text-foreground font-mono">{app.startCommand || "Auto-detected"}</span>
                  </div>
                </div>
              </Card>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </AppLayout>
  );
}
