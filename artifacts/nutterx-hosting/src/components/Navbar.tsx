import { Link, useLocation } from "wouter";
import { Terminal, LogOut, ChevronDown, Plus, LayoutDashboard } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { clsx } from "clsx";

const navLinks = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "New App", href: "/apps/new" },
];

export function Navbar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  const initials = user?.email ? user.email.slice(0, 2).toUpperCase() : "??";

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/90 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-12 flex items-center gap-5">
        {/* Brand */}
        <Link href="/dashboard">
          <div className="flex items-center gap-2 cursor-pointer flex-shrink-0">
            <div className="w-7 h-7 rounded-md bg-primary/10 border border-primary/25 flex items-center justify-center">
              <Terminal className="w-3.5 h-3.5 text-primary" />
            </div>
            <span className="font-bold text-sm tracking-tight">Nutterx</span>
          </div>
        </Link>

        <div className="h-4 w-px bg-border" />

        {/* Nav links */}
        <nav className="flex items-center gap-0.5 flex-1">
          {navLinks.map((item) => {
            const isActive =
              location === item.href ||
              (item.href === "/apps/new" && location.startsWith("/apps/new"));
            return (
              <Link key={item.href} href={item.href}>
                <button
                  className={clsx(
                    "px-3 py-1.5 rounded-md text-sm transition-colors",
                    isActive
                      ? "text-foreground font-medium bg-white/5"
                      : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                  )}
                >
                  {item.label}
                </button>
              </Link>
            );
          })}
        </nav>

        {/* User dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors outline-none">
              <div className="w-7 h-7 rounded-full bg-primary/15 border border-primary/20 flex items-center justify-center text-[10px] font-bold text-primary">
                {initials}
              </div>
              <ChevronDown className="w-3 h-3 opacity-50" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <div className="px-3 py-2">
              <p className="text-xs font-medium text-foreground truncate">{user?.email}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Free plan</p>
            </div>
            <DropdownMenuSeparator />
            <Link href="/apps/new">
              <DropdownMenuItem className="gap-2 cursor-pointer">
                <Plus className="w-3.5 h-3.5" /> Deploy New App
              </DropdownMenuItem>
            </Link>
            <Link href="/dashboard">
              <DropdownMenuItem className="gap-2 cursor-pointer">
                <LayoutDashboard className="w-3.5 h-3.5" /> Dashboard
              </DropdownMenuItem>
            </Link>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => logout()}
              className="text-destructive focus:text-destructive focus:bg-destructive/10 gap-2 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" /> Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
