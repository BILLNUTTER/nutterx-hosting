import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowRight, Loader2 } from "lucide-react";
import { NutterxLogo } from "@/components/NutterxLogo";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "@/hooks/use-toast";

export default function Login() {
  const [, location] = useLocation();
  const searchParams = new URLSearchParams(
    typeof window !== "undefined" ? window.location.search : ""
  );
  const [isLogin, setIsLogin] = useState(searchParams.get("tab") !== "signup");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const { login, signup, user } = useAuth();
  const [, setLocation] = useLocation();

  // Redirect if already logged in
  useEffect(() => {
    if (user) setLocation("/dashboard");
  }, [user, setLocation]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLogin && password !== confirmPassword) {
      toast({ title: "Passwords don't match", description: "Please check your confirm password.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      if (isLogin) {
        await login({ email, password });
      } else {
        await signup({ email, phone, password });
      }
    } catch {
      // Handled by AuthProvider toast
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-background relative overflow-hidden">
      {/* Left panel */}
      <div className="hidden lg:flex lg:flex-1 flex-col justify-center px-16 bg-card border-r border-border relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-primary/8 blur-[140px] rounded-full" />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:48px_48px]" />
        </div>

        <div className="relative z-10 space-y-8 max-w-md">
          <div className="flex items-center gap-3">
            <NutterxLogo size={48} />
            <div>
              <span className="font-bold text-xl tracking-tight">Nutterx</span>
              <span className="ml-2 text-[9px] font-mono text-primary uppercase tracking-widest bg-primary/10 border border-primary/20 px-1.5 py-0.5 rounded-full">Hosting</span>
            </div>
          </div>

          <div>
            <h1 className="text-4xl font-extrabold tracking-tight leading-tight">
              Deploy any GitHub repo.<br />
              <span className="text-primary">No DevOps required.</span>
            </h1>
            <p className="mt-4 text-muted-foreground leading-relaxed">
              Paste a GitHub URL, configure env vars, and stream real-time logs — all from your browser.
            </p>
          </div>

          <div className="space-y-3">
            {[
              "Clone → Install → Run, automatically",
              "Real-time log streaming via SSE",
              "Encrypted environment variables",
              "Multi-user, isolated workspaces",
              "Auto-restart on crashes",
            ].map((item) => (
              <div key={item} className="flex items-center gap-3 text-sm text-muted-foreground">
                <div className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex flex-col justify-center px-4 sm:px-8 lg:max-w-[560px] relative z-10">
        <div className="w-full max-w-md mx-auto">
          {/* Mobile brand */}
          <div className="flex items-center gap-2.5 mb-10 lg:hidden">
            <NutterxLogo size={36} />
            <span className="font-bold text-lg">Nutterx Hosting</span>
          </div>

          {/* Toggle */}
          <div className="flex bg-card border border-border rounded-xl p-1 mb-8">
            <button
              onClick={() => setIsLogin(true)}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${isLogin ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              Sign In
            </button>
            <button
              onClick={() => setIsLogin(false)}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${!isLogin ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              Create Account
            </button>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={isLogin ? "login" : "signup"}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
            >
              <div className="mb-6">
                <h2 className="text-2xl font-bold tracking-tight">
                  {isLogin ? "Welcome back" : "Create your account"}
                </h2>
                <p className="text-muted-foreground text-sm mt-1">
                  {isLogin
                    ? "Sign in to manage your deployed applications."
                    : "Start deploying apps in seconds. It's free."}
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
                    className="h-11 bg-card border-border focus-visible:border-primary/50 focus-visible:ring-primary/20"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>

                {!isLogin && (
                  <div className="space-y-1.5">
                    <Label htmlFor="phone">Phone number</Label>
                    <Input
                      id="phone"
                      type="tel"
                      placeholder="+1 234 567 8900"
                      required
                      className="h-11 bg-card border-border focus-visible:border-primary/50 focus-visible:ring-primary/20"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    required
                    minLength={8}
                    className="h-11 bg-card border-border focus-visible:border-primary/50 focus-visible:ring-primary/20"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>

                {!isLogin && (
                  <div className="space-y-1.5">
                    <Label htmlFor="confirmPassword">Confirm password</Label>
                    <Input
                      id="confirmPassword"
                      type="password"
                      placeholder="••••••••"
                      required
                      minLength={8}
                      className="h-11 bg-card border-border focus-visible:border-primary/50 focus-visible:ring-primary/20"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                    />
                    {confirmPassword && password !== confirmPassword && (
                      <p className="text-xs text-destructive">Passwords don't match.</p>
                    )}
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full h-11 text-sm font-medium shadow-lg shadow-primary/20 group"
                  disabled={isSubmitting || (!isLogin && !!confirmPassword && password !== confirmPassword)}
                >
                  {isSubmitting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      {isLogin ? "Sign In" : "Create Account"}
                      <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-0.5 transition-transform" />
                    </>
                  )}
                </Button>
              </form>

              <p className="mt-5 text-center text-sm text-muted-foreground">
                {isLogin ? "Don't have an account? " : "Already have an account? "}
                <button
                  type="button"
                  onClick={() => setIsLogin(!isLogin)}
                  className="text-primary hover:underline font-medium"
                >
                  {isLogin ? "Sign up free" : "Sign in"}
                </button>
              </p>

              {isLogin && (
                <p className="mt-3 text-center text-sm text-muted-foreground">
                  Forgot your password?{" "}
                  <Link href="/forgot-password" className="text-primary hover:underline font-medium">
                    Request a reset
                  </Link>
                </p>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
