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

import { groupPartByType, MessagePrimitive, type EnrichedPartState } from "@assistant-ui/react";
import { Sparkle, Brain } from "lucide-react";
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

function ThoughtRail({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-1.5 rounded-lg border border-border/50 bg-foreground/[0.02] py-1.5 pr-2 pl-3">
      <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
        <Brain size={11} />
        working
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function ReasoningRow({ part }: { part: EnrichedPartState & { type: "reasoning"; text: string } }) {
  const isRunning = part.status?.type === "running";
  return (
    <div className="flex items-start gap-2 py-0.5 text-[12.5px] text-muted-foreground">
      <Sparkle
        size={12}
        className={`mt-0.5 shrink-0 ${isRunning ? "animate-pulse text-accent" : "text-muted-foreground/60"}`}
      />
      <p className="italic leading-snug">{part.text || (isRunning ? "Thinking…" : "")}</p>
    </div>
  );
}
