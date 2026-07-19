"use client";

/**
 * Ghost-style collapsible tool-call renderer. Replaces the old bordered
 * rectangle-per-call UI (which read as visual noise, especially when the
 * model issues 2-3 searches in a row) with a single inline row per call —
 * icon, short human label, status — that expands on click to show the
 * actual args and results. No box by default, just text + a chevron.
 */

import { useState } from "react";
import {
  ChevronRight,
  Loader2,
  Search,
  ListTree,
  BarChart3,
  FileSearch,
  AlertTriangle,
  Check,
} from "lucide-react";

type ToolFallbackProps = {
  toolName: string;
  args: Record<string, unknown>;
  argsText: string;
  result?: unknown;
  isError?: boolean;
};

const TOOL_META: Record<
  string,
  {
    icon: typeof Search;
    label: (args: any) => string;
  }
> = {
  searchArticles: {
    icon: Search,
    label: (args) =>
      args?.query ? `Searching library for "${args.query}"` : "Browsing the library",
  },
  listRecentArticles: {
    icon: ListTree,
    label: () => "Checking recently indexed articles",
  },
  getLibraryStats: {
    icon: BarChart3,
    label: () => "Checking library stats",
  },
  getArticleByUrl: {
    icon: FileSearch,
    label: (args) => (args?.url ? `Opening "${args.url}"` : "Opening article"),
  },
};

function summarizeResult(toolName: string, result: unknown): string {
  if (result == null) return "Done.";
  if (typeof result !== "object") return "Done.";
  const r = result as Record<string, unknown>;
  if (typeof r.count === "number") {
    return `Found ${r.count} matching paper${r.count === 1 ? "" : "s"}.`;
  }
  if (typeof r.total === "number") {
    return `${r.total} articles indexed.`;
  }
  if (r.title) return `Found "${String(r.title)}".`;
  if (r.error) return `Error: ${String(r.error)}`;
  return "Done.";
}

export function ToolFallback({ toolName, args, argsText, result, isError }: ToolFallbackProps) {
  const [open, setOpen] = useState(false);
  const meta = TOOL_META[toolName];
  const Icon = meta?.icon ?? Search;
  const isRunning = result === undefined && !isError;
  const label = meta?.label(args) ?? toolName;

  return (
    <div className="my-1.5 font-body">
      <button
        onClick={() => setOpen((o) => !o)}
        className="group flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-foreground/5"
      >
        <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
          {isRunning ? (
            <Loader2 size={14} className="animate-spin text-accent" />
          ) : isError ? (
            <AlertTriangle size={14} className="text-destructive" />
          ) : (
            <Icon size={14} />
          )}
        </span>
        <span className="flex-1 truncate text-[13px] text-muted-foreground">
          {isRunning ? label : summarizeResult(toolName, result)}
        </span>
        <ChevronRight
          size={13}
          className={`shrink-0 text-muted-foreground/60 transition-transform ${open ? "rotate-90" : ""}`}
        />
      </button>

      {open && (
        <div className="ml-7 mt-1 space-y-2 border-l border-border/70 pl-3 text-[12.5px] animate-fade-in">
          {argsText && argsText !== "{}" && (
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
                arguments
              </p>
              <ArgsList args={args} />
            </div>
          )}
          {result !== undefined && (
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
                result
              </p>
              <ResultView toolName={toolName} result={result} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ArgsList({ args }: { args: Record<string, unknown> }) {
  const entries = Object.entries(args ?? {}).filter(([, v]) => v !== undefined && v !== "");
  if (entries.length === 0) return <p className="text-muted-foreground">none</p>;
  return (
    <dl className="mt-0.5 space-y-0.5">
      {entries.map(([k, v]) => (
        <div key={k} className="flex gap-1.5">
          <dt className="font-mono text-muted-foreground">{k}:</dt>
          <dd className="text-foreground">{String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function ResultView({ toolName, result }: { toolName: string; result: unknown }) {
  if (!result || typeof result !== "object") {
    return <p className="mt-0.5 text-muted-foreground">{String(result)}</p>;
  }
  const r = result as Record<string, unknown>;
  const articles = Array.isArray(r.results) ? r.results : Array.isArray(r.articles) ? r.articles : null;

  if (articles) {
    if (articles.length === 0) {
      return <p className="mt-0.5 text-muted-foreground">No matches.</p>;
    }
    return (
      <ul className="mt-0.5 space-y-1.5">
        {articles.map((a: any, i: number) => (
          <li key={i} className="flex items-start gap-1.5">
            <Check size={12} className="mt-0.5 shrink-0 text-accent" />
            <span className="text-foreground">{a.title ?? a.url ?? "untitled"}</span>
          </li>
        ))}
      </ul>
    );
  }

  if (toolName === "getLibraryStats") {
    return (
      <p className="mt-0.5 text-foreground">
        {String(r.total ?? "?")} indexed / {String(r.pending ?? "?")} pending
      </p>
    );
  }

  return (
    <pre className="mt-0.5 whitespace-pre-wrap break-words text-muted-foreground">
      {JSON.stringify(r, null, 2)}
    </pre>
  );
}
