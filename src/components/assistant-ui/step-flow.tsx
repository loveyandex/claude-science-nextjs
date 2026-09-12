"use client";

/**
 * Renders the "agent working" flow — interleaved reasoning + tool calls
 * that happen before (and sometimes between) the final answer text — as a
 * plain, compact list of short step lines (no bordered box/card), the
 * same look chat UIs like Grok use: a small "Worked for Ns" caption you
 * can collapse, with each reasoning/tool-call step as one short muted
 * line above the actual answer. Consecutive reasoning/tool-call parts are
 * coalesced via assistant-ui's `groupPartByType` +
 * `MessagePrimitive.GroupedParts`; the final text part renders normally,
 * outside the step list, at full size.
 */

import { useEffect, useRef, useState } from "react";
import { groupPartByType, MessagePrimitive, useMessage, type EnrichedPartState } from "@assistant-ui/react";
import { ChevronDown, Lightbulb, Loader2 } from "lucide-react";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { ToolFallback } from "@/components/assistant-ui/tool-call";
import { ThinkingIndicator } from "@/components/assistant-ui/thinking-indicator";

export const stepFlowGroupBy = groupPartByType({
  reasoning: ["group-thought", "group-reasoning"],
  "tool-call": ["group-thought", "group-tool"],
});

export function StepFlowParts() {
  return (
    <MessagePrimitive.GroupedParts groupBy={stepFlowGroupBy}>
      {({ part, children }) => {
        switch (part.type) {
          case "group-thought":
            return <ThoughtRail>{children}</ThoughtRail>;
          case "group-reasoning":
          case "group-tool":
            return <>{children}</>;
          case "text":
            return <MarkdownText />;
          case "reasoning":
            return <ReasoningRow part={part} />;
          case "tool-call":
            return <ToolFallback {...part} />;
          case "indicator":
            return <ThinkingIndicator />;
          default:
            return null;
        }
      }}
    </MessagePrimitive.GroupedParts>
  );
}

/** Cuts to a short single line at a word boundary — the step list reads as
 *  a table of contents, not a transcript, so a full paragraph doesn't belong here. */
function truncate(text: string, max = 100): string {
  const clean = text.trim().replace(/\s+/g, " ");
  if (clean.length <= max) return clean;
  return clean.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

/**
 * The whole "thought" block — reasoning + tool calls before the final
 * answer — collapses into one plain "Worked for Ns" caption once
 * finished, the same pattern chat UIs like Grok/ChatGPT use so a long
 * chain of internal monologue and tool calls doesn't sit permanently in
 * the way of the actual answer. Starts expanded (to show live progress)
 * only if it's still running the first time it mounts; a message loaded
 * already-done (e.g. from history) starts collapsed.
 *
 * "Running" here is the whole assistant message's status, not this one
 * group's last part — a multi-step tool-calling turn has real gaps
 * between one tool result landing and the next reasoning token starting
 * (each step is its own LLM round trip), during which the group's own
 * last-known part briefly reads as "complete". Using message-level status
 * avoids the caption flickering to "done" mid-turn during those gaps.
 */
function ThoughtRail({ children }: { children: React.ReactNode }) {
  const isRunning = useMessage((m) => m.status?.type === "running");
  const startRef = useRef<number>(Date.now());
  const [elapsedMs, setElapsedMs] = useState<number | null>(isRunning ? null : 0);
  const [collapsed, setCollapsed] = useState(() => !isRunning);

  useEffect(() => {
    if (!isRunning && elapsedMs === null) {
      setElapsedMs(Date.now() - startRef.current);
    }
  }, [isRunning, elapsedMs]);

  const seconds = elapsedMs !== null ? Math.max(1, Math.round(elapsedMs / 1000)) : null;
  const summary = isRunning ? "Working" : seconds !== null ? `Worked for ${seconds}s` : "Worked";

  return (
    <div className="my-1">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="flex items-center gap-1.5 py-0.5 text-left text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
      >
        {isRunning && <Loader2 size={12} className="animate-spin text-accent" />}
        {summary}
        <ChevronDown
          size={13}
          className={`shrink-0 transition-transform ${collapsed ? "-rotate-90" : ""}`}
        />
      </button>
      {!collapsed && <div className="space-y-0.5 pb-1">{children}</div>}
    </div>
  );
}

function ReasoningRow({ part }: { part: EnrichedPartState & { type: "reasoning"; text: string } }) {
  const isRunning = part.status?.type === "running";
  const text = part.text || (isRunning ? "Thinking…" : "");

  return (
    <div className="flex items-center gap-2 py-0.5 text-[12.5px] text-muted-foreground">
      <Lightbulb
        size={13}
        className={`shrink-0 ${isRunning ? "animate-pulse text-accent" : "text-muted-foreground/70"}`}
      />
      <span className="truncate">{truncate(text)}</span>
    </div>
  );
}
