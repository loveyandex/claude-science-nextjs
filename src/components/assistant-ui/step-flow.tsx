"use client";

/**
 * Renders the "agent working" flow — interleaved reasoning + tool calls
 * that happen before (and sometimes between) the final answer text — as a
 * single connected, compact timeline distinct from the main response
 * copy. Consecutive reasoning/tool-call parts are coalesced via
 * assistant-ui's `groupPartByType` + `MessagePrimitive.GroupedParts` into
 * one bordered "thought" rail; the final text part renders normally,
 * outside the rail, at full size.
 */

import { useEffect, useRef, useState } from "react";
import { groupPartByType, MessagePrimitive, useMessage, type EnrichedPartState } from "@assistant-ui/react";
import { Brain, ChevronDown, Loader2 } from "lucide-react";
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

/**
 * The whole "thought" block — reasoning + tool calls before the final
 * answer — collapses into one "Thought for Ns" summary once finished, the
 * same pattern chat UIs like Grok/ChatGPT use so a long chain of internal
 * monologue and tool calls doesn't sit permanently in the way of the
 * actual answer. Starts expanded (to show live progress) only if it's
 * still running the first time it mounts; a message loaded already-done
 * (e.g. from history) starts collapsed.
 *
 * "Running" here is the whole assistant message's status, not this one
 * group's last part — a multi-step tool-calling turn has real gaps
 * between one tool result landing and the next reasoning token starting
 * (each step is its own LLM round trip), during which the group's own
 * last-known part briefly reads as "complete". Using message-level status
 * avoids the header flickering to "done" mid-turn during those gaps.
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
  const summary = isRunning ? "Working" : seconds !== null ? `Thought for ${seconds}s` : "Thought";

  return (
    <div className="my-1.5 rounded-lg border border-border/50 bg-foreground/[0.02]">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70 transition-colors hover:text-muted-foreground"
      >
        {isRunning ? (
          <Loader2 size={11} className="animate-spin text-accent" />
        ) : (
          <Brain size={11} />
        )}
        {summary}
        <ChevronDown
          size={12}
          className={`ml-auto shrink-0 transition-transform ${collapsed ? "-rotate-90" : ""}`}
        />
      </button>
      {!collapsed && <div className="space-y-0.5 px-3 pb-2">{children}</div>}
    </div>
  );
}

/**
 * A raw reasoning chunk is usually a full paragraph of internal monologue
 * ("The user asks X. We should do Y..."). Bolding just its first sentence
 * as a headline (rest stays normal, muted, continuing inline) gives it the
 * same scan-at-a-glance shape as a step list, without needing the model to
 * emit short step titles itself.
 */
function splitLead(text: string): [string, string] {
  const match = text.match(/^(.{1,160}?[.!?])(\s+)([\s\S]+)$/);
  if (!match) return [text, ""];
  return [match[1], match[3]];
}

function ReasoningRow({ part }: { part: EnrichedPartState & { type: "reasoning"; text: string } }) {
  const isRunning = part.status?.type === "running";
  const text = part.text || (isRunning ? "Thinking…" : "");
  const [lead, rest] = splitLead(text);

  return (
    <div className="flex items-start gap-2 py-1 text-[12.5px]">
      <span
        className={`mt-1 size-1.5 shrink-0 rounded-full ${isRunning ? "animate-pulse bg-accent" : "bg-muted-foreground/40"}`}
      />
      <p className="leading-relaxed">
        <span className={isRunning ? "text-foreground" : "text-foreground/90 font-medium"}>{lead}</span>
        {rest && <span className="text-muted-foreground"> {rest}</span>}
      </p>
    </div>
  );
}
