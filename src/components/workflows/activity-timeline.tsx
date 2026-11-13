"use client";

import { useState } from "react";
import {
  Brain,
  CheckCircle2,
  ChevronRight,
  CircleStop,
  Clock,
  Lightbulb,
  ListChecks,
  NotebookPen,
  PenLine,
  Play,
  Wrench,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { Markdown } from "@/components/workflows/markdown";
import { clockTime } from "@/components/workflows/status";
import type { WorkflowEvent } from "@/components/workflows/types";
import { cn } from "@/lib/utils";

const TYPE_META: Record<string, { icon: typeof Brain; className: string }> = {
  run_queued: { icon: Clock, className: "text-info" },
  run_started: { icon: Play, className: "text-accent" },
  run_completed: { icon: CheckCircle2, className: "text-success" },
  run_partial: { icon: AlertTriangle, className: "text-warning" },
  run_failed: { icon: XCircle, className: "text-destructive" },
  run_cancelled: { icon: CircleStop, className: "text-warning" },
  thinking: { icon: Brain, className: "text-muted-foreground" },
  tool: { icon: Wrench, className: "text-muted-foreground" },
  plan: { icon: ListChecks, className: "text-info" },
  finding: { icon: Lightbulb, className: "text-accent" },
  note: { icon: NotebookPen, className: "text-foreground" },
  brief_updated: { icon: PenLine, className: "text-muted-foreground" },
};

export const ACTIVITY_FILTERS = [
  { id: "all", label: "all", types: null },
  { id: "findings", label: "findings", types: ["finding"] },
  { id: "notes", label: "notes & plan", types: ["note", "plan", "thinking"] },
  { id: "tools", label: "tool calls", types: ["tool"] },
  { id: "runs", label: "run events", types: ["run_queued", "run_started", "run_completed", "run_partial", "run_failed", "run_cancelled", "brief_updated"] },
] as const;

function prettyJson(value: unknown): string {
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}

function EventRow({ event, runNumber }: { event: WorkflowEvent; runNumber: number | null }) {
  const [open, setOpen] = useState(false);
  const meta = TYPE_META[event.type] ?? TYPE_META.note;
  const Icon = event.type === "tool" && event.data?.ok === false ? AlertTriangle : meta.icon;
  const isTool = event.type === "tool";
  const expandable = Boolean(event.detail || (isTool && event.data) || (event.type === "finding" && event.data?.sources?.length));
  const emphasised = event.type === "finding" || event.type.startsWith("run_");

  return (
    <li className="group relative animate-fade-in pl-7">
      <span className="absolute left-[9px] top-0 h-full w-px bg-border/60 group-last:h-3" />
      <span
        className={cn(
          "absolute left-0 top-1 flex size-[19px] items-center justify-center rounded-full border border-border/70 bg-background",
          emphasised && "border-current",
          meta.className
        )}
      >
        <Icon size={11} />
      </span>
      <button
        type="button"
        disabled={!expandable}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left transition-colors",
          expandable && "hover:bg-sidebar"
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span
              className={cn(
                "min-w-0 flex-1 break-words text-[13px]",
                isTool ? "font-mono text-[12px] text-muted-foreground" : "text-foreground",
                emphasised && "font-medium",
                event.type === "thinking" && "italic text-muted-foreground"
              )}
            >
              {event.title}
            </span>
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground/80">
              {runNumber ? `#${runNumber} · ` : ""}
              {clockTime(event.createdAt)}
            </span>
          </div>
          {!open && event.detail && (isTool || event.type === "finding" || event.type === "note" || event.type.startsWith("run_")) && (
            <p className="line-clamp-2 font-mono text-[10.5px] text-muted-foreground">{event.detail}</p>
          )}
        </div>
        {expandable && (
          <ChevronRight size={13} className={cn("mt-1 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
        )}
      </button>

      {open && (
        <div className="mb-2 ml-1.5 mt-1 space-y-2 rounded-lg border border-border/50 bg-sidebar/60 p-3">
          {isTool && event.data ? (
            <>
              <div className="flex flex-wrap gap-3 font-mono text-[10.5px] text-muted-foreground">
                <span>{event.data.tool}</span>
                {typeof event.data.durationMs === "number" && <span>{(event.data.durationMs / 1000).toFixed(1)}s</span>}
                <span className={event.data.ok ? "text-success" : "text-destructive"}>{event.data.ok ? "ok" : "error"}</span>
              </div>
              <div>
                <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">input</p>
                <pre className="max-h-48 overflow-auto rounded-md bg-background p-2 font-mono text-[11px] leading-snug">
                  {prettyJson(event.data.input)}
                </pre>
              </div>
              <div>
                <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">output</p>
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background p-2 font-mono text-[11px] leading-snug">
                  {prettyJson(event.data.output)}
                </pre>
              </div>
            </>
          ) : (
            event.detail && <Markdown>{event.detail}</Markdown>
          )}
          {event.type === "finding" && Array.isArray(event.data?.sources) && event.data.sources.length > 0 && (
            <ul className="space-y-0.5 font-mono text-[10.5px] text-muted-foreground">
              {event.data.sources.map((s: any, i: number) => (
                <li key={i}>
                  ↳ {s.title ?? s.doi ?? s.url}
                  {s.page ? ` · p.${s.page}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

/** Newest-first activity feed for a workflow (or one run of it). */
export function ActivityTimeline({
  events,
  runNumbers,
  live,
}: {
  events: WorkflowEvent[];
  runNumbers: Map<string, number>;
  live: boolean;
}) {
  if (events.length === 0) {
    return (
      <p className="py-10 text-center font-mono text-[11.5px] text-muted-foreground">
        Nothing here yet — start a run and its searches, readings and findings appear as they happen.
      </p>
    );
  }
  return (
    <div>
      {live && (
        <div className="mb-2 flex items-center gap-2 pl-1 font-mono text-[10.5px] text-accent">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-accent" />
          </span>
          live — updating as the agent works
        </div>
      )}
      <ol className="space-y-0.5">
        {[...events].reverse().map((e) => (
          <EventRow key={e.id} event={e} runNumber={e.runId ? runNumbers.get(e.runId) ?? null : null} />
        ))}
      </ol>
    </div>
  );
}
