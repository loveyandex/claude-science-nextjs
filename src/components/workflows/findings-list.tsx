"use client";

import { useState } from "react";
import { ExternalLink, Lightbulb, Quote, Trash2 } from "lucide-react";
import { Markdown } from "@/components/workflows/markdown";
import { timeAgo } from "@/components/workflows/status";
import type { Finding } from "@/components/workflows/types";
import { cn } from "@/lib/utils";

const CONFIDENCE_CLASS: Record<string, string> = {
  high: "text-success border-success/30 bg-success/10",
  medium: "text-warning border-warning/30 bg-warning/10",
  low: "text-muted-foreground border-border bg-foreground/[0.04]",
};

function SourceLink({ source }: { source: Finding["sources"][number] }) {
  const label = source.title || source.doi || source.url || "source";
  const href = source.doi ? `https://doi.org/${source.doi}` : source.url?.startsWith("http") ? source.url : null;
  return (
    <li className="flex flex-col gap-0.5">
      <span className="inline-flex flex-wrap items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground">
        {href ? (
          <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
            {label} <ExternalLink size={10} />
          </a>
        ) : (
          <span>{label}</span>
        )}
        {source.doi && source.title && <span>· {source.doi}</span>}
        {source.page && <span>· p.{source.page}</span>}
      </span>
      {source.quote && (
        <span className="flex gap-1 border-l-2 border-accent/40 pl-2 text-[12px] italic text-muted-foreground">
          <Quote size={10} className="mt-1 shrink-0" />
          {source.quote}
        </span>
      )}
    </li>
  );
}

export function FindingsList({
  findings,
  onDelete,
}: {
  findings: Finding[];
  onDelete: (id: string) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);

  if (findings.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-center">
        <Lightbulb size={22} className="text-accent" />
        <p className="font-mono text-[11.5px] text-muted-foreground">
          No findings yet. The agent records each verified result here, with its sources.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {findings.map((f) => (
        <li key={f.id} className="group rounded-xl border border-border/60 bg-background px-4 py-3 animate-fade-in">
          <div className="mb-1.5 flex items-start gap-2">
            <Lightbulb size={14} className="mt-0.5 shrink-0 text-accent" />
            <h3 className="min-w-0 flex-1 font-display text-[14px] font-semibold leading-snug">{f.title}</h3>
            {f.confidence && (
              <span
                className={cn(
                  "shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wide",
                  CONFIDENCE_CLASS[f.confidence]
                )}
              >
                {f.confidence}
              </span>
            )}
            <button
              onClick={async () => {
                if (confirming !== f.id) {
                  setConfirming(f.id);
                  setTimeout(() => setConfirming((c) => (c === f.id ? null : c)), 3000);
                  return;
                }
                await onDelete(f.id);
              }}
              title={confirming === f.id ? "Click again to delete" : "Delete finding"}
              className={cn(
                "shrink-0 rounded-md p-1 transition-all",
                confirming === f.id
                  ? "bg-destructive/10 text-destructive opacity-100"
                  : "text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
              )}
            >
              <Trash2 size={13} />
            </button>
          </div>
          <div className="pl-[22px]">
            <Markdown>{f.content}</Markdown>
            {f.sources.length > 0 && <ul className="mt-2 space-y-1.5">{f.sources.map((s, i) => <SourceLink key={i} source={s} />)}</ul>}
            <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[10px] text-muted-foreground">
              {f.runNumber && <span>run #{f.runNumber}</span>}
              <span>{timeAgo(f.createdAt)}</span>
              {f.tags.map((t) => (
                <span key={t} className="rounded bg-foreground/[0.05] px-1.5 py-0.5">
                  #{t}
                </span>
              ))}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
