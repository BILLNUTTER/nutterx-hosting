import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Terminal, ArrowLeft, Loader2, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [preferredPassword, setPreferredPassword] = useState("");
  const [confirmPreferred, setConfirmPreferred] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (preferredPassword !== confirmPreferred) {
      toast({ title: "Passwords don't match", description: "Your preferred passwords must match.", variant: "destructive" });
      return;
    }
    if (preferredPassword.length < 8) {
      toast({ title: "Password too short", description: "Preferred password must be at least 8 characters.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, preferredPassword }),
      });
      const data = await res.json() as { message?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      setSubmitted(true);
    } catch (err: any) {
      toast({ title: "Request failed", description: err.message, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Brand */}
        <div className="flex items-center gap-2 mb-8">
          <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/25 flex items-center justify-center">
            <Terminal className="w-4 h-4 text-primary" />
          </div>
          <span className="font-bold">Nutterx Hosting</span>
        </div>

        {submitted ? (
          <div className="text-center py-8">
            <div className="w-14 h-14 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center mx-auto mb-5">
              <CheckCircle2 className="w-7 h-7 text-green-500" />
            </div>
            <h2 className="text-xl font-bold">Request submitted</h2>
            <p className="text-muted-foreground text-sm mt-2 max-w-sm mx-auto">
              Your password reset request has been sent to the admin. Once approved, your account password will be updated — usually within 24 hours.
            </p>
            <Link href="/login">
              <Button variant="outline" className="mt-6 gap-2">
                <ArrowLeft className="w-4 h-4" /> Back to sign in
              </Button>
            </Link>
          </div>
        ) : (
          <>
            <div className="mb-6">
              <h1 className="text-2xl font-bold tracking-tight">Reset your password</h1>
              <p className="text-muted-foreground text-sm mt-1">
                Enter your email and your preferred new password. The admin will review and apply it.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  required
                  className="h-11 bg-card border-border"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="preferred">Preferred new password</Label>
                <Input
                  id="preferred"
                  type="password"
                  placeholder="••••••••"
                  required
                  minLength={8}
                  className="h-11 bg-card border-border"
                  value={preferredPassword}
                  onChange={(e) => setPreferredPassword(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirmPreferred">Confirm new password</Label>
                <Input
                  id="confirmPreferred"
                  type="password"
                  placeholder="••••••••"
                  required
                  minLength={8}
                  className="h-11 bg-card border-border"
                  value={confirmPreferred}
                  onChange={(e) => setConfirmPreferred(e.target.value)}
                />
                {confirmPreferred && preferredPassword !== confirmPreferred && (
                  <p className="text-xs text-destructive">Passwords don't match.</p>
                )}
              </div>

              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Your preferred password will be visible to the admin for review. Choose something you want but haven't used elsewhere.
                </p>
              </div>

              <Button
                type="submit"
                className="w-full h-11"
                disabled={isSubmitting || (!!confirmPreferred && preferredPassword !== confirmPreferred)}
              >
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Submit Reset Request"}
              </Button>
            </form>

            <p className="mt-5 text-center text-sm text-muted-foreground">
              Remembered it?{" "}
              <Link href="/login" className="text-primary hover:underline font-medium">
                Sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
