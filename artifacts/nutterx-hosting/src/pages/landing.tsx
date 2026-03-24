import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Zap, Eye, Shield, Users, ArrowRight, CheckCircle, Globe, CreditCard } from "lucide-react";
import { NutterxLogo } from "@/components/NutterxLogo";
import { motion } from "framer-motion";

const features = [
  {
    icon: Zap,
    title: "Deploy in Seconds",
    description: "Paste a GitHub URL and hit deploy. We clone, install dependencies, and launch your app automatically.",
  },
  {
    icon: Eye,
    title: "Real-Time Logs",
    description: "Stream live stdout/stderr from your running process directly in the browser. No SSH required.",
  },
  {
    icon: CreditCard,
    title: "Simple Pricing",
    description: "Just KSH 150 per month. No hidden fees, no complex tiers — one flat price for unlimited deployments.",
  },
  {
    icon: Shield,
    title: "Env Var Management",
    description: "Store secrets securely with encrypted env vars. Values are masked in the UI by default.",
  },
  {
    icon: Users,
    title: "Multi-User",
    description: "Each user has their own isolated workspace. Register, deploy, and manage — all independently.",
  },
  {
    icon: Globe,
    title: "Auto Restart",
    description: "Enable auto-restart so your app recovers automatically from crashes — up to 5 attempts.",
  },
];

const steps = [
  { step: "01", title: "Create an account", desc: "Register in seconds with your email, phone, and password." },
  { step: "02", title: "Paste your repo URL", desc: "Enter any public GitHub repository URL." },
  { step: "03", title: "Set env vars", desc: "Add environment variables your app needs securely." },
  { step: "04", title: "Pay & Deploy", desc: "Make a one-time KSH 150 payment via M-Pesa, then watch your app go live." },
];

const stacks = ["Node.js", "Express", "Discord Bots", "WhatsApp Bots", "Telegram Bots", "REST APIs", "Next.js", "Fastify"];

export default function Landing() {
  return (
    <div className="min-h-screen bg-[#080808] text-white flex flex-col">
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-white/5 bg-[#080808]/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <NutterxLogo size={36} />
            <span className="font-bold text-lg tracking-tight">Nutterx</span>
            <span className="hidden sm:inline text-[10px] font-mono text-violet-400 uppercase tracking-widest bg-violet-500/10 border border-violet-500/20 px-2 py-0.5 rounded-full">
              Hosting
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login">
              <Button variant="ghost" className="text-sm text-zinc-400 hover:text-white">
                Sign In
              </Button>
            </Link>
            <Link href="/login?tab=signup">
              <Button className="text-sm bg-violet-600 hover:bg-violet-500 text-white border-0 shadow-lg shadow-violet-500/25">
                Get Started <ArrowRight className="w-4 h-4 ml-1.5" />
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative flex-1 flex items-center justify-center overflow-hidden py-24 px-4">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-violet-600/10 blur-[140px] rounded-full" />
          <div className="absolute bottom-0 right-0 w-[400px] h-[400px] bg-blue-600/8 blur-[120px] rounded-full" />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:64px_64px]" />
        </div>

        <div className="relative max-w-4xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="inline-flex items-center gap-2 border border-violet-500/25 bg-violet-500/10 text-violet-400 text-xs font-mono px-3 py-1.5 rounded-full mb-8">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
              Deploy any GitHub repo — only KSH 150/month
            </div>

            <h1 className="text-5xl sm:text-6xl md:text-7xl font-extrabold tracking-tight leading-[1.05]">
              <span className="bg-gradient-to-br from-white via-white to-white/40 bg-clip-text text-transparent">
                Host your apps.
              </span>
              <br />
              <span className="bg-gradient-to-br from-violet-400 via-violet-300 to-blue-400 bg-clip-text text-transparent">
                No DevOps needed.
              </span>
            </h1>

            <p className="mt-6 text-xl text-zinc-400 max-w-2xl mx-auto leading-relaxed">
              Nutterx is a self-hosted Heroku-style platform. Paste a GitHub URL, configure your env vars, pay KSH 150, and get real-time logs streaming directly in your browser.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center mt-10">
              <Link href="/login?tab=signup">
                <Button size="lg" className="bg-violet-600 hover:bg-violet-500 text-white text-base px-8 shadow-xl shadow-violet-500/30 border-0">
                  Start Deploying <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
              </Link>
              <Link href="/login">
                <Button size="lg" variant="outline" className="text-base px-8 border-white/10 text-zinc-300 hover:bg-white/5">
                  Sign In
                </Button>
              </Link>
            </div>
          </motion.div>

          {/* Terminal mock */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="mt-16 bg-zinc-900/80 border border-white/10 rounded-xl overflow-hidden shadow-2xl shadow-black/50 text-left max-w-2xl mx-auto"
          >
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 bg-white/[0.02]">
              <span className="w-3 h-3 rounded-full bg-red-500/70" />
              <span className="w-3 h-3 rounded-full bg-yellow-500/70" />
              <span className="w-3 h-3 rounded-full bg-green-500/70" />
              <span className="text-xs text-zinc-500 font-mono ml-2">nutterx console</span>
            </div>
            <div className="p-5 font-mono text-sm space-y-1.5">
              <div className="text-amber-400">▶ Starting deployment for my-bot...</div>
              <div className="text-zinc-500">✦ Cloning repository: github.com/user/my-bot</div>
              <div className="text-zinc-500">✦ Installing dependencies with: npm install</div>
              <div className="text-zinc-500">✦ Starting app with: node index.js</div>
              <div className="text-green-400">✓ App is running · Connected to WhatsApp</div>
              <div className="flex items-center gap-2 mt-2">
                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <span className="text-green-400/70 text-xs">live · 0 crashes · uptime 3h 22m</span>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Pricing highlight */}
      <section className="py-16 px-4">
        <div className="max-w-3xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="relative bg-gradient-to-br from-violet-600/20 via-violet-500/10 to-blue-500/10 border border-violet-500/30 rounded-2xl p-8 text-center overflow-hidden"
          >
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(139,92,246,0.15),transparent_70%)]" />
            <div className="relative">
              <div className="inline-flex items-center gap-2 text-violet-400 text-xs font-mono uppercase tracking-widest bg-violet-500/15 border border-violet-500/25 px-3 py-1 rounded-full mb-5">
                <CreditCard className="w-3.5 h-3.5" /> Simple Pricing
              </div>
              <div className="flex items-end justify-center gap-2 mb-3">
                <span className="text-6xl font-black text-white">150</span>
                <div className="text-left pb-2">
                  <div className="text-2xl font-bold text-violet-300">KSH</div>
                  <div className="text-sm text-zinc-400">per month</div>
                </div>
              </div>
              <p className="text-zinc-400 max-w-md mx-auto mb-6">
                One flat price. Deploy unlimited apps, stream real-time logs, manage env vars, and keep your bots alive 24/7.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-4 text-sm text-zinc-300 mb-6">
                {["Unlimited apps", "Real-time logs", "Auto-restart", "M-Pesa payment"].map((t) => (
                  <span key={t} className="flex items-center gap-1.5">
                    <CheckCircle className="w-4 h-4 text-green-400/80" /> {t}
                  </span>
                ))}
              </div>
              <Link href="/login?tab=signup">
                <Button className="bg-violet-600 hover:bg-violet-500 text-white px-8 shadow-lg shadow-violet-500/30 border-0">
                  Get Started — KSH 150/month
                </Button>
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Stacks */}
      <section className="border-y border-white/5 bg-white/[0.01] py-6">
        <div className="max-w-5xl mx-auto px-4">
          <p className="text-center text-xs text-zinc-600 uppercase tracking-widest mb-5 font-mono">Works with any Node.js project</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {stacks.map((s) => (
              <span key={s} className="px-3 py-1.5 text-xs font-mono text-zinc-400 border border-white/8 rounded-md bg-white/[0.02]">
                {s}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-24 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">Everything you need to ship</h2>
            <p className="mt-4 text-zinc-400 max-w-xl mx-auto">From cloning to running, every step is handled for you. Focus on your code, not your infrastructure.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {features.map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.07 }}
                className="bg-white/[0.02] border border-white/8 rounded-xl p-6 hover:border-violet-500/30 hover:bg-violet-500/5 transition-all group"
              >
                <div className="w-10 h-10 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mb-4 group-hover:bg-violet-500/15 transition-colors">
                  <f.icon className="w-5 h-5 text-violet-400" />
                </div>
                <h3 className="font-semibold text-white mb-2">{f.title}</h3>
                <p className="text-sm text-zinc-400 leading-relaxed">{f.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-24 px-4 bg-white/[0.01] border-y border-white/5">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">Up and running in four steps</h2>
            <p className="mt-4 text-zinc-400">Pay once via M-Pesa. Deploy in minutes.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {steps.map((s, i) => (
              <motion.div
                key={s.step}
                initial={{ opacity: 0, x: i % 2 === 0 ? -16 : 16 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="flex gap-5 p-6 bg-white/[0.02] border border-white/8 rounded-xl"
              >
                <div className="text-3xl font-black text-white/10 font-mono select-none flex-shrink-0">{s.step}</div>
                <div>
                  <h4 className="font-semibold text-white mb-1">{s.title}</h4>
                  <p className="text-sm text-zinc-400">{s.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-4 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-violet-600/10 blur-[100px] rounded-full" />
        </div>
        <div className="relative max-w-2xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">Ready to deploy?</h2>
          <p className="text-zinc-400 mb-2">Keep your bots and APIs online 24/7 for just KSH 150 per month.</p>
          <p className="text-zinc-500 text-sm mb-8">Pay via M-Pesa. Cancel anytime.</p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/login?tab=signup">
              <Button size="lg" className="bg-violet-600 hover:bg-violet-500 text-white px-10 shadow-xl shadow-violet-500/30 border-0">
                Create Account — KSH 150/month
              </Button>
            </Link>
          </div>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-6 text-sm text-zinc-500">
            {["KSH 150/month", "M-Pesa payment", "Cancel anytime"].map((t) => (
              <span key={t} className="flex items-center gap-1.5">
                <CheckCircle className="w-4 h-4 text-green-500/70" /> {t}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 py-8 px-4">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <NutterxLogo size={28} />
            <span className="text-sm font-semibold text-zinc-300">Nutterx Hosting</span>
          </div>
          <p className="text-xs text-zinc-600">© {new Date().getFullYear()} Nutterx. KSH 150/month · M-Pesa.</p>
          <div className="flex items-center gap-4">
            <Link href="/login">
              <span className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer">Sign In</span>
            </Link>
            <Link href="/login?tab=signup">
              <span className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer">Register</span>
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
