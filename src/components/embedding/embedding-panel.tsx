"use client";

/**
 * /make-embedding — chunk every indexed page and push it into Qdrant.
 *
 * Sibling of IndexingPanel (the two make-science pages) and reads the
 * same NDJSON-stream-of-events shape, but the unit of work is different
 * enough to warrant its own component: progress here is three levels deep
 * (run -> article -> page -> chunks within a page), and the pipeline is
 * resumable at the innermost level, which is the thing the UI most needs
 * to make legible. A stopped run isn't lost work, and the panel should
 * say so plainly rather than looking like a failure.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Boxes,
  Check,
  ChevronDown,
  Database,
  Layers,
  Loader2,
  Play,
  RefreshCcw,
  RotateCcw,
  Search,
  Square,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/components/auth/auth-context";
import { cn } from "@/lib/utils";

type EmbeddingSettings = {
  collection: string;
  model: string;
  chunkTokens: number;
  chunkOverlap: number;
  pageBatch: number;
};

type PendingInfo = {
  settings: EmbeddingSettings;
  stats: {
    articles: { withPages: number; embedded: number; partial: number; pending: number };
    pages: { total: number; embedded: number; partial: number; pending: number; failed: number };
    chunks: { embedded: number; known: number };
  };
  pendingPages: number;
  backend: {
    url: string;
    reachable: boolean;
    error: string | null;
    collection: {
      name: string;
      exists: boolean;
      pointsCount: number;
      status: string;
      model: string;
    } | null;
  };
};

type LivePage = {
  pageId: string;
  articleId: string;
  pageNumber: number;
  chunkCount: number;
  embeddedChunks: number;
  status: string;
};

type ArticleRow = {
  articleId: string;
  title: string;
  url: string;
  pageCount: number;
  pagesDone: number;
  chunks: number;
  status: "running" | "embedded" | "partial" | "failed";
  failedPages: number;
};

const RUN_LIMIT_DEFAULT = 200;

export function EmbeddingPanel() {
  const { authFetch } = useAuth();

  const [info, setInfo] = useState<PendingInfo | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(true);

  const [running, setRunning] = useState(false);
  const [runLimit, setRunLimit] = useState(RUN_LIMIT_DEFAULT);
  const [recheckAll, setRecheckAll] = useState(false);
  const [showTuning, setShowTuning] = useState(false);

  const [totalPages, setTotalPages] = useState(0);
  const [pagesDone, setPagesDone] = useState(0);
  const [chunksEmbedded, setChunksEmbedded] = useState(0);
  const [livePages, setLivePages] = useState<Map<string, LivePage>>(new Map());
  const [articles, setArticles] = useState<ArticleRow[]>([]);
  const [stoppedReason, setStoppedReason] = useState<string | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const feedEndRef = useRef<HTMLDivElement>(null);

  const loadInfo = useCallback(async () => {
    setLoadingInfo(true);
    setInfoError(null);
    try {
      const res = await authFetch("/api/embeddings/pending", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to read embedding status");
      setInfo(data);
    } catch (err) {
      setInfoError(err instanceof Error ? err.message : "Failed to read embedding status");
    } finally {
      setLoadingInfo(false);
    }
  }, [authFetch]);

  useEffect(() => {
    loadInfo();
  }, [loadInfo]);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [articles, livePages]);

  // Aborting the fetch is the stop mechanism end-to-end: the server's
  // request signal fires, the orchestrator stops sending batches, and
  // everything already embedded stays embedded.
  useEffect(() => () => abortRef.current?.abort(), []);

  const upsertArticle = (articleId: string, patch: Partial<ArticleRow> & { title?: string }) => {
    setArticles((prev) => {
      const index = prev.findIndex((a) => a.articleId === articleId);
      if (index === -1) {
        return [
          ...prev,
          {
            articleId,
            title: patch.title ?? articleId,
            url: patch.url ?? "",
            pageCount: patch.pageCount ?? 0,
            pagesDone: patch.pagesDone ?? 0,
            chunks: patch.chunks ?? 0,
            status: patch.status ?? "running",
            failedPages: patch.failedPages ?? 0,
          },
        ];
      }
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  };

  const startRun = async () => {
    const controller = new AbortController();
    abortRef.current = controller;

    setRunning(true);
    setStoppedReason(null);
    setFatalError(null);
    setSummary(null);
    setTotalPages(0);
    setPagesDone(0);
    setChunksEmbedded(0);
    setLivePages(new Map());
    setArticles([]);

    try {
      const res = await authFetch("/api/embeddings/index", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: runLimit, mode: recheckAll ? "all" : "resume" }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Indexing request failed: ${res.status} ${res.statusText}`);
      }
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
          let ev: any;
          try {
            ev = JSON.parse(line);
          } catch {
            continue;
          }

          switch (ev.type) {
            case "start":
              setTotalPages(ev.totalPages);
              break;

            case "article_start":
              upsertArticle(ev.articleId, {
                title: ev.title,
                url: ev.url,
                pageCount: ev.pageCount,
                status: "running",
              });
              break;

            case "page_progress":
              setLivePages((prev) => {
                const next = new Map(prev);
                next.set(ev.pageId, {
                  pageId: ev.pageId,
                  articleId: ev.articleId,
                  pageNumber: ev.pageNumber,
                  chunkCount: ev.chunkCount,
                  embeddedChunks: ev.embeddedChunks,
                  status: ev.status,
                });
                return next;
              });
              break;

            case "page_done": {
              setLivePages((prev) => {
                const next = new Map(prev);
                next.delete(ev.pageId);
                return next;
              });
              setPagesDone((n) => n + 1);
              setChunksEmbedded((n) => n + ev.embeddedChunks);
              setArticles((prev) => {
                const index = prev.findIndex((a) => a.articleId === ev.articleId);
                if (index === -1) return prev;
                const next = [...prev];
                const row = next[index];
                next[index] = {
                  ...row,
                  pagesDone: row.pagesDone + 1,
                  chunks: row.chunks + ev.embeddedChunks,
                  failedPages: row.failedPages + (ev.status === "failed" ? 1 : 0),
                };
                return next;
              });
              break;
            }

            case "article_done":
              upsertArticle(ev.articleId, {
                status:
                  ev.status === "embedded"
                    ? "embedded"
                    : ev.status === "failed"
                      ? "failed"
                      : "partial",
              });
              break;

            case "stopped":
              setStoppedReason(ev.reason);
              break;

            case "fatal":
              setFatalError(ev.message);
              break;

            case "done":
              setSummary(
                `${ev.pagesProcessed} page${ev.pagesProcessed === 1 ? "" : "s"} processed · ` +
                  `${ev.chunksEmbedded} chunk${ev.chunksEmbedded === 1 ? "" : "s"} embedded` +
                  (ev.failedPages ? ` · ${ev.failedPages} failed` : "") +
                  ` · ${ev.remaining} page${ev.remaining === 1 ? "" : "s"} still pending`
              );
              break;
          }
        }
      }
    } catch (err) {
      // An abort is the Stop button doing its job, not an error.
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        setFatalError(err instanceof Error ? err.message : "Embedding run failed");
      }
    } finally {
      abortRef.current = null;
      setRunning(false);
      setLivePages(new Map());
      loadInfo();
    }
  };

  const stopRun = () => {
    abortRef.current?.abort();
    setStoppedReason(
      "Stopped. Every chunk embedded so far is saved — starting again picks up from the next unfinished chunk."
    );
  };

  const resetEverything = async () => {
    if (
      !window.confirm(
        "Drop the entire Qdrant collection and reset every page's embedding progress?\n\n" +
          "The transcribed page text in Postgres is untouched — but everything will need to be embedded again from scratch."
      )
    ) {
      return;
    }
    setResetting(true);
    try {
      const res = await authFetch("/api/embeddings/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true, dropCollection: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Reset failed");
      setSummary(`Reset ${data.pagesReset} page(s) and dropped collection "${data.collection}".`);
      setArticles([]);
      setPagesDone(0);
      setChunksEmbedded(0);
    } catch (err) {
      setFatalError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setResetting(false);
      loadInfo();
    }
  };

  const runPct = totalPages > 0 ? Math.round((pagesDone / totalPages) * 100) : 0;
  const stats = info?.stats;
  const coveragePct =
    stats && stats.pages.total > 0
      ? Math.round((stats.pages.embedded / stats.pages.total) * 100)
      : 0;

  return (
    <div className="h-full min-h-0 overflow-y-auto scrollbar-thin">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8">
        <div className="mb-1 flex items-center gap-2">
          <Boxes size={16} className="text-accent" />
          <h1 className="font-display text-[18px] font-semibold">make / embedding</h1>
        </div>
        <p className="mb-3 font-mono text-[11px] text-muted-foreground">
          Splits every transcribed page into overlapping ~{info?.settings.chunkTokens ?? 500}-token
          chunks and embeds them into Qdrant, so the chat agent can find papers by meaning instead
          of keywords. Resumable per chunk — stop any time and pick up where it left off.
        </p>

        <ConfigLine info={info} loading={loadingInfo} onTune={() => setShowTuning(true)} />

        {/* Repo status */}
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label="pages embedded"
            value={stats ? `${stats.pages.embedded}/${stats.pages.total}` : null}
            accent
          />
          <StatCard label="pages pending" value={info ? String(info.pendingPages) : null} />
          <StatCard
            label="chunks in qdrant"
            value={
              info?.backend.collection ? String(info.backend.collection.pointsCount) : info ? "—" : null
            }
          />
          <StatCard
            label="papers searchable"
            value={stats ? `${stats.articles.embedded}/${stats.articles.withPages}` : null}
          />
        </div>

        {info && stats && stats.pages.total > 0 && (
          <div className="mb-6 animate-fade-in">
            <div className="mb-1.5 flex justify-between font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              <span>library coverage</span>
              <span>{coveragePct}%</span>
            </div>
            <Progress value={coveragePct} label="Library embedding coverage" />
          </div>
        )}

        {infoError && (
          <Callout tone="danger" icon={XCircle} title="Couldn't read embedding status">
            <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{infoError}</p>
          </Callout>
        )}

        {info && !info.backend.reachable && (
          <Callout tone="warning" icon={AlertTriangle} title="Embedding backend unreachable">
            <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
              {info.backend.error}
            </p>
            <p className="mt-1 text-muted-foreground">
              Start the FastAPI service (<code className="font-mono">uvicorn main:app</code> in{" "}
              <code className="font-mono">backend/</code>) and make sure Qdrant is running at the
              URL in <code className="font-mono">backend/.env</code>. See{" "}
              <code className="font-mono">backend/README.md</code>.
            </p>
          </Callout>
        )}

        {/* Controls */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          {running ? (
            <Button variant="outline" onClick={stopRun}>
              <Square size={13} /> Stop
            </Button>
          ) : (
            <Button
              onClick={startRun}
              disabled={loadingInfo || resetting || (!info?.pendingPages && !recheckAll)}
            >
              <Play size={14} /> Embed next batch
            </Button>
          )}

          <label className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
            max pages
            <input
              type="number"
              min={1}
              max={2000}
              value={runLimit}
              disabled={running}
              onChange={(e) => setRunLimit(Number(e.target.value) || 1)}
              className="w-20 rounded-md border border-border bg-transparent px-2 py-1 text-foreground outline-none transition-colors focus-visible:border-accent disabled:opacity-50"
            />
          </label>

          <label className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
            <Switch checked={recheckAll} onCheckedChange={setRecheckAll} disabled={running} />
            re-check all pages
          </label>

          <Button variant="ghost" size="sm" onClick={loadInfo} disabled={loadingInfo || running}>
            <RefreshCcw size={13} /> refresh
          </Button>

          {info && !info.pendingPages && !loadingInfo && !running && (
            <span className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
              <Check size={13} className="text-success" /> every page is embedded
            </span>
          )}
        </div>

        <TuningRow
          open={showTuning}
          onToggle={() => setShowTuning((v) => !v)}
          settings={info?.settings ?? null}
          disabled={running || resetting}
          onSaved={loadInfo}
          onReset={resetEverything}
          resetting={resetting}
        />

        {/* Run progress */}
        {(running || pagesDone > 0) && totalPages > 0 && (
          <div className="mb-5 animate-slide-up">
            <div className="mb-1.5 flex justify-between font-mono text-[11px] text-muted-foreground">
              <span>
                {pagesDone} / {totalPages} pages in this run · {chunksEmbedded} chunks embedded
              </span>
              <span>{runPct}%</span>
            </div>
            <Progress value={runPct} label="Embedding run progress" />

            {livePages.size > 0 && (
              <div className="mt-3 space-y-2">
                {Array.from(livePages.values())
                  .sort((a, b) => a.pageNumber - b.pageNumber)
                  .map((page) => (
                    <LivePageRow key={page.pageId} page={page} />
                  ))}
              </div>
            )}
          </div>
        )}

        {fatalError && (
          <Callout tone="danger" icon={XCircle} title="Embedding run failed">
            <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{fatalError}</p>
          </Callout>
        )}

        {stoppedReason && (
          <Callout tone="warning" icon={AlertTriangle} title="Run stopped">
            <p className="mt-0.5 text-muted-foreground">{stoppedReason}</p>
          </Callout>
        )}

        {summary && !fatalError && (
          <Callout tone="success" icon={Check} title="Run finished">
            <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{summary}</p>
          </Callout>
        )}

        {/* Per-article feed */}
        <div className="space-y-2">
          {articles.map((article) => (
            <ArticleRowView key={article.articleId} article={article} />
          ))}
          <div ref={feedEndRef} />
        </div>

        {!running && articles.length === 0 && !fatalError && (
          <EmptyState info={info} loading={loadingInfo} />
        )}
      </div>
    </div>
  );
}

function ConfigLine({
  info,
  loading,
  onTune,
}: {
  info: PendingInfo | null;
  loading: boolean;
  onTune: () => void;
}) {
  if (loading || !info) {
    return <Skeleton className="mb-6 h-4 w-72" />;
  }
  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <Database size={12} />
        {info.settings.collection}
        {info.backend.collection?.exists === false && (
          <span className="text-muted-foreground/70">(not created yet)</span>
        )}
      </span>
      <span className="flex items-center gap-1.5">
        <Layers size={12} />
        {info.settings.model}
      </span>
      <span>
        {info.settings.chunkTokens} tok · {info.settings.chunkOverlap} overlap ·{" "}
        {info.settings.pageBatch} pages/batch
      </span>
      <button onClick={onTune} className="text-accent hover:underline">
        tune
      </button>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | null;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-card px-3 py-3">
      {value === null ? (
        <Skeleton className="h-[26px] w-16" />
      ) : (
        <p className={cn("font-display text-[22px] font-semibold", accent && "text-accent")}>
          {value}
        </p>
      )}
      <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

function LivePageRow({ page }: { page: LivePage }) {
  // Chunk count is only known once the backend has chunked the page, so
  // the bar is indeterminate until then rather than sitting at 0%.
  const pct = page.chunkCount > 0 ? (page.embeddedChunks / page.chunkCount) * 100 : null;
  return (
    <div className="animate-fade-in">
      <div className="mb-1 flex items-center justify-between font-mono text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Loader2 size={10} className="animate-spin text-accent" />
          page {page.pageNumber}
        </span>
        <span>
          {page.chunkCount > 0
            ? `${page.embeddedChunks}/${page.chunkCount} chunks`
            : "chunking…"}
        </span>
      </div>
      <Progress value={pct} label={`Page ${page.pageNumber} chunk progress`} />
    </div>
  );
}

function ArticleRowView({ article }: { article: ArticleRow }) {
  const pct = article.pageCount > 0 ? Math.round((article.pagesDone / article.pageCount) * 100) : 0;
  const done = article.status !== "running";

  return (
    <div className="rounded-lg border border-border/70 bg-card p-3 animate-slide-up">
      <div className="flex items-start gap-2">
        <StatusIcon status={article.status} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-display text-[13.5px] font-semibold leading-snug">
            {article.title}
          </h3>
          <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
            {article.pagesDone}/{article.pageCount} pages · {article.chunks} chunks
            {article.failedPages > 0 && (
              <span className="text-destructive"> · {article.failedPages} failed</span>
            )}
          </p>
          {!done && <Progress value={pct} className="mt-2" label={`${article.title} progress`} />}
        </div>
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: ArticleRow["status"] }) {
  if (status === "running") {
    return <Loader2 size={15} className="mt-0.5 shrink-0 animate-spin text-accent" />;
  }
  if (status === "embedded") {
    return <Check size={15} className="mt-0.5 shrink-0 text-success" />;
  }
  if (status === "failed") {
    return <XCircle size={15} className="mt-0.5 shrink-0 text-destructive" />;
  }
  return <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warning" />;
}

function TuningRow({
  open,
  onToggle,
  settings,
  disabled,
  onSaved,
  onReset,
  resetting,
}: {
  open: boolean;
  onToggle: () => void;
  settings: EmbeddingSettings | null;
  disabled: boolean;
  onSaved: () => void;
  onReset: () => void;
  resetting: boolean;
}) {
  const { authFetch } = useAuth();
  const [draft, setDraft] = useState<EmbeddingSettings | null>(settings);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setNotice(null);
    try {
      const res = await authFetch("/api/settings/embedding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chunkTokens: draft.chunkTokens,
          chunkOverlap: draft.chunkOverlap,
          pageBatch: draft.pageBatch,
          collection: draft.collection,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't save settings");
      setDraft({
        collection: data.collection,
        model: data.model,
        chunkTokens: data.chunkTokens,
        chunkOverlap: data.chunkOverlap,
        pageBatch: data.pageBatch,
      });
      setNotice(
        data.invalidatesExistingEmbeddings
          ? "Saved. Chunk boundaries changed, so already-embedded pages will be re-embedded (and their old vectors replaced) on the next run."
          : "Saved."
      );
      onSaved();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Couldn't save settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-6">
      <button
        onClick={onToggle}
        className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronDown
          size={12}
          className={cn("transition-transform duration-200", open && "rotate-180")}
        />
        chunking &amp; collection
      </button>

      {open && draft && (
        <div className="mt-2.5 space-y-3 rounded-lg border border-border/70 bg-card p-3.5 animate-slide-up">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <NumberField
              label="chunk tokens"
              value={draft.chunkTokens}
              min={64}
              max={512}
              disabled={disabled || saving}
              onChange={(v) => setDraft({ ...draft, chunkTokens: v })}
            />
            <NumberField
              label="overlap"
              value={draft.chunkOverlap}
              min={0}
              max={256}
              disabled={disabled || saving}
              onChange={(v) => setDraft({ ...draft, chunkOverlap: v })}
            />
            <NumberField
              label="pages/batch"
              value={draft.pageBatch}
              min={1}
              max={50}
              disabled={disabled || saving}
              onChange={(v) => setDraft({ ...draft, pageBatch: v })}
            />
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                collection
              </span>
              <input
                value={draft.collection}
                disabled={disabled || saving}
                onChange={(e) => setDraft({ ...draft, collection: e.target.value })}
                className="rounded-md border border-border bg-transparent px-2 py-1 font-mono text-[11px] outline-none transition-colors focus-visible:border-accent disabled:opacity-50"
              />
            </label>
          </div>

          <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
            Chunk size and model are folded into each page&apos;s content hash — changing either
            makes previously-embedded pages stop matching, so they get re-chunked and their old
            vectors replaced on the next run. The embedding model itself is set in{" "}
            <code>backend/.env</code>.
          </p>

          {notice && <p className="text-[12px] text-muted-foreground">{notice}</p>}

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={save} disabled={disabled || saving}>
              {saving ? <Loader2 size={12} className="animate-spin" /> : null} Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onReset}
              disabled={disabled || resetting}
              className="text-destructive hover:bg-destructive/10"
            >
              {resetting ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RotateCcw size={12} />
              )}
              drop collection &amp; reset
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value) || min)}
        className="rounded-md border border-border bg-transparent px-2 py-1 font-mono text-[11px] outline-none transition-colors focus-visible:border-accent disabled:opacity-50"
      />
    </label>
  );
}

function Callout({
  tone,
  icon: Icon,
  title,
  children,
}: {
  tone: "danger" | "warning" | "success";
  icon: typeof AlertTriangle;
  title: string;
  children: React.ReactNode;
}) {
  const tones = {
    danger: "border-destructive/30 bg-destructive/5 text-destructive",
    warning: "border-warning/30 bg-warning/5 text-warning",
    success: "border-success/30 bg-success/5 text-success",
  } as const;

  return (
    <div
      className={cn(
        "mb-5 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[13px] animate-slide-up",
        tones[tone]
      )}
    >
      <Icon size={15} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        {children}
      </div>
    </div>
  );
}

function EmptyState({ info, loading }: { info: PendingInfo | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="space-y-2 py-6">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-3/4" />
      </div>
    );
  }
  if (!info) return null;

  if (info.stats.pages.total === 0) {
    return (
      <div className="py-10 text-center">
        <Search size={18} className="mx-auto mb-2 text-muted-foreground" />
        <p className="font-mono text-[11px] text-muted-foreground">
          No transcribed pages to embed yet — run{" "}
          <Link href="/make-science-gemma4" className="text-accent hover:underline">
            /make-science-gemma4
          </Link>{" "}
          first.
        </p>
      </div>
    );
  }

  return (
    <p className="py-8 text-center font-mono text-[11px] text-muted-foreground">
      {info.pendingPages > 0
        ? `${info.pendingPages} page${info.pendingPages === 1 ? "" : "s"} waiting to be embedded.`
        : "Everything is embedded. The chat agent can search this library semantically."}
    </p>
  );
}
