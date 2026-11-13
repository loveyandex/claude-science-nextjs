"use client";

import { CheckCircle2, Circle, CircleDashed, CircleDot, CircleSlash, Coins, Cpu, Footprints, Timer, Wrench } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { StatusBadge, duration, isActive } from "@/components/workflows/status";
import type { PlanStep, RunRecord } from "@/components/workflows/types";
import { cn } from "@/lib/utils";

const PLAN_ICON = {
  todo: { icon: Circle, className: "text-muted-foreground/60" },
  doing: { icon: CircleDot, className: "text-accent animate-pulse" },
  done: { icon: CheckCircle2, className: "text-success" },
  skipped: { icon: CircleSlash, className: "text-muted-foreground/60" },
} as const;
// A todo/doing step in a run that has ended was never finished.
const UNFINISHED = { icon: CircleDashed, className: "text-warning" };

function formatTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** Header strip for one run: status, progress against its step budget, counters and the agent's live plan. */
export function RunPanel({ run, now }: { run: RunRecord; now: number }) {
  const active = isActive(run.status);
  const plan = Array.isArray(run.plan) ? (run.plan as PlanStep[]) : [];
  const done = plan.filter((s) => s.status === "done").length;
  const skipped = plan.filter((s) => s.status === "skipped").length;
  const open = plan.length - done - skipped;
  const ended = !active && run.status !== "queued";
  const pct = run.maxSteps > 0 ? (run.stepCount / run.maxSteps) * 100 : 0;

  return (
    <section className="rounded-xl border border-border/60 bg-background">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 pt-3">
        <span className="font-display text-[14px] font-semibold">Run #{run.number}</span>
        <StatusBadge status={run.status} />
        <span className="ms-auto inline-flex items-center gap-1 font-mono text-[10.5px] text-muted-foreground" title="Model">
          <Cpu size={11} /> {run.modelLabel ?? "default model"}
        </span>
      </div>

      <div className="px-4 pb-3 pt-2.5">
        <Progress value={run.status === "queued" ? null : pct} label="Steps used" />
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10.5px] text-muted-foreground">
          <span className="inline-flex items-center gap-1" title="Model steps used of the budget">
            <Footprints size={11} /> {run.stepCount}/{run.maxSteps} steps
          </span>
          <span className="inline-flex items-center gap-1">
            <Wrench size={11} /> {run.toolCallCount} tool calls
          </span>
          <span className="inline-flex items-center gap-1" title="Input / output tokens">
            <Coins size={11} /> {formatTokens(run.inputTokens)} in · {formatTokens(run.outputTokens)} out
          </span>
          <span className="inline-flex items-center gap-1">
            <Timer size={11} /> {duration(run.startedAt ?? run.createdAt, run.endedAt, now)}
            {active ? " so far" : ""}
          </span>
        </div>
        {run.error && (
          <p className="mt-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 font-mono text-[11px] text-destructive">
            {run.error}
          </p>
        )}
      </div>

      {plan.length > 0 && (
        <div className="border-t border-border/50 px-4 py-3">
          <div className="mb-1.5 flex items-center justify-between font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
            <span>plan</span>
            <span>
              {done}/{plan.length} done
              {skipped > 0 && ` · ${skipped} skipped`}
              {ended && open > 0 && <span className="text-warning"> · {open} not finished</span>}
            </span>
          </div>
          <ol className="space-y-1">
            {plan.map((step, i) => {
              const unfinished = ended && (step.status === "todo" || step.status === "doing");
              const meta = unfinished ? UNFINISHED : (PLAN_ICON[step.status] ?? PLAN_ICON.todo);
              const Icon = meta.icon;
              return (
                <li key={i} className="flex items-start gap-2 text-[13px]">
                  <Icon size={14} className={cn("mt-0.5 shrink-0", meta.className)} />
                  <div className="min-w-0">
                    <span
                      className={cn(
                        step.status === "done" && "text-muted-foreground",
                        step.status === "skipped" && "text-muted-foreground line-through",
                        step.status === "doing" && !unfinished && "font-medium"
                      )}
                    >
                      {step.title}
                    </span>
                    {unfinished && (
                      <span className="ms-1.5 font-mono text-[10px] uppercase tracking-wide text-warning">not finished</span>
                    )}
                    {step.note && <p className="font-mono text-[10.5px] text-muted-foreground">{step.note}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </section>
  );
}
