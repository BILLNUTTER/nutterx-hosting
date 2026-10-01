import { Link, useLocation } from "wouter";
import { LogOut, ChevronDown, Plus, LayoutDashboard, Activity, Menu, X } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { NutterxLogo } from "@/components/NutterxLogo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { clsx } from "clsx";
import { useState } from "react";

const navLinks = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "New App", href: "/apps/new" },
];

export function Navbar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);

  const initials = user?.email ? user.email.slice(0, 2).toUpperCase() : "??";

  return (
    <header className="sticky top-0 z-50 border-b border-border/80 bg-background/90 backdrop-blur-xl">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-10 h-16 flex items-center gap-5">
        {/* Brand */}
        <Link href="/dashboard" data-testid="link-brand" className="flex items-center gap-2 cursor-pointer flex-shrink-0">
            <NutterxLogo size={28} />
            <span className="font-bold text-sm tracking-tight">nutterx<span className="text-primary">/</span>host</span>
        </Link>

        <div className="h-4 w-px bg-border" />

        {/* Nav links */}
        <nav className="hidden sm:flex items-center gap-1 flex-1">
          {navLinks.map((item) => {
            const isActive =
              location === item.href ||
              (item.href === "/apps/new" && location.startsWith("/apps/new"));
            return (
              <Link key={item.href} href={item.href} data-testid={`link-nav-${item.label.toLowerCase().replace(" ", "-")}`}
                  className={clsx(
                    "px-3 py-1.5 rounded-md text-sm transition-colors",
                    isActive
                      ? "text-foreground font-medium bg-white/5"
                      : "text-muted-foreground hover:text-foreground hover:bg-white/5"
              )}
              >{item.label}</Link>
            );
          })}
        </nav>

        <button onClick={() => setOpen(!open)} className="sm:hidden text-muted-foreground" data-testid="button-mobile-menu">
          {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
        {/* User dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors outline-none" data-testid="button-user-menu">
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
      {open && (
        <div className="sm:hidden border-t border-border bg-background px-4 py-3 space-y-1">
          {navLinks.map((item) => <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">{item.label}</Link>)}
          <button onClick={() => logout()} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-destructive hover:bg-destructive/10"><LogOut className="w-4 h-4" /> Sign out</button>
        </div>
      )}
    </header>
  );
}
