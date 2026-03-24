import { type ComponentType } from "react";
import { Badge } from "@/components/ui/badge";
import { AppStatus } from "@workspace/api-client-react";
import { clsx } from "clsx";
import { PlayCircle, StopCircle, Loader2, AlertTriangle, AlertCircle, Clock } from "lucide-react";

type StatusConfig = {
  color: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  spin?: boolean;
};

export function StatusBadge({ status, className }: { status: AppStatus; className?: string }) {
  const config: Record<string, StatusConfig> = {
    running: {
      color: "bg-green-500/10 text-green-500 border-green-500/20 hover:bg-green-500/20",
      icon: PlayCircle,
      label: "Running"
    },
    stopped: {
      color: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20 hover:bg-zinc-500/20",
      icon: StopCircle,
      label: "Stopped"
    },
    crashed: {
      color: "bg-red-500/10 text-red-500 border-red-500/20 hover:bg-red-500/20",
      icon: AlertCircle,
      label: "Crashed"
    },
    installing: {
      color: "bg-amber-500/10 text-amber-500 border-amber-500/20 hover:bg-amber-500/20",
      icon: Loader2,
      label: "Installing",
      spin: true
    },
    error: {
      color: "bg-red-500/10 text-red-500 border-red-500/20 hover:bg-red-500/20",
      icon: AlertTriangle,
      label: "Error"
    },
    idle: {
      color: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20 hover:bg-zinc-500/20",
      icon: Clock,
      label: "Idle"
    }
  };

  const style = config[status] || config.idle;
  const Icon = style.icon;

  return (
    <Badge variant="outline" className={clsx("flex items-center gap-1.5 px-2.5 py-0.5", style.color, className)}>
      <Icon className={clsx("w-3.5 h-3.5", style.spin && "animate-spin")} />
      {style.label}
    </Badge>
  );
}
