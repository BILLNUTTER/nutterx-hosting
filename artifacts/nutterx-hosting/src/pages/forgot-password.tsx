import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, CheckCircle2, KeyRound, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NutterxLogo } from "@/components/NutterxLogo";

export default function ForgotPassword() {
  const [email, setEmail] = useState(""); const [done, setDone] = useState(false); const [pending, setPending] = useState(false);
  const submit = (e: React.FormEvent) => { e.preventDefault(); setPending(true); window.setTimeout(() => { setPending(false); setDone(true); }, 700); };
  return <main className="min-h-[100dvh] nx-shell nx-grid flex items-center justify-center p-5"><div className="nx-panel w-full max-w-md rounded-2xl p-7 sm:p-9">
    <Link href="/login" className="mb-10 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground" data-testid="link-back-login"><ArrowLeft className="h-4 w-4" /> Back to sign in</Link>
    {done ? <div className="py-8 text-center"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 text-primary"><CheckCircle2 /></div><p className="nx-kicker mt-7 text-primary">Request received</p><h1 className="mt-2 text-2xl font-semibold">Check your inbox.</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">If an account exists for {email}, we sent reset instructions. They should arrive shortly.</p><Link href="/login" data-testid="link-reset-back"><Button variant="outline" className="mt-7 gap-2"><ArrowLeft className="h-4 w-4" /> Return to sign in</Button></Link></div> :
      <><div className="mb-8"><NutterxLogo size={32} /><p className="nx-kicker mt-7">Account recovery</p><h1 className="mt-2 text-3xl font-semibold">Reset your access.</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">Enter your workspace email and we’ll send a secure reset request.</p></div><form onSubmit={submit} className="space-y-5"><div><label className="mb-1.5 block text-sm font-medium">Email address</label><div className="relative"><Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input data-testid="input-reset-email" required type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@studio.dev" className="h-11 bg-background/60 pl-10" /></div></div><div className="rounded-xl border border-accent/20 bg-accent/5 p-3 text-xs leading-5 text-muted-foreground"><KeyRound className="mr-2 inline h-4 w-4 text-accent" />For security, reset requests are reviewed before access is changed.</div><Button className="h-11 w-full gap-2" disabled={pending} data-testid="button-submit-reset">{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send reset request"}</Button></form></>}
  </div></main>;
}