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
  BookOpen,
  ScanEye,
  Globe,
  Radar,
  Terminal,
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

function shortUrl(url: unknown): string {
  if (typeof url !== "string") return "";
  const last = url.split("/").filter(Boolean).pop() ?? url;
  return decodeURIComponent(last).slice(0, 60);
}

const TOOL_META: Record<
  string,
  {
    icon: typeof Search;
    label: (args: any) => string;
    // A full-sentence description of exactly what this call did, shown in
    // the expanded view in place of a raw key:value argument dump — e.g.
    // "Searched the library by meaning for “SGD convergence”, up to 5
    // results." Return null when the collapsed label already says
    // everything worth saying (nothing left to add once expanded).
    detail?: (args: any) => string | null;
  }
> = {
  searchLibrarySemantic: {
    icon: Radar,
    label: (args) =>
      args?.query ? `Searching papers about "${args.query}"` : "Searching papers by meaning",
    detail: (args) =>
      args?.query
        ? `Searched the library by meaning for “${args.query}”, up to ${args.limit ?? 5} result${(args.limit ?? 5) === 1 ? "" : "s"}.`
        : null,
  },
  searchArticles: {
    icon: Search,
    label: (args) =>
      args?.query ? `Searching library for "${args.query}"` : "Browsing the library",
    detail: (args) =>
      args?.query
        ? `Searched titles and abstracts for “${args.query}”, up to ${args.limit ?? 5} result${(args.limit ?? 5) === 1 ? "" : "s"}.`
        : null,
  },
  listRecentArticles: {
    icon: ListTree,
    label: () => "Checking recently indexed articles",
    detail: (args) => `Listed the ${args?.limit ?? 10} most recently indexed articles.`,
  },
  getLibraryStats: {
    icon: BarChart3,
    label: () => "Checking library stats",
    detail: () => null,
  },
  getArticleByUrl: {
    icon: FileSearch,
    label: (args) => (args?.url ? `Opening "${shortUrl(args.url)}"` : "Opening article"),
    detail: (args) => (args?.url ? `Opened the article at “${shortUrl(args.url)}”.` : null),
  },
  readArticlePage: {
    icon: BookOpen,
    label: (args) =>
      args?.url
        ? `Reading page ${args.page ?? "?"} of "${shortUrl(args.url)}"`
        : "Reading a page",
    detail: (args) =>
      args?.url ? `Read page ${args.page ?? "?"} of “${shortUrl(args.url)}”.` : null,
  },
  getArticleFullContent: {
    icon: ScanEye,
    label: (args) =>
      args?.url ? `Reading full content of "${shortUrl(args.url)}"` : "Reading full article content",
    detail: (args) =>
      args?.url ? `Read the full content of “${shortUrl(args.url)}”, page by page.` : null,
  },
  webSearch: {
    icon: Globe,
    label: (args) => (args?.query ? `Searching the web for "${args.query}"` : "Searching the web"),
    detail: (args) =>
      args?.query
        ? `Searched the public web for “${args.query}”, up to ${args.limit ?? 5} result${(args.limit ?? 5) === 1 ? "" : "s"}.`
        : null,
  },
  runPythonCode: {
    icon: Terminal,
    label: () => "Running Python code",
    detail: () => null, // the code itself is shown as a code block below, not a sentence
  },
};

/** Converts a camelCase/snake_case key into "Title Case" words, for the
 *  generic fallback when a tool has no hand-written `detail`. */
function humanizeKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
}

function summarizeResult(toolName: string, result: unknown): string {
  if (result == null) return "Done.";
  if (typeof result !== "object") return "Done.";
  const r = result as Record<string, unknown>;
  if (r.error) return `Error: ${String(r.error)}`;
  if (toolName === "webSearch" && typeof r.count === "number") {
    return `Found ${r.count} web result${r.count === 1 ? "" : "s"}.`;
  }
  if (toolName === "readArticlePage" && typeof r.page === "number") {
    return `Read page ${r.page}${r.pageCount ? ` of ${r.pageCount}` : ""}.`;
  }
  if (toolName === "getArticleFullContent" && typeof r.pageCount === "number") {
    return `Read all ${r.pageCount} page${r.pageCount === 1 ? "" : "s"} of "${String(r.title ?? "")}".`;
  }
  if (toolName === "runPythonCode") {
    const exitCode = (r as any).exitCode;
    if ((r as any).timedOut) return "Python code timed out.";
    return exitCode === 0 ? "Python code ran successfully." : `Python code exited with code ${exitCode}.`;
  }
  if (typeof r.count === "number") {
    return `Found ${r.count} matching paper${r.count === 1 ? "" : "s"}.`;
  }
  if (typeof r.total === "number") {
    return `${r.total} articles indexed.`;
  }
  if (r.title) return `Found "${String(r.title)}".`;
  return "Done.";
}

export function ToolFallback({ toolName, args, argsText, result, isError }: ToolFallbackProps) {
  const [open, setOpen] = useState(false);
  const meta = TOOL_META[toolName];
  const Icon = meta?.icon ?? Search;
  const isRunning = result === undefined && !isError;
  const label = meta?.label(args) ?? toolName;
  // Shown as soon as the call finishes, no click required — this is the
  // "what did it actually search for" sentence that used to be hidden
  // behind an "ARGUMENTS" expand-only key:value dump. runPythonCode is
  // excluded here because its real argument (the code) is substantial
  // enough to deserve its own block below, not an inline sentence.
  const detail = !isRunning && toolName !== "runPythonCode" ? meta?.detail?.(args) : null;
  const hasExpandableContent =
    result !== undefined || (toolName === "runPythonCode" && typeof args?.code === "string" && args.code);

  return (
    <div className="my-0.5 font-body">
      <button
        onClick={() => hasExpandableContent && setOpen((o) => !o)}
        className={`flex items-center gap-2 py-0.5 text-left text-[12.5px] text-muted-foreground transition-colors ${hasExpandableContent ? "hover:text-foreground" : "cursor-default"}`}
      >
        {isRunning ? (
          <Loader2 size={13} className="shrink-0 animate-spin text-accent" />
        ) : isError ? (
          <AlertTriangle size={13} className="shrink-0 text-destructive" />
        ) : (
          <Icon size={13} className="shrink-0 text-muted-foreground/70" />
        )}
        <span className="truncate">{isRunning ? label : summarizeResult(toolName, result)}</span>
        {hasExpandableContent && (
          <ChevronRight
            size={12}
            className={`shrink-0 text-muted-foreground/50 transition-transform ${open ? "rotate-90" : ""}`}
          />
        )}
      </button>

      {detail && <p className="py-0.5 pl-[21px] text-[12px] leading-snug text-muted-foreground">{detail}</p>}

      {open && (
        <div className="space-y-2.5 py-1.5 pl-[21px] text-[12.5px] animate-fade-in">
          {toolName === "runPythonCode" && typeof args?.code === "string" && args.code && (
            <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded bg-sidebar px-2 py-1.5 font-mono text-[11px] text-foreground">
              {args.code}
            </pre>
          )}
          <FallbackArgs toolName={toolName} args={args} argsText={argsText} />
          {result !== undefined && <ResultView toolName={toolName} result={result} />}
        </div>
      )}
    </div>
  );
}

/**
 * Only reached for a tool with no hand-written `detail()` — still
 * human-cased key labels rather than a raw camelCase/JSON dump, but this
 * is the last resort, not the normal path.
 */
function FallbackArgs({
  toolName,
  args,
  argsText,
}: {
  toolName: string;
  args: Record<string, unknown>;
  argsText: string;
}) {
  if (toolName === "runPythonCode" || TOOL_META[toolName]?.detail) return null;
  const entries = Object.entries(args ?? {}).filter(([, v]) => v !== undefined && v !== "");
  if (entries.length === 0 || !argsText || argsText === "{}") return null;
  return (
    <p className="text-muted-foreground leading-snug">
      {entries.map(([k, v], i) => (
        <span key={k}>
          {i > 0 && " · "}
          {humanizeKey(k)}: <span className="text-foreground">{String(v)}</span>
        </span>
      ))}
    </p>
  );
}

function ResultView({ toolName, result }: { toolName: string; result: unknown }) {
  if (!result || typeof result !== "object") {
    return <p className="mt-0.5 text-muted-foreground">{String(result)}</p>;
  }
  const r = result as Record<string, unknown>;

  if (r.error) {
    return <p className="mt-0.5 text-destructive">{String(r.error)}</p>;
  }

  if (toolName === "webSearch" && Array.isArray(r.results)) {
    if (r.results.length === 0) return <p className="mt-0.5 text-muted-foreground">No results.</p>;
    return (
      <ul className="mt-0.5 space-y-2">
        {r.results.map((res: any, i: number) => (
          <li key={i}>
            <a
              href={res.url}
              target="_blank"
              rel="noreferrer"
              className="text-accent underline-offset-2 hover:underline"
            >
              {res.title}
            </a>
            {res.snippet && <p className="text-muted-foreground">{res.snippet}</p>}
          </li>
        ))}
      </ul>
    );
  }

  if (toolName === "readArticlePage" && typeof r.text === "string") {
    return (
      <div className="mt-0.5 space-y-1">
        {Boolean(r.title) && <p className="text-foreground">{String(r.title)}</p>}
        <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-muted-foreground">
          {typeof r.text === "string" ? r.text || "(empty page)" : "(empty page)"}
        </p>
      </div>
    );
  }

  if (toolName === "getArticleFullContent" && typeof r.content === "string") {
    return (
      <div className="mt-0.5 space-y-1">
        {Boolean(r.title) && <p className="text-foreground">{String(r.title)}</p>}
        <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-muted-foreground">
          {r.content || "(empty)"}
        </pre>
      </div>
    );
  }

  if (toolName === "runPythonCode") {
    return (
      <div className="mt-0.5 space-y-1.5">
        {typeof r.stdout === "string" && r.stdout && (
          <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded bg-sidebar px-2 py-1.5 font-mono text-[11px] text-foreground">
            {r.stdout}
          </pre>
        )}
        {typeof r.stderr === "string" && r.stderr && (
          <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded bg-sidebar px-2 py-1.5 font-mono text-[11px] text-destructive">
            {r.stderr}
          </pre>
        )}
        {!r.stdout && !r.stderr && <p className="text-muted-foreground">(no output)</p>}
      </div>
    );
  }

  // Semantic hits carry the passages they matched on, which is the whole
  // point of using them over keyword search — show the text, not just a
  // list of titles like the generic branch below would.
  if (toolName === "searchLibrarySemantic" && Array.isArray(r.results)) {
    if (r.results.length === 0) {
      return <p className="mt-0.5 text-muted-foreground">No semantically similar papers found.</p>;
    }
    return (
      <ul className="mt-0.5 space-y-2.5">
        {r.results.map((match: any, i: number) => (
          <li key={i} className="space-y-1">
            <div className="flex items-start gap-1.5">
              <Check size={12} className="mt-0.5 shrink-0 text-accent" />
              <span className="text-foreground">{match.title ?? "untitled"}</span>
              {typeof match.bestScore === "number" && (
                <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                  {match.bestScore.toFixed(3)}
                </span>
              )}
            </div>
            {Array.isArray(match.passages) &&
              match.passages.slice(0, 2).map((p: any, j: number) => (
                <p key={j} className="pl-[18px] text-muted-foreground">
                  <span className="font-mono text-[10px]">p.{p.pageNumber}</span>{" "}
                  {String(p.text ?? "").slice(0, 220)}
                  {String(p.text ?? "").length > 220 ? "…" : ""}
                </p>
              ))}
          </li>
        ))}
      </ul>
    );
  }

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
        {String(r.total ?? "?")} indexed / {String(r.failed ?? "?")} failed
      </p>
    );
  }

  return (
    <pre className="mt-0.5 whitespace-pre-wrap break-words text-muted-foreground">
      {JSON.stringify(r, null, 2)}
    </pre>
  );
}
