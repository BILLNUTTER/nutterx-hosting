import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Terminal, ArrowRight, Loader2, Github } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function Login() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const { login, signup } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      if (isLogin) {
        await login({ email, password });
      } else {
        await signup({ email, password });
      }
    } catch (err) {
      // Handled by AuthProvider toast
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-background relative overflow-hidden">
      {/* Background image half */}
      <div className="hidden lg:block lg:flex-1 relative">
        <div className="absolute inset-0 bg-gradient-to-r from-background to-transparent z-10" />
        <img 
          className="absolute inset-0 h-full w-full object-cover opacity-60" 
          src={`${import.meta.env.BASE_URL}images/terminal-bg.png`} 
          alt="Terminal Background" 
        />
        <div className="absolute inset-0 flex items-center justify-center z-20 px-20">
          <div className="space-y-6 max-w-lg">
            <h1 className="text-5xl font-bold tracking-tight text-white">Deploy anything in seconds.</h1>
            <p className="text-lg text-zinc-400 font-mono">Push your code. We handle the containers, routing, and logs.</p>
            <div className="flex gap-4">
              <div className="h-1 w-20 bg-primary rounded-full shadow-[0_0_10px_rgba(var(--primary),0.8)]" />
              <div className="h-1 w-12 bg-white/20 rounded-full" />
              <div className="h-1 w-12 bg-white/20 rounded-full" />
            </div>
          </div>
        </div>
      </div>

      {/* Form half */}
      <div className="flex-1 flex flex-col justify-center px-4 sm:px-6 lg:flex-none lg:w-[600px] z-20">
        <div className="mx-auto w-full max-w-md bg-card/50 backdrop-blur-xl border border-white/5 p-8 rounded-3xl shadow-2xl">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/30 shadow-[0_0_20px_rgba(var(--primary),0.3)]">
              <Terminal className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h2 className="text-2xl font-bold">Nutterx</h2>
              <p className="text-xs font-mono text-primary uppercase tracking-widest">Hosting Console</p>
            </div>
          </div>

          <h3 className="text-2xl font-semibold mb-2">
            {isLogin ? "Welcome back" : "Create your account"}
          </h3>
          <p className="text-muted-foreground mb-8">
            {isLogin ? "Enter your credentials to access your terminal." : "Start deploying your apps today."}
          </p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input 
                id="email" 
                type="email" 
                placeholder="developer@example.com" 
                required 
                className="h-12 bg-black/40 border-white/10 focus-visible:border-primary/50 focus-visible:ring-primary/20 transition-all"
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>
            
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                {isLogin && <a href="#" className="text-xs text-primary hover:underline">Forgot password?</a>}
              </div>
              <Input 
                id="password" 
                type="password" 
                placeholder="••••••••" 
                required 
                minLength={8}
                className="h-12 bg-black/40 border-white/10 focus-visible:border-primary/50 focus-visible:ring-primary/20 transition-all"
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
            </div>

            <Button 
              type="submit" 
              className="w-full h-12 text-base font-medium shadow-lg shadow-primary/25 hover:shadow-primary/40 transition-all group"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  {isLogin ? "Sign In" : "Sign Up"}
                  <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </Button>
          </form>

          <div className="mt-8 text-center">
            <button 
              type="button" 
              onClick={() => setIsLogin(!isLogin)}
              className="text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              {isLogin ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
