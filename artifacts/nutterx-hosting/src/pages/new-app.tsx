import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { useCreateApp } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import {
  Github, Terminal, ArrowRight, ArrowLeft,
  Plus, Trash2, Rocket, Loader2, Wand2,
  CheckCircle2, Info
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function NewApp() {
  const [step, setStep] = useState(1);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // Form State
  const [name, setName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [startCommand, setStartCommand] = useState("");
  const [installCommand, setInstallCommand] = useState("");
  const [port, setPort] = useState("");
  const [autoRestart, setAutoRestart] = useState(true);
  const [envVars, setEnvVars] = useState<Array<{ key: string; value: string; comment?: string }>>([]);

  // Loading / status state
  const [isFetchingMeta, setIsFetchingMeta] = useState(false);
  const [isFetchingEnv, setIsFetchingEnv] = useState(false);
  const [envFetchStatus, setEnvFetchStatus] = useState<"idle" | "found" | "not_found" | "error">("idle");
  const [envFetchSource, setEnvFetchSource] = useState<string>(".env.example");
  const [isDeploying, setIsDeploying] = useState(false);

  const { mutateAsync: createApp } = useCreateApp();

  const getToken = () => localStorage.getItem("access_token") ?? "";

  const fetchEnvTemplate = async () => {
    if (!repoUrl) return;
    setIsFetchingEnv(true);
    setEnvFetchStatus("idle");
    try {
      const params = new URLSearchParams({ repoUrl });
      const resp = await fetch(`/api/apps/env-template?${params}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (resp.ok) {
        const data = await resp.json();
        const keys: Array<{ key: string; defaultValue: string; comment?: string | null }> = data.keys ?? [];
        setEnvVars(keys.map((k) => ({ key: k.key, value: k.defaultValue || "", comment: k.comment ?? undefined })));
        setEnvFetchSource(data.source ?? ".env.example");
        setEnvFetchStatus("found");
      } else if (resp.status === 404) {
        setEnvFetchStatus("not_found");
        // Auto-add one blank row so they can start typing immediately
        setEnvVars([{ key: "", value: "" }]);
      } else {
        setEnvFetchStatus("error");
        setEnvVars([{ key: "", value: "" }]);
      }
    } catch {
      setEnvFetchStatus("error");
      setEnvVars([{ key: "", value: "" }]);
    } finally {
      setIsFetchingEnv(false);
    }
  };

  const fetchRepoMeta = async (silent = false) => {
    if (!repoUrl) return;
    setIsFetchingMeta(true);
    try {
      const params = new URLSearchParams({ repoUrl });
      const resp = await fetch(`/api/apps/repo-meta?${params}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (resp.ok) {
        const meta = await resp.json();
        if (meta.startCommand && !startCommand) setStartCommand(meta.startCommand);
        if (meta.installCommand && !installCommand) setInstallCommand(meta.installCommand);
        if (meta.port && !port) setPort(String(meta.port));
        if (!silent) {
          toast({
            title: "Settings detected",
            description: "Install/start commands pre-filled from package.json.",
          });
        }
      } else if (!silent) {
        toast({
          title: "No package.json found",
          description: "Fill in the commands manually.",
          variant: "destructive",
        });
      }
    } catch {
      if (!silent) toast({ title: "Auto-detect failed", variant: "destructive" });
    } finally {
      setIsFetchingMeta(false);
    }
  };

  const handleNextStep = async () => {
    if (step === 1) {
      if (!name || !repoUrl) {
        toast({
          title: "Missing fields",
          description: "Name and Repo URL are required",
          variant: "destructive",
        });
        return;
      }
      setStep(2);
      // Auto-fetch both env vars and build/run commands in parallel (silent — no toast)
      fetchEnvTemplate();
      fetchRepoMeta(true);
    } else if (step === 2) {
      setStep(3);
    }
  };

  const handleDeploy = async () => {
    if (!name.trim() || !repoUrl.trim()) {
      toast({
        title: "Missing fields",
        description: "App name and repository URL are required.",
        variant: "destructive",
      });
      return;
    }
    setIsDeploying(true);
    try {
      const app = await createApp({
        data: {
          name: name.trim(),
          repoUrl: repoUrl.trim(),
          autoRestart,
          startCommand: startCommand || undefined,
          installCommand: installCommand || undefined,
          port: port ? parseInt(port, 10) : undefined,
        } as any,
      });

      const validEnvVars = envVars.filter((e) => e.key.trim());
      if (validEnvVars.length > 0) {
        await fetch(`/api/apps/${app.id}/env`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${getToken()}`,
          },
          body: JSON.stringify({ envVars: validEnvVars }),
        });
      }

      await fetch(`/api/apps/${app.id}/start`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}` },
      });

      toast({ title: "Deployment started!", description: "Cloning repo and launching your app." });
      setLocation(`/apps/${app.id}`);
    } catch (e: any) {
      toast({
        title: "Deployment failed",
        description: e.message || "An error occurred",
        variant: "destructive",
      });
    } finally {
      setIsDeploying(false);
    }
  };

  const addEnvVar = () => setEnvVars([...envVars, { key: "", value: "" }]);
  const removeEnvVar = (i: number) => setEnvVars(envVars.filter((_, idx) => idx !== i));
  const updateEnvVar = (i: number, field: "key" | "value", val: string) => {
    const next = [...envVars];
    next[i] = { ...next[i], [field]: val };
    setEnvVars(next);
  };

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Deploy New App</h1>
          <p className="text-muted-foreground mt-2">
            Connect a repository and deploy to Nutterx Hosting.
          </p>
        </div>

        {/* Stepper */}
        <div className="flex items-center mb-8 bg-card border border-border p-2 rounded-2xl shadow-sm">
          {[
            { num: 1, label: "Repository" },
            { num: 2, label: "Environment" },
            { num: 3, label: "Deploy" },
          ].map((s, i) => (
            <div key={s.num} className="flex-1 flex items-center">
              <div className={`flex items-center justify-center w-8 h-8 rounded-full font-bold text-sm transition-colors ${step >= s.num ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                {s.num}
              </div>
              <span className={`ml-3 text-sm font-medium hidden sm:block ${step >= s.num ? "text-foreground" : "text-muted-foreground"}`}>
                {s.label}
              </span>
              {i < 2 && <div className={`flex-1 h-px mx-4 ${step > s.num ? "bg-primary" : "bg-border"}`} />}
            </div>
          ))}
        </div>

        <Card className="overflow-hidden bg-card/50 backdrop-blur-xl border-border/50 shadow-xl shadow-black/10">
          <AnimatePresence mode="wait">
            {/* ── Step 1: Repository ── */}
            {step === 1 && (
              <motion.div key="step1" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="p-8 space-y-6">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Application Name *</Label>
                    <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="my-awesome-bot" className="h-11 font-mono text-sm" />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="repo">GitHub Repository URL *</Label>
                    <div className="relative">
                      <Github className="absolute left-3 top-3 w-5 h-5 text-muted-foreground" />
                      <Input id="repo" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} onBlur={() => { if (repoUrl) fetchRepoMeta(true); }} placeholder="https://github.com/username/repo" className="pl-10 h-11" />
                    </div>
                  </div>

                  <div className="pt-4 border-t border-border">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                        <Terminal className="w-4 h-4" /> Build & Run Settings
                      </h3>
                      <Button variant="outline" size="sm" onClick={fetchRepoMeta} disabled={!repoUrl || isFetchingMeta} className="gap-2 text-xs">
                        {isFetchingMeta ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                        Auto-detect from repo
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="installCmd">Install Command</Label>
                        <Input id="installCmd" value={installCommand} onChange={(e) => setInstallCommand(e.target.value)} placeholder="npm install (auto-detected if blank)" className="font-mono text-sm" />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="startCmd">Start Command</Label>
                        <Input id="startCmd" value={startCommand} onChange={(e) => setStartCommand(e.target.value)} placeholder="npm start (auto-detected if blank)" className="font-mono text-sm" />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="port">Port</Label>
                        <Input id="port" type="number" value={port} onChange={(e) => setPort(e.target.value)} placeholder="3000" className="font-mono text-sm" />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end pt-4">
                  <Button size="lg" onClick={handleNextStep} className="gap-2 group">
                    Next: Environment Variables
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </Button>
                </div>
              </motion.div>
            )}

            {/* ── Step 2: Environment Variables ── */}
            {step === 2 && (
              <motion.div key="step2" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="p-8">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-xl font-semibold">Environment Variables</h2>
                    <p className="text-sm text-muted-foreground mt-1">
                      Secrets and config values your app needs at runtime.
                    </p>
                  </div>
                  {isFetchingEnv && <Loader2 className="w-5 h-5 text-primary animate-spin" />}
                </div>

                {/* Status banners */}
                {envFetchStatus === "found" && (
                  <div className="mb-5 p-3 bg-green-500/10 border border-green-500/20 text-green-300 rounded-lg text-sm flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>
                      Found <strong>{envFetchSource}</strong> in the repository — required variables are listed below. Fill in your values.
                    </span>
                  </div>
                )}

                {envFetchStatus === "not_found" && (
                  <div className="mb-5 p-3 bg-blue-500/10 border border-blue-500/20 text-blue-300 rounded-lg text-sm flex items-start gap-2">
                    <Info className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>
                      No <strong>.env.example</strong> found in this repo. If your app needs secrets (API keys, database URLs, etc.), add them below.
                    </span>
                  </div>
                )}

                {envFetchStatus === "error" && (
                  <div className="mb-5 p-3 bg-yellow-500/10 border border-yellow-500/20 text-yellow-200 rounded-lg text-sm flex items-start gap-2">
                    <Info className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>
                      Could not reach the repository to load env keys. Add any required variables manually below.
                    </span>
                  </div>
                )}

                {/* Env var rows */}
                <div className="space-y-3 mb-4 max-h-[380px] overflow-y-auto pr-1">
                  {envVars.length === 0 && isFetchingEnv && (
                    <div className="text-center py-8 text-muted-foreground">
                      <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                      Reading config…
                    </div>
                  )}
                  {envVars.map((ev, i) => (
                    <div key={i} className="space-y-1">
                      {ev.comment && (
                        <p className="text-xs text-muted-foreground pl-1 flex items-center gap-1">
                          <Info className="w-3 h-3 shrink-0" />
                          {ev.comment}
                        </p>
                      )}
                      <div className="flex items-center gap-2">
                        <Input
                          placeholder="VARIABLE_NAME"
                          value={ev.key}
                          onChange={(e) => updateEnvVar(i, "key", e.target.value)}
                          className="flex-1 font-mono text-sm bg-black/20"
                        />
                        <Input
                          placeholder="value"
                          value={ev.value}
                          onChange={(e) => updateEnvVar(i, "value", e.target.value)}
                          className="flex-[2] font-mono text-sm bg-black/20"
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeEnvVar(i)}
                          className="shrink-0 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>

                <Button variant="outline" onClick={addEnvVar} className="w-full border-dashed mb-8 gap-2">
                  <Plus className="w-4 h-4" /> Add Variable
                </Button>

                <div className="flex justify-between pt-6 border-t border-border">
                  <Button variant="ghost" onClick={() => setStep(1)} className="gap-2">
                    <ArrowLeft className="w-4 h-4" /> Back
                  </Button>
                  <Button size="lg" onClick={handleNextStep} className="gap-2 group">
                    Review & Deploy
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </Button>
                </div>
              </motion.div>
            )}

            {/* ── Step 3: Deploy ── */}
            {step === 3 && (
              <motion.div key="step3" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="p-8 text-center">
                <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6 shadow-[0_0_30px_rgba(var(--primary),0.2)]">
                  <Rocket className="w-10 h-10 text-primary" />
                </div>

                <h2 className="text-2xl font-bold mb-2">Ready for Liftoff</h2>
                <p className="text-muted-foreground mb-8 max-w-md mx-auto">
                  Your application <strong>{name}</strong> is ready to be deployed. We will clone the repository, install dependencies, and launch the process.
                </p>

                <div className="bg-black/30 border border-border rounded-xl p-4 text-left max-w-sm mx-auto mb-8 font-mono text-sm space-y-1">
                  {[
                    { label: "Repo", value: repoUrl.split("/").pop() ?? repoUrl },
                    { label: "Env Vars", value: `${envVars.filter((e) => e.key.trim()).length} keys` },
                    ...(installCommand ? [{ label: "Install", value: installCommand }] : []),
                    ...(startCommand ? [{ label: "Start", value: startCommand }] : []),
                    { label: "Auto Restart", value: autoRestart ? "Enabled" : "Disabled" },
                  ].map(({ label, value }, i, arr) => (
                    <div key={label} className={`flex justify-between py-1 ${i < arr.length - 1 ? "border-b border-white/5" : ""}`}>
                      <span className="text-zinc-500">{label}</span>
                      <span className={`truncate ml-4 ${label === "Auto Restart" ? (autoRestart ? "text-green-400" : "text-zinc-500") : "text-zinc-200"}`}>
                        {value}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-center gap-4 mb-8">
                  <Label htmlFor="autoRestart" className="cursor-pointer">Keep process alive on crash</Label>
                  <Switch id="autoRestart" checked={autoRestart} onCheckedChange={setAutoRestart} />
                </div>

                <div className="flex justify-between pt-6 border-t border-border">
                  <Button variant="ghost" onClick={() => setStep(2)} disabled={isDeploying} className="gap-2">
                    <ArrowLeft className="w-4 h-4" /> Back
                  </Button>
                  <Button size="lg" onClick={handleDeploy} disabled={isDeploying} className="gap-2 w-48 shadow-[0_0_20px_rgba(var(--primary),0.3)] hover:shadow-[0_0_30px_rgba(var(--primary),0.5)] transition-all">
                    {isDeploying ? <Loader2 className="w-5 h-5 animate-spin" /> : <Rocket className="w-5 h-5" />}
                    Deploy App
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>
      </div>
    </AppLayout>
  );
}
