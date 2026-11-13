import { CheckCircle2, CircleDashed, Loader2, PauseCircle, XCircle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS_META: Record<string, { label: string; className: string; icon: typeof Loader2; spin?: boolean }> = {
  draft: { label: "draft", className: "text-muted-foreground bg-foreground/[0.05] border-border/70", icon: CircleDashed },
  queued: { label: "queued", className: "text-info bg-info/10 border-info/30", icon: Clock },
  running: { label: "running", className: "text-accent bg-accent/10 border-accent/30", icon: Loader2, spin: true },
  completed: { label: "completed", className: "text-success bg-success/10 border-success/30", icon: CheckCircle2 },
  partial: { label: "partly done", className: "text-warning bg-warning/10 border-warning/30", icon: CircleDashed },
  failed: { label: "failed", className: "text-destructive bg-destructive/10 border-destructive/30", icon: XCircle },
  cancelled: { label: "cancelled", className: "text-warning bg-warning/10 border-warning/30", icon: PauseCircle },
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.draft;
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide",
        meta.className,
        className
      )}
    >
      <Icon size={11} className={meta.spin ? "animate-spin" : undefined} />
      {meta.label}
    </span>
  );
}

export function isActive(status: string) {
  return status === "running" || status === "queued";
}

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function duration(fromIso: string | null, toIso: string | null, now = Date.now()): string {
  if (!fromIso) return "—";
  const s = Math.max(0, Math.round(((toIso ? new Date(toIso).getTime() : now) - new Date(fromIso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function clockTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
