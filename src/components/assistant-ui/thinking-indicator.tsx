"use client";

import { Sparkle } from "lucide-react";

/**
 * Shown in place of the assistant message while the model has been asked
 * to respond but hasn't produced its first content part yet (no text, no
 * tool call) — i.e. genuinely waiting on the first token from the LLM API.
 * Once anything streams in, this unmounts and the real message/tool UI
 * takes over.
 */
export function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-2 py-1 text-muted-foreground">
      <Sparkle size={14} className="fill-accent/70 text-accent/70" />
      <span className="flex items-center gap-1">
        <Dot delay="0ms" />
        <Dot delay="150ms" />
        <Dot delay="300ms" />
      </span>
    </div>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="size-1.5 rounded-full bg-current animate-pulse"
      style={{ animationDelay: delay, animationDuration: "900ms" }}
    />
  );
}
