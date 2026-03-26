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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Play, Square, RefreshCw, Trash2, Terminal, Settings, ArrowLeft, Loader2, Save, Trash, AlertCircle, Pencil, X, History, CheckCircle2, XCircle, Clock, GitBranch, GitCommit, Ban } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { clsx } from "clsx";

export default function AppDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("logs");

  const { data: app, isLoading } = useGetApp(id!, {
    query: { queryKey: getGetAppQueryKey(id!), refetchInterval: 3000 }
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
  const [showAllCrashLogs, setShowAllCrashLogs] = useState(false);

  const { data: deploymentHistory = [], isLoading: loadingDeployments } = useQuery({
    queryKey: ["deployments", id],
    queryFn: async () => {
      const token = localStorage.getItem("access_token") ?? "";
      const res = await fetch(`/api/apps/${id}/deployments`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Failed to fetch deployments");
      return res.json() as Promise<Array<{
        id: string; status: string; branch: string; commitHash?: string;
        startedAt: string; finishedAt?: string; durationMs?: number;
        errorMessage?: string; triggeredBy: string;
      }>>;
    },
    enabled: !!id && activeTab === "deployments",
    refetchInterval: activeTab === "deployments" ? 6000 : false,
  });

  const handleStart = () => {
    clearLogs();
    setShowAllCrashLogs(false);
    setActiveTab("logs");
    startApp({ id: app!.id });
  };

  const handleRestart = () => {
    clearLogs();
    setShowAllCrashLogs(false);
    setActiveTab("logs");
    restartApp({ id: app!.id });
  };

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Env vars state — only sync from server when NOT actively editing
  const [isEditingEnv, setIsEditingEnv] = useState(false);
  const [envForm, setEnvForm] = useState<{key: string, value: string}[]>([]);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  useEffect(() => {
    // Don't clobber the form while user is editing — they clicked Edit explicitly
    if (!isEditingEnv && app?.envVars) {
      setEnvForm(app.envVars);
    }
  }, [app?.envVars, isEditingEnv]);

  const handleStartEdit = () => {
    // Take a fresh snapshot of the current saved values, then enter edit mode
    setEnvForm(app?.envVars ?? []);
    setIsEditingEnv(true);
  };

  const handleCancelEdit = () => {
    setEnvForm(app?.envVars ?? []);
    setIsEditingEnv(false);
  };

  const handleDelete = async () => {
    if (deleteConfirmName !== app?.name) return;
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
      setIsEditingEnv(false);
    } catch (e: any) {
      toast({ title: "Failed to save variables", description: e.message, variant: "destructive" });
    }
  };

  const [isSavingAndRestarting, setIsSavingAndRestarting] = useState(false);
  const handleSaveAndRestart = async () => {
    setIsSavingAndRestarting(true);
    try {
      await updateEnvVars({ id: id!, data: { envVars: envForm } });
      toast({ title: "Variables saved — restarting app..." });
      setIsEditingEnv(false);
      clearLogs();
      setActiveTab("logs");
      restartApp({ id: app!.id });
    } catch (e: any) {
      toast({ title: "Failed to save variables", description: e.message, variant: "destructive" });
    } finally {
      setIsSavingAndRestarting(false);
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
          <TabsTrigger value="deployments" className="gap-2 data-[state=active]:bg-background"><History className="w-4 h-4" /> Deployments</TabsTrigger>
          <TabsTrigger value="settings" className="gap-2 data-[state=active]:bg-background"><Settings className="w-4 h-4" /> Settings & Env</TabsTrigger>
        </TabsList>

        <TabsContent value="logs" className="mt-0 outline-none">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Terminal — centered square */}
            <div className="lg:col-span-2">
              <Card className="bg-[#0a0a0a] border-white/10 shadow-2xl overflow-hidden flex flex-col h-[460px]">
                <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 bg-white/[0.02]">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-red-500" />
                    <div className="w-2 h-2 rounded-full bg-yellow-500" />
                    <div className="w-2 h-2 rounded-full bg-green-500" />
                    <span className="text-xs text-zinc-500 font-mono ml-2">bash — {app.slug}</span>
                  </div>
                  <Button variant="ghost" size="sm" onClick={clearLogs} className="h-6 text-xs text-zinc-500 hover:text-white">
                    <Trash className="w-3 h-3 mr-1.5" /> Clear
                  </Button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 font-mono text-[13px] leading-relaxed custom-scrollbar">
                  {logs.length === 0 ? (
                    <div className="text-zinc-600 italic">Waiting for logs...</div>
                  ) : (() => {
                    const isCrashed = app.status === 'crashed';
                    const displayedLogs = isCrashed && !showAllCrashLogs ? logs.slice(-2) : logs;
                    const hiddenCount = logs.length - displayedLogs.length;
                    return (
                      <>
                        {isCrashed && hiddenCount > 0 && (
                          <button
                            onClick={() => setShowAllCrashLogs(true)}
                            className="w-full text-center text-xs text-zinc-500 hover:text-zinc-300 bg-white/[0.03] border border-white/10 rounded py-1.5 mb-3 transition-colors"
                          >
                            ↑ Show {hiddenCount} earlier log {hiddenCount === 1 ? "line" : "lines"}
                          </button>
                        )}
                        {displayedLogs.map((log, i) => (
                          <div key={log.id ?? `${log.timestamp}-${i}`} className="flex gap-4 hover:bg-white/5 px-2 rounded -mx-2 group">
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
                        ))}
                        {isCrashed && showAllCrashLogs && (
                          <button
                            onClick={() => setShowAllCrashLogs(false)}
                            className="w-full text-center text-xs text-zinc-500 hover:text-zinc-300 bg-white/[0.03] border border-white/10 rounded py-1.5 mt-3 transition-colors"
                          >
                            ↑ Collapse to last 2 lines
                          </button>
                        )}
                      </>
                    );
                  })()}
                  <div ref={logsEndRef} />
                </div>
              </Card>
            </div>

            {/* Guidelines panel */}
            <div className="space-y-4">
              <Card className="p-4">
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                  Log Colours
                </h3>
                <ul className="space-y-2 text-xs">
                  <li className="flex items-start gap-2"><span className="w-2 h-2 rounded-full bg-zinc-400 flex-shrink-0 mt-1" /><span className="text-muted-foreground"><strong className="text-zinc-300">White</strong> — normal stdout output from your app.</span></li>
                  <li className="flex items-start gap-2"><span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0 mt-1" /><span className="text-muted-foreground"><strong className="text-red-400">Red</strong> — stderr messages (errors, warnings from Node.js).</span></li>
                  <li className="flex items-start gap-2"><span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0 mt-1" /><span className="text-muted-foreground"><strong className="text-amber-400">Amber</strong> — platform messages (install, start, restart events).</span></li>
                </ul>
              </Card>

              <Card className="p-4">
                <h3 className="text-sm font-semibold mb-3">Common Issues</h3>
                <ul className="space-y-3 text-xs text-muted-foreground">
                  <li>
                    <p className="font-medium text-foreground mb-0.5">App crashes immediately</p>
                    <p>Check your start command in Settings. The default is <code className="bg-muted/40 px-1 rounded font-mono">node index.js</code> — adjust to match your entry file.</p>
                  </li>
                  <li>
                    <p className="font-medium text-foreground mb-0.5">Missing environment variable</p>
                    <p>Add secrets in the <strong>Settings &amp; Env</strong> tab and use <strong>Save &amp; Restart</strong> to apply them without redeploying.</p>
                  </li>
                  <li>
                    <p className="font-medium text-foreground mb-0.5">Port not responding</p>
                    <p>Make your app listen on the <code className="bg-muted/40 px-1 rounded font-mono">PORT</code> environment variable: <code className="bg-muted/40 px-1 rounded font-mono">process.env.PORT</code>.</p>
                  </li>
                  <li>
                    <p className="font-medium text-foreground mb-0.5">Dependency install fails</p>
                    <p>Ensure your <code className="bg-muted/40 px-1 rounded font-mono">package.json</code> is at the root of the repo and the start script is correctly defined.</p>
                  </li>
                </ul>
              </Card>

              <Card className="p-4">
                <h3 className="text-sm font-semibold mb-3">Quick Tips</h3>
                <ul className="space-y-2 text-xs text-muted-foreground list-disc list-inside">
                  <li>Use <strong>Restart</strong> to redeploy from the latest commit.</li>
                  <li>Logs are live — they stream in real time via SSE.</li>
                  <li>The <strong>Clear</strong> button only hides logs in this session; history is preserved.</li>
                  <li>Apps run on Node.js 20. Use <code className="bg-muted/40 px-1 rounded font-mono">.nvmrc</code> or <code className="bg-muted/40 px-1 rounded font-mono">engines</code> in package.json for version hints.</li>
                  <li>Your app is accessible at <code className="bg-muted/40 px-1 rounded font-mono">{app.slug}.nutterxhost.com</code></li>
                </ul>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="deployments" className="mt-0 outline-none">
          <Card className="bg-card border border-border">
            <div className="p-5 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-muted-foreground" />
                <span className="font-medium">Deployment History</span>
                <span className="text-xs text-muted-foreground">(last 50)</span>
              </div>
            </div>
            {loadingDeployments ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : deploymentHistory.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                <History className="w-8 h-8 text-muted-foreground/40" />
                <p className="text-muted-foreground text-sm">No deployments yet. Deploy your app to see history here.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {deploymentHistory.map((d, i) => {
                  const isSuccess = d.status === "success";
                  const isFailed = d.status === "failed";
                  const isBuilding = d.status === "building";
                  const isCancelled = d.status === "cancelled";
                  const durationSec = d.durationMs != null ? (d.durationMs / 1000).toFixed(1) : null;
                  return (
                    <div key={d.id} className="flex items-start gap-4 p-4 hover:bg-muted/20 transition-colors">
                      <div className="mt-0.5 shrink-0">
                        {isSuccess && <CheckCircle2 className="w-5 h-5 text-green-500" />}
                        {isFailed && <XCircle className="w-5 h-5 text-red-500" />}
                        {isBuilding && <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />}
                        {isCancelled && <Ban className="w-5 h-5 text-zinc-500" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={clsx("text-xs font-semibold uppercase tracking-wide", {
                            "text-green-500": isSuccess,
                            "text-red-500": isFailed,
                            "text-blue-400": isBuilding,
                            "text-zinc-400": isCancelled,
                          })}>{d.status}</span>
                          <span className="text-muted-foreground text-xs">·</span>
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <GitBranch className="w-3 h-3" />{d.branch}
                          </span>
                          {d.commitHash && (
                            <>
                              <span className="text-muted-foreground text-xs">·</span>
                              <span className="flex items-center gap-1 text-xs text-muted-foreground font-mono">
                                <GitCommit className="w-3 h-3" />{d.commitHash.slice(0, 7)}
                              </span>
                            </>
                          )}
                          {durationSec && (
                            <>
                              <span className="text-muted-foreground text-xs">·</span>
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Clock className="w-3 h-3" />{durationSec}s
                              </span>
                            </>
                          )}
                        </div>
                        {d.errorMessage && isFailed && (
                          <p className="mt-1 text-xs text-red-400 font-mono truncate">{d.errorMessage}</p>
                        )}
                        <p className="mt-1 text-xs text-muted-foreground">
                          {format(new Date(d.startedAt), "MMM d, yyyy · h:mm a")}
                          {i === 0 && " (latest)"}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="settings" className="mt-0 outline-none">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <Card className="p-6">
                <div className="flex items-start justify-between mb-4 gap-4">
                  <div>
                    <h3 className="text-lg font-bold">Environment Variables</h3>
                    <p className="text-sm text-muted-foreground">Manage secrets and configuration.</p>
                  </div>

                  {!isEditingEnv ? (
                    <Button variant="outline" onClick={handleStartEdit} className="gap-2 flex-shrink-0">
                      <Pencil className="w-4 h-4" /> Edit
                    </Button>
                  ) : (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Button variant="ghost" onClick={handleCancelEdit} disabled={isUpdatingEnv || isSavingAndRestarting} className="gap-2 text-muted-foreground">
                        <X className="w-4 h-4" /> Cancel
                      </Button>
                      <Button variant="outline" onClick={handleSaveEnv} disabled={isUpdatingEnv || isSavingAndRestarting} className="gap-2">
                        {isUpdatingEnv ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
                      </Button>
                      {isProcessActive && (
                        <Button onClick={handleSaveAndRestart} disabled={isSavingAndRestarting || isUpdatingEnv} className="gap-2 bg-amber-600 hover:bg-amber-700 text-white">
                          {isSavingAndRestarting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                          Save & Restart
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                {isEditingEnv && isProcessActive && (
                  <div className="flex items-start gap-2 text-sm text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2.5 mb-5">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>Your app is live. Use <strong>Save & Restart</strong> to apply changes immediately.</span>
                  </div>
                )}

                {!isEditingEnv ? (
                  /* Read-only view */
                  <div className="space-y-2">
                    {envForm.length === 0 ? (
                      <p className="text-sm text-muted-foreground italic">No environment variables configured.</p>
                    ) : (
                      envForm.map((ev, i) => (
                        <div key={i} className="flex items-center gap-3 font-mono text-sm bg-black/20 border border-border rounded-md px-3 py-2">
                          <span className="text-primary font-medium flex-1 truncate">{ev.key}</span>
                          <span className="text-muted-foreground text-xs select-none">••••••••</span>
                        </div>
                      ))
                    )}
                    <Button variant="outline" onClick={handleStartEdit} className="w-full border-dashed mt-2 gap-2">
                      <Pencil className="w-3.5 h-3.5" /> Edit Variables
                    </Button>
                  </div>
                ) : (
                  /* Edit mode */
                  <div className="space-y-3">
                    {envForm.map((ev, i) => (
                      <div key={i} className="flex items-start gap-3">
                        <Input
                          placeholder="KEY"
                          value={ev.key}
                          onChange={e => { const n = [...envForm]; n[i] = { ...n[i], key: e.target.value }; setEnvForm(n); }}
                          className="font-mono text-sm bg-black/20 flex-1"
                        />
                        <Input
                          placeholder="VALUE"
                          value={ev.value}
                          onChange={e => { const n = [...envForm]; n[i] = { ...n[i], value: e.target.value }; setEnvForm(n); }}
                          className="font-mono text-sm bg-black/20 flex-[2]"
                        />
                        <Button variant="ghost" size="icon" onClick={() => setEnvForm(envForm.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-destructive flex-shrink-0">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                    <Button variant="outline" onClick={() => setEnvForm([...envForm, { key: "", value: "" }])} className="w-full border-dashed mt-2">
                      + Add Variable
                    </Button>
                  </div>
                )}
              </Card>

              <Card className="p-6 border-destructive/20 bg-destructive/5">
                <h3 className="text-lg font-bold text-destructive mb-1">Danger Zone</h3>
                <p className="text-sm text-muted-foreground mb-6">These actions are permanent and cannot be undone.</p>

                <div className="border border-destructive/20 rounded-lg p-4 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">Delete this application</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Removes the app, all logs, and configuration permanently.</p>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="flex-shrink-0 gap-2"
                    onClick={() => { setDeleteConfirmName(""); setIsDeleteDialogOpen(true); }}
                  >
                    <Trash2 className="w-4 h-4" /> Delete App
                  </Button>
                </div>

                <Dialog open={isDeleteDialogOpen} onOpenChange={(open) => { setIsDeleteDialogOpen(open); if (!open) setDeleteConfirmName(""); }}>
                  <DialogContent className="border-destructive/30 sm:max-w-md">
                    <DialogHeader>
                      <DialogTitle className="text-destructive">Delete application</DialogTitle>
                      <DialogDescription className="pt-1">
                        This action <strong>cannot be undone</strong>. This will permanently delete the{" "}
                        <strong className="text-foreground">{app.name}</strong> application, all its logs, and configuration.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="mt-2 space-y-3">
                      <p className="text-sm text-muted-foreground">
                        Please type <strong className="font-mono text-foreground">{app.name}</strong> to confirm.
                      </p>
                      <Input
                        placeholder={app.name}
                        value={deleteConfirmName}
                        onChange={(e) => setDeleteConfirmName(e.target.value)}
                        className="font-mono bg-black/30 border-destructive/30 focus-visible:border-destructive/60 focus-visible:ring-destructive/20"
                        onKeyDown={(e) => e.key === "Enter" && deleteConfirmName === app.name && handleDelete()}
                        autoFocus
                      />
                    </div>
                    <DialogFooter className="mt-4 gap-2">
                      <Button variant="outline" onClick={() => { setIsDeleteDialogOpen(false); setDeleteConfirmName(""); }}>
                        Cancel
                      </Button>
                      <Button
                        variant="destructive"
                        disabled={deleteConfirmName !== app.name}
                        onClick={handleDelete}
                        className="gap-2"
                      >
                        <Trash2 className="w-4 h-4" /> Delete this application
                      </Button>
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
