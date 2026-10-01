import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowRight, Check, Eye, EyeOff, Github, Loader2, LockKeyhole, Mail, ShieldCheck, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { NutterxLogo } from "@/components/NutterxLogo";

export default function Login() {
  const { login, signup, user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [mode, setMode] = useState(new URLSearchParams(window.location.search).get("tab") === "signup" ? "signup" : "login");
  const [email, setEmail] = useState(""); const [phone, setPhone] = useState(""); const [password, setPassword] = useState(""); const [confirm, setConfirm] = useState(""); const [show, setShow] = useState(false); const [pending, setPending] = useState(false);
  useEffect(() => { if (user) setLocation("/dashboard"); }, [user, setLocation]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (mode === "signup" && password !== confirm) { toast({ title: "Passwords do not match", description: "Check both password fields.", variant: "destructive" }); return; }
    setPending(true);
    try {
      if (mode === "login") await login({ email, password });
      else await signup({ email, phone, password });
    } catch {
      // useAuth already shows the API error toast; consume it here so failed
      // submissions do not become unhandled browser promise rejections.
    } finally {
      setPending(false);
    }
  };
  return <main className="min-h-[100dvh] nx-shell nx-grid grid lg:grid-cols-[1.1fr_.9fr]">
    <section className="relative hidden overflow-hidden border-r border-border/70 p-12 lg:flex lg:flex-col lg:justify-between xl:p-20">
      <div><Link href="/" className="flex items-center gap-2" data-testid="link-auth-brand"><NutterxLogo size={30} /><span className="font-semibold tracking-tight">nutterx<span className="text-primary">/</span>host</span></Link>
        <div className="mt-28 max-w-xl"><p className="nx-kicker text-primary">Private infrastructure for public ambition</p><h1 className="mt-5 text-5xl font-semibold leading-[1.04] tracking-tight xl:text-6xl">Your code.<br /><span className="text-primary">A clearer runway.</span></h1><p className="mt-6 max-w-md text-base leading-7 text-muted-foreground">Deploy repositories, inspect the process, and make changes without leaving your flow.</p></div>
      </div>
      <div className="grid max-w-lg grid-cols-2 gap-3 text-sm"><Trust text="Live process logs" /><Trust text="Encrypted variables" /><Trust text="One-click restarts" /><Trust text="Isolated workspaces" /></div>
    </section>
    <section className="flex items-center justify-center p-5 sm:p-10"><div className="w-full max-w-md">
      <div className="mb-10 flex items-center gap-2 lg:hidden"><NutterxLogo size={28} /><span className="font-semibold">nutterx/host</span></div>
      <div className="mb-8"><p className="nx-kicker">{mode === "login" ? "Welcome back" : "Open a workspace"}</p><h2 className="mt-3 text-3xl font-semibold tracking-tight">{mode === "login" ? "Sign in to your control room." : "Ship your first app."}</h2><p className="mt-2 text-sm text-muted-foreground">{mode === "login" ? "Your deploys are waiting." : "No credit card. Just a repository and a good idea."}</p></div>
      <div className="mb-6 grid grid-cols-2 rounded-xl border border-border bg-card/60 p-1"><button onClick={() => setMode("login")} className={`rounded-lg py-2 text-sm ${mode === "login" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`} data-testid="button-mode-login">Sign in</button><button onClick={() => setMode("signup")} className={`rounded-lg py-2 text-sm ${mode === "signup" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`} data-testid="button-mode-signup">Create account</button></div>
      <form onSubmit={submit} className="space-y-4">
        <Field icon={Mail} label="Email" value={email} onChange={setEmail} type="email" placeholder="you@studio.dev" testId="input-email" />
        {mode === "signup" && <Field icon={Terminal} label="Phone (optional)" value={phone} onChange={setPhone} type="tel" placeholder="+254 700 000 000" testId="input-phone" />}
        <div><label className="mb-1.5 block text-sm font-medium">Password</label><div className="relative"><LockKeyhole className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input data-testid="input-password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)} type={show ? "text" : "password"} placeholder="Minimum 8 characters" className="h-11 bg-card/70 pl-10 pr-10" /><button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-3 text-muted-foreground" data-testid="button-toggle-password">{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div></div>
        {mode === "signup" && <Field icon={LockKeyhole} label="Confirm password" value={confirm} onChange={setConfirm} type={show ? "text" : "password"} placeholder="Repeat your password" testId="input-confirm-password" />}
        <Button className="h-11 w-full gap-2" disabled={pending} data-testid="button-submit-auth">{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <>{mode === "login" ? "Enter workspace" : "Create workspace"}<ArrowRight className="h-4 w-4" /></>}</Button>
      </form>
      {mode === "login" && <Link href="/forgot-password" className="mt-5 block text-center text-sm text-muted-foreground hover:text-primary" data-testid="link-forgot-password">Forgot your password?</Link>}
      <p className="mt-10 border-t border-border pt-5 text-center text-xs text-muted-foreground"><Github className="mr-1 inline h-3.5 w-3.5" /> Repositories stay yours. Nutterx just keeps them moving.</p>
    </div></section>
  </main>;
}
function Trust({ text }: { text: string }) { return <div className="flex items-center gap-2 text-muted-foreground"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-primary"><Check className="h-3 w-3" /></span>{text}</div>; }
function Field({ icon: Icon, label, value, onChange, type, placeholder, testId }: { icon: typeof Mail; label: string; value: string; onChange: (value: string) => void; type: string; placeholder: string; testId: string }) { return <div><label className="mb-1.5 block text-sm font-medium">{label}</label><div className="relative"><Icon className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input data-testid={testId} required={label === "Email"} value={value} onChange={e => onChange(e.target.value)} type={type} placeholder={placeholder} className="h-11 bg-card/70 pl-10" /></div></div>; }