import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, Github, Loader2, Plus, Rocket, Trash2 } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { getGetEnvTemplateQueryKey, useCreateApp, useGetEnvTemplate, useStartApp, useUpdateEnvVars } from "@workspace/api-client-react";

type Env = { key: string; value: string };
type RepoMeta = {
  startCommand: string | null;
  buildCommand: string | null;
  installCommand: string | null;
  port: number | null;
  scripts: string[];
};

export default function NewApp() {
  const [, setLocation] = useLocation(); const { toast } = useToast(); const [step, setStep] = useState(1);
  const [name, setName] = useState(""); const [repoUrl, setRepoUrl] = useState(""); const autoRestart = true; const [envVars, setEnvVars] = useState<Env[]>([]);
  const repoParams = useMemo(() => ({ repoUrl: repoUrl.trim() }), [repoUrl]);
  const loadedEnvTemplateFor = useRef("");
  const envQuery = useGetEnvTemplate(repoParams, { query: { queryKey: getGetEnvTemplateQueryKey(repoParams), enabled: step === 2 && Boolean(repoParams.repoUrl), retry: false, staleTime: 300_000 } });
  const repoMeta = useQuery({
    queryKey: ["/api/apps/repo-meta", repoParams.repoUrl],
    enabled: step === 2 && Boolean(repoParams.repoUrl),
    retry: false,
    staleTime: 300_000,
    queryFn: async (): Promise<RepoMeta> => {
      const params = new URLSearchParams({ repoUrl: repoParams.repoUrl });
      const response = await fetch(`/api/apps/repo-meta?${params.toString()}`);
      const body = await response.json() as RepoMeta | { error?: string };
      if (!response.ok) {
        throw new Error("error" in body ? body.error ?? "Could not inspect repository" : "Could not inspect repository");
      }
      return body as RepoMeta;
    },
  });
  const create = useCreateApp(); const updateEnv = useUpdateEnvVars(); const start = useStartApp();
  useEffect(() => {
    loadedEnvTemplateFor.current = "";
    setEnvVars([]);
  }, [repoUrl]);
  useEffect(() => {
    if (step !== 2 || !envQuery.data || loadedEnvTemplateFor.current === repoParams.repoUrl) return;
    loadedEnvTemplateFor.current = repoParams.repoUrl;
    setEnvVars(envQuery.data.keys.map(key => ({ key: key.key, value: key.defaultValue ?? "" })));
  }, [step, envQuery.data, repoParams.repoUrl]);
  const next = () => { if (step === 1 && (!name.trim() || !repoUrl.trim())) { toast({ title: "Name and repository are required", variant: "destructive" }); return; } setStep(s => Math.min(3, s + 1)); };
  const deploy = () => {
    create.mutate({ data: { name: name.trim(), repoUrl: repoUrl.trim(), autoRestart, startCommand: repoMeta.data?.startCommand ?? undefined, installCommand: repoMeta.data?.installCommand ?? undefined, port: repoMeta.data?.port ?? undefined } }, {
      onSuccess: (app) => {
        const clean = envVars.filter(row => row.key.trim());
        const finish = () => start.mutate(
          { id: app.id },
          {
            onSuccess: () => {
              toast({ title: "Deployment started", description: "Your app is moving from repository to runtime." });
              setLocation(`/apps/${app.id}`);
            },
            onError: () => setLocation(`/apps/${app.id}`),
          },
        );
        if (clean.length) updateEnv.mutate({ id: app.id, data: { envVars: clean } }, {
          onSuccess: finish,
          onError: () => {
            toast({ title: "App created, but variables were not saved", description: "Open Settings & Env to add them before starting the app.", variant: "destructive" });
            setLocation(`/apps/${app.id}`);
          },
        }); else finish();
      },
      onError: (error) => toast({ title: "Could not create app", description: error.message, variant: "destructive" }),
    });
  };
  const busy = create.isPending || updateEnv.isPending || start.isPending;
  return <AppLayout><div className="mx-auto max-w-4xl nx-enter"><div className="mb-8 flex items-start justify-between gap-4"><div><p className="nx-kicker text-primary">New deployment</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Put a repository in orbit.</h1><p className="mt-2 text-muted-foreground">A few deliberate details, then Nutterx takes the watch.</p></div><Button variant="ghost" onClick={() => setLocation("/dashboard")} className="gap-2" data-testid="button-cancel-deploy"><ArrowLeft className="h-4 w-4" /> Dashboard</Button></div>
    <div className="mb-5 grid grid-cols-3 gap-2">{[["01", "Repository"], ["02", "Environment"], ["03", "Launch"]].map(([n, label], i) => <div key={n} className={`rounded-xl border p-3 ${step > i ? "border-primary/40 bg-primary/10" : "border-border bg-card/40"}`}><div className="flex items-center gap-2"><span className={`font-mono text-xs ${step > i ? "text-primary" : "text-muted-foreground"}`}>{step > i ? <Check className="h-3.5 w-3.5" /> : n}</span><span className="hidden text-sm sm:inline">{label}</span></div></div>)}</div>
    <div className="nx-panel rounded-2xl p-5 sm:p-8">
      {step === 1 && <div className="space-y-7"><div><p className="nx-kicker">Source</p><h2 className="mt-2 text-xl font-semibold">Where should we pull from?</h2></div><div className="grid gap-5 sm:grid-cols-2"><div className="space-y-2 sm:col-span-2"><Label htmlFor="app-name">App name</Label><Input id="app-name" data-testid="input-app-name" value={name} onChange={e => setName(e.target.value)} placeholder="orbit-api" className="h-11 bg-background/50" /></div><div className="space-y-2 sm:col-span-2"><Label htmlFor="repo-url">GitHub repository URL</Label><div className="relative"><Github className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input id="repo-url" data-testid="input-repo-url" value={repoUrl} onChange={e => setRepoUrl(e.target.value)} placeholder="https://github.com/you/your-repository" className="h-11 bg-background/50 pl-10" /></div><p className="text-xs text-muted-foreground">Public repositories are ready immediately. Private access tokens can be added later.</p></div></div><div className="flex justify-end"><Button onClick={next} className="gap-2" data-testid="button-next-runtime">Continue to environment <ArrowRight className="h-4 w-4" /></Button></div></div>}
      {step === 2 && <div className="space-y-7"><div><p className="nx-kicker">Environment</p><h2 className="mt-2 text-xl font-semibold">Add the values your repository needs.</h2></div><div className="rounded-xl border border-border bg-background/40 p-4"><p className="font-medium">Runtime detection</p><p className="mt-1 text-sm text-muted-foreground">{repoMeta.isFetching ? "Reading package.json and repository settings…" : repoMeta.data ? `Start: ${repoMeta.data.startCommand ?? "automatic fallback"} · Install: ${repoMeta.data.installCommand ?? "detected from lockfile"} · Port: ${repoMeta.data.port ?? "assigned automatically"}` : repoMeta.isError ? "Could not read package.json. Nutterx will inspect the cloned repository and use automatic defaults." : "Runtime commands and port are detected from your repository."}</p></div><div className="border-t border-border pt-6"><div className="flex items-center justify-between"><div><p className="font-medium">Environment variables</p><p className="mt-1 text-sm text-muted-foreground">{envQuery.isFetching ? "Checking repository environment templates…" : envQuery.isError ? "Could not fetch a template. Add the required keys manually." : envQuery.data?.keys?.length ? "Keys detected from the repository. Enter their values before deploy." : "Add runtime values if your app needs them."}</p></div><Button variant="outline" size="sm" onClick={() => setEnvVars([...envVars, { key: "", value: "" }])} className="gap-1.5"><Plus className="h-3.5 w-3.5" /> Add</Button></div><div className="mt-4 space-y-2">{envVars.map((row, i) => <div key={i} className="grid grid-cols-[1fr_1.4fr_auto] gap-2"><Input aria-label={`Environment key ${i + 1}`} value={row.key} onChange={e => setEnvVars(envVars.map((x, j) => j === i ? { ...x, key: e.target.value } : x))} placeholder="KEY" className="font-mono text-xs" /><Input aria-label={`Environment value ${i + 1}`} value={row.value} onChange={e => setEnvVars(envVars.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} placeholder="value" className="font-mono text-xs" /><Button variant="ghost" size="icon" onClick={() => setEnvVars(envVars.filter((_, j) => j !== i))} aria-label={`Remove environment variable ${i + 1}`}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button></div>)}</div></div><div className="flex justify-between"><Button variant="ghost" onClick={() => setStep(1)} className="gap-2"><ArrowLeft className="h-4 w-4" /> Back</Button><Button onClick={next} disabled={repoMeta.isFetching || envQuery.isFetching} className="gap-2" data-testid="button-next-launch">Review launch <ArrowRight className="h-4 w-4" /></Button></div></div>}
      {step === 3 && <div className="space-y-8"><div className="text-center"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 text-primary"><Rocket className="h-7 w-7" /></div><p className="nx-kicker mt-6 text-primary">Launch review</p><h2 className="mt-2 text-2xl font-semibold">Ready when you are.</h2><p className="mt-2 text-sm text-muted-foreground">Nutterx will detect runtime settings, install dependencies, and start the app.</p></div><div className="divide-y divide-border rounded-xl border border-border bg-background/40">{[["Application", name], ["Repository", repoUrl.replace("https://github.com/", "")], ["Runtime", repoMeta.data?.startCommand ?? "Automatic detection"], ["Install", repoMeta.data?.installCommand ?? "Detected from repository files"], ["Port", repoMeta.data?.port ? String(repoMeta.data.port) : "Assigned automatically"], ["Environment", `${envVars.filter(e => e.key.trim()).length} variables`]].map(([label, value]) => <div key={label} className="flex items-center justify-between gap-4 px-4 py-3 text-sm"><span className="text-muted-foreground">{label}</span><span className="max-w-[65%] truncate text-right font-mono text-xs">{value}</span></div>)}</div><div className="flex justify-between"><Button variant="ghost" onClick={() => setStep(2)} disabled={busy} className="gap-2"><ArrowLeft className="h-4 w-4" /> Back</Button><Button onClick={deploy} disabled={busy} className="gap-2 px-6" data-testid="button-deploy-app">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />} {busy ? "Starting…" : "Deploy app"}</Button></div></div>}
    </div></div></AppLayout>;
}