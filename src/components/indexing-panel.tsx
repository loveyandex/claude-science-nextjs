"use client";

/**
 * Shared UI for the two batch-indexing pages (/make-science and
 * /make-science-gemma4) — stat cards, batch-size control, NDJSON-stream
 * reading, and the live progress feed. The two pipelines differ entirely
 * server-side (plain text extraction vs. page-image + vision-model
 * transcription); this component only cares about the pending/index API
 * shapes both routes already share.
 */

import { useEffect, useRef, useState } from "react";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileText,
  Play,
  RefreshCcw,
  ExternalLink,
  Ban,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth/auth-context";

type PendingInfo = {
  total: number;
  indexed: number;
  pendingCount: number;
  pending: string[];
};

type FeedItem =
  | {
      kind: "success";
      url: string;
      pdfUrl: string;
      title: string;
      abstract: string;
      pageCount?: number;
      failedPageCount?: number;
    }
  | { kind: "llm_error"; url: string; message: string }
  | { kind: "fetch_error"; url: string; status: number; statusText: string }
  | { kind: "stopped"; reason: string };

export function IndexingPanel({
  icon: Icon,
  heading,
  description,
  pendingEndpoint,
  indexEndpoint,
}: {
  icon: LucideIcon;
  heading: string;
  description: string;
  pendingEndpoint: string;
  indexEndpoint: string;
}) {
  const { authFetch } = useAuth();
  const [info, setInfo] = useState<PendingInfo | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(true);

  const [running, setRunning] = useState(false);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [batchTotal, setBatchTotal] = useState(0);
  const [batchDone, setBatchDone] = useState(0);
  const [stoppedReason, setStoppedReason] = useState<string | null>(null);
  const [rateLimited, setRateLimited] = useState<string | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [batchSize, setBatchSize] = useState(20);
  // Pages seen so far for whichever article is currently being processed —
  // reset every "start" event. Populated live as "page_done" events arrive
  // (from resumed-from-a-previous-run pages and from the poll loop the
  // orchestrator runs while waiting on the backend), so a slow multi-page
  // PDF doesn't look stalled even though the batch-level progress bar
  // only advances once per whole article.
  const [currentPages, setCurrentPages] = useState<Set<number>>(new Set());
  const feedEndRef = useRef<HTMLDivElement>(null);

  const loadPending = async () => {
    setLoadingInfo(true);
    setInfoError(null);
    try {
      const res = await authFetch(pendingEndpoint, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to check repo");
      setInfo(data);
    } catch (err) {
      setInfoError(err instanceof Error ? err.message : "Failed to check repo");
    } finally {
      setLoadingInfo(false);
    }
  };

  useEffect(() => {
    loadPending();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingEndpoint]);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [feed, currentUrl]);

  const startIndexing = async () => {
    setRunning(true);
    setFeed([]);
    setStoppedReason(null);
    setRateLimited(null);
    setFatalError(null);
    setBatchDone(0);
    setBatchTotal(0);
    setCurrentUrl(null);
    setCurrentPages(new Set());

    try {
      const res = await authFetch(indexEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: batchSize }),
      });

      if (!res.body) throw new Error("No response stream from server");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          switch (ev.type) {
            case "list_fetched":
              setBatchTotal(Math.min(ev.pendingCount, batchSize));
              break;
            case "start":
              setCurrentUrl(ev.url);
              setCurrentPages(new Set());
              break;
            case "page_done":
              setCurrentPages((prev) => new Set(prev).add(ev.page));
              break;
            case "success":
              setFeed((prev) => [
                ...prev,
                {
                  kind: "success",
                  url: ev.url,
                  pdfUrl: ev.pdfUrl,
                  title: ev.title,
                  abstract: ev.abstract,
                  pageCount: ev.pageCount,
                  failedPageCount: ev.failedPageCount,
                },
              ]);
              setBatchDone((n) => n + 1);
              break;
            case "rate_limited":
              setRateLimited(ev.message);
              break;
            case "llm_error":
              setFeed((prev) => [...prev, { kind: "llm_error", url: ev.url, message: ev.message }]);
              setBatchDone((n) => n + 1);
              break;
            case "fetch_error":
              setFeed((prev) => [
                ...prev,
                { kind: "fetch_error", url: ev.url, status: ev.status, statusText: ev.statusText },
              ]);
              break;
            case "stopped":
              setStoppedReason(ev.reason);
              setFeed((prev) => [...prev, { kind: "stopped", reason: ev.reason }]);
              break;
            case "fatal":
              setFatalError(ev.message);
              break;
            case "done":
              setCurrentUrl(null);
              break;
          }
        }
      }
    } catch (err) {
      setFatalError(err instanceof Error ? err.message : "Indexing stream failed");
    } finally {
      setRunning(false);
      setCurrentUrl(null);
      loadPending();
    }
  };

  const pct = batchTotal > 0 ? Math.min(100, Math.round((batchDone / batchTotal) * 100)) : 0;

  return (
    <div className="h-full min-h-0 overflow-y-auto scrollbar-thin">
      <div className="max-w-3xl mx-auto w-full px-4 md:px-8 py-6">
        <div className="flex items-center gap-2 mb-1">
          <Icon size={16} className="text-accent" />
          <h1 className="font-display font-semibold text-[18px]">{heading}</h1>
        </div>
        <p className="font-mono text-[11px] text-muted-foreground mb-6">{description}</p>

        {/* Repo status */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <StatCard label="in repo" value={loadingInfo ? "…" : info?.total ?? "—"} />
          <StatCard label="indexed" value={loadingInfo ? "…" : info?.indexed ?? "—"} accent />
          <StatCard label="pending" value={loadingInfo ? "…" : info?.pendingCount ?? "—"} />
        </div>

        {infoError && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 mb-6 text-[13px]">
            <AlertTriangle size={15} className="text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-destructive">Couldn't reach the article repo</p>
              <p className="font-mono text-[11px] text-muted-foreground mt-0.5">{infoError}</p>
              <p className="text-muted-foreground mt-1">
                Check <code className="font-mono">ARTICLES_LIST_URL</code> in your{" "}
                <code className="font-mono">.env</code> file.
              </p>
            </div>
          </div>
        )}

        {/* Controls */}
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <Button onClick={startIndexing} disabled={running || loadingInfo || !info?.pendingCount}>
            {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            {running ? "Indexing..." : "Index next batch"}
          </Button>
          <label className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
            batch size
            <input
              type="number"
              min={1}
              max={100}
              value={batchSize}
              disabled={running}
              onChange={(e) => setBatchSize(Number(e.target.value) || 1)}
              className="w-16 rounded-md border border-border bg-transparent px-2 py-1 text-foreground outline-none focus-visible:border-accent"
            />
          </label>
          <Button variant="ghost" size="sm" onClick={loadPending} disabled={loadingInfo || running}>
            <RefreshCcw size={13} /> refresh
          </Button>
          {info && !info.pendingCount && !loadingInfo && (
            <span className="font-mono text-[11px] text-muted-foreground flex items-center gap-1">
              <CheckCircle2 size={13} className="text-accent" /> everything in the repo is indexed
            </span>
          )}
        </div>

        {/* Progress bar */}
        {(running || batchDone > 0) && batchTotal > 0 && (
          <div className="mb-5">
            <div className="flex justify-between font-mono text-[11px] text-muted-foreground mb-1.5">
              <span>
                {batchDone} / {batchTotal} in this batch
              </span>
              <span>{pct}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-sidebar overflow-hidden">
              <div
                className="h-full bg-accent transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            {currentUrl && (
              <p className="font-mono text-[10px] text-muted-foreground mt-1.5 truncate">
                reading: {decodeURIComponent(currentUrl)}
                {currentPages.size > 0
                  ? ` — ${currentPages.size} page${currentPages.size === 1 ? "" : "s"} transcribed so far`
                  : ""}
              </p>
            )}
          </div>
        )}

        {rateLimited && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 mb-5 text-[13px]">
            <Ban size={15} className="text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-amber-500">Rate-limited by Cerebras</p>
              <p className="font-mono text-[11px] text-muted-foreground mt-0.5">{rateLimited}</p>
              <p className="text-muted-foreground mt-1">
                Indexing paused to avoid hammering the same limit. Pages already transcribed are
                saved — re-run the batch later to resume from where it left off.
              </p>
            </div>
          </div>
        )}

        {fatalError && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 mb-5 text-[13px]">
            <XCircle size={15} className="text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-destructive">Indexing failed to start</p>
              <p className="font-mono text-[11px] text-muted-foreground mt-0.5">{fatalError}</p>
            </div>
          </div>
        )}

        {stoppedReason && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 mb-5 text-[13px]">
            <AlertTriangle size={15} className="text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-destructive">Batch stopped</p>
              <p className="text-muted-foreground mt-0.5">{stoppedReason}</p>
              <p className="font-mono text-[11px] text-muted-foreground mt-1">
                The repo returned a non-2xx response, so the loop stopped rather than continuing
                past a possibly broken source. Everything indexed before this point was saved.
              </p>
            </div>
          </div>
        )}

        {/* Live feed */}
        <div className="space-y-2.5">
          {feed.map((item, i) => (
            <FeedRow key={i} item={item} />
          ))}
          <div ref={feedEndRef} />
        </div>

        {!running && feed.length === 0 && !fatalError && info?.pendingCount ? (
          <p className="font-mono text-[11px] text-muted-foreground text-center py-8">
            {info.pendingCount} article{info.pendingCount === 1 ? "" : "s"} waiting to be indexed.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-3">
      <p className={`font-display font-semibold text-[22px] ${accent ? "text-accent" : ""}`}>
        {value}
      </p>
      <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground mt-0.5">
        {label}
      </p>
    </div>
  );
}

function FeedRow({ item }: { item: FeedItem }) {
  if (item.kind === "success") {
    return (
      <div className="rounded-lg border border-border bg-card p-3.5 animate-slide-up">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 min-w-0">
            <CheckCircle2 size={15} className="text-accent shrink-0 mt-0.5" />
            <div className="min-w-0">
              <h3 className="font-display font-semibold text-[13.5px] leading-snug">
                {item.title}
              </h3>
              <p className="text-[12.5px] text-muted-foreground mt-1 line-clamp-2">
                {item.abstract}
              </p>
              {typeof item.pageCount === "number" && (
                <p className="font-mono text-[10px] text-muted-foreground mt-1">
                  {item.pageCount} page{item.pageCount === 1 ? "" : "s"} transcribed
                  {item.failedPageCount ? (
                    <span className="text-destructive"> — {item.failedPageCount} failed, will retry</span>
                  ) : null}
                </p>
              )}
            </div>
          </div>
          <a
            href={item.pdfUrl}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 flex items-center gap-1 font-mono text-[10px] text-muted-foreground hover:text-accent transition-colors"
          >
            <ExternalLink size={11} /> pdf
          </a>
        </div>
      </div>
    );
  }
  if (item.kind === "llm_error") {
    return (
      <div className="rounded-lg border border-border bg-card p-3 flex items-start gap-2 animate-slide-up">
        <XCircle size={15} className="text-destructive shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="font-mono text-[11px] truncate">{decodeURIComponent(item.url)}</p>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            Extraction failed: {item.message}
          </p>
        </div>
      </div>
    );
  }
  if (item.kind === "fetch_error") {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 flex items-start gap-2 animate-slide-up">
        <FileText size={15} className="text-destructive shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="font-mono text-[11px] truncate">{decodeURIComponent(item.url)}</p>
          <p className="text-[12px] text-destructive mt-0.5">
            PDF fetch returned {item.status} {item.statusText}
          </p>
        </div>
      </div>
    );
  }
  return null;
}
