"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  BookMarked,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ListChecks,
  Loader2,
  Play,
  RefreshCcw,
  Search,
  FileText,
} from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

type JournalDetail = {
  id: string;
  journalId: string;
  name: string;
  url: string;
  lastListPage: number;
  totalArticles: number | null;
  articleCount: number;
  indexed: number;
  pending: number;
  openAccess: number;
};

type SpringerArticleRow = {
  id: string;
  doi: string;
  href: string;
  title: string;
  section: string | null;
  publishedDate: string | null;
  openAccess: boolean;
  abstract: string | null;
  status: string;
  createdAt: string;
};

type Pagination = { page: number; limit: number; total: number; totalPages: number };

const LIMIT = 20;

export default function SpringerJournalDetailPage() {
  const params = useParams<{ id: string }>();
  const journalDbId = params.id;
  const { authFetch } = useAuth();

  const [journal, setJournal] = useState<JournalDetail | null>(null);
  const [articles, setArticles] = useState<SpringerArticleRow[] | null>(null);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");

  const [crawlingList, setCrawlingList] = useState(false);
  const [crawlingDetails, setCrawlingDetails] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [pageCount, setPageCount] = useState(3);
  const [detailBatch, setDetailBatch] = useState(15);

  const loadJournal = () => {
    authFetch(`/api/springer/journals/${journalDbId}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => setJournal(data.journal ?? null))
      .catch(() => setJournal(null));
  };

  const loadArticles = () => {
    const p = new URLSearchParams({ journalId: journalDbId, page: String(page), limit: String(LIMIT) });
    if (query.trim()) p.set("q", query.trim());
    authFetch(`/api/springer/articles?${p.toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        setArticles(data.articles ?? []);
        setPagination(data.pagination ?? null);
      })
      .catch(() => setArticles([]));
  };

  useEffect(loadJournal, [authFetch, journalDbId]);
  useEffect(() => {
    setArticles(null);
    loadArticles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authFetch, journalDbId, page]);

  const runStream = async (
    url: string,
    body: Record<string, unknown>,
    onEvent: (ev: Record<string, unknown>) => void
  ) => {
    const res = await authFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
        onEvent(JSON.parse(line));
      }
    }
  };

  const crawlList = async () => {
    setCrawlingList(true);
    setLog([]);
    try {
      await runStream(`/api/springer/journals/${journalDbId}/crawl-list`, { pageCount }, (ev) => {
        if (ev.type === "page_start") setLog((l) => [...l, `Fetching list page ${ev.page}…`]);
        if (ev.type === "page_done") setLog((l) => [...l, `Page ${ev.page}: found ${ev.found} articles`]);
        if (ev.type === "stopped") setLog((l) => [...l, `Stopped: ${ev.reason}`]);
        if (ev.type === "done")
          setLog((l) => [...l, `Done — ${ev.pagesCrawled} pages, ${ev.articlesFound} articles saved`]);
        if (ev.type === "fatal") setLog((l) => [...l, `Fatal: ${ev.message}`]);
      });
    } catch (err) {
      setLog((l) => [...l, err instanceof Error ? err.message : "Crawl failed"]);
    } finally {
      setCrawlingList(false);
      loadJournal();
      loadArticles();
    }
  };

  const crawlDetails = async () => {
    setCrawlingDetails(true);
    setLog([]);
    try {
      await runStream(`/api/springer/journals/${journalDbId}/crawl-details`, { limit: detailBatch }, (ev) => {
        if (ev.type === "batch_start") setLog((l) => [...l, `Fetching ${ev.total} article pages…`]);
        if (ev.type === "start") setLog((l) => [...l, `[${ev.index}/${ev.total}] ${ev.doi}`]);
        if (ev.type === "success")
          setLog((l) => [
            ...l,
            `✓ ${ev.title}${ev.openAccess ? " (open access" + (ev.hasContent ? ", content saved)" : ")") : ""}`,
          ]);
        if (ev.type === "error") setLog((l) => [...l, `✗ ${ev.doi}: ${ev.message}`]);
        if (ev.type === "done") setLog((l) => [...l, `Done — ${ev.processed} processed, ${ev.remaining} pending remain`]);
        if (ev.type === "fatal") setLog((l) => [...l, `Fatal: ${ev.message}`]);
      });
    } catch (err) {
      setLog((l) => [...l, err instanceof Error ? err.message : "Crawl failed"]);
    } finally {
      setCrawlingDetails(false);
      loadJournal();
      loadArticles();
    }
  };

  if (!journal) {
    return (
      <div className="h-full min-h-0 overflow-y-auto scrollbar-thin">
        <div className="max-w-3xl mx-auto w-full px-4 md:px-8 py-6 space-y-3">
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto scrollbar-thin">
      <div className="max-w-3xl mx-auto w-full px-4 md:px-8 py-6">
        <Link
          href="/springer"
          className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-accent mb-3"
        >
          <ChevronLeft size={12} /> journals
        </Link>

        <div className="flex items-center gap-2 mb-1">
          <BookMarked size={16} className="text-accent" />
          <h1 className="font-display font-semibold text-[18px]">{journal.name}</h1>
          <a href={journal.url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-accent">
            <ExternalLink size={13} />
          </a>
        </div>
        <p className="font-mono text-[11px] text-muted-foreground mb-6">
          journal #{journal.journalId} · list page cursor: {journal.lastListPage}
          {journal.totalArticles != null ? ` of ~${Math.ceil(journal.totalArticles / 50)} pages` : ""}
        </p>

        <div className="grid grid-cols-4 gap-3 mb-6">
          <StatCard label="crawled" value={journal.articleCount} />
          <StatCard label="indexed" value={journal.indexed} accent />
          <StatCard label="pending" value={journal.pending} />
          <StatCard label="open access" value={journal.openAccess} />
        </div>

        {/* Stage 1: crawl list */}
        <div className="rounded-lg border border-border bg-card p-3.5 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <ListChecks size={14} className="text-accent" />
            <h2 className="font-display font-semibold text-[13px]">1. Crawl article list</h2>
          </div>
          <p className="font-mono text-[11px] text-muted-foreground mb-3">
            Pages through link.springer.com/journal/{journal.journalId}/articles, saving each article's
            doi/title/href as a stub row.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <Button onClick={crawlList} disabled={crawlingList || crawlingDetails} size="sm">
              {crawlingList ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
              Crawl next batch
            </Button>
            <label className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
              pages
              <input
                type="number"
                min={1}
                max={20}
                value={pageCount}
                disabled={crawlingList}
                onChange={(e) => setPageCount(Number(e.target.value) || 1)}
                className="w-14 rounded-md border border-border bg-transparent px-2 py-1 text-foreground outline-none focus-visible:border-accent"
              />
            </label>
          </div>
        </div>

        {/* Stage 2: crawl details */}
        <div className="rounded-lg border border-border bg-card p-3.5 mb-6">
          <div className="flex items-center gap-2 mb-2">
            <FileText size={14} className="text-accent" />
            <h2 className="font-display font-semibold text-[13px]">2. Crawl abstracts / content</h2>
          </div>
          <p className="font-mono text-[11px] text-muted-foreground mb-3">
            Visits each pending article's own page for its abstract, and for open-access articles, its
            full content.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              onClick={crawlDetails}
              disabled={crawlingList || crawlingDetails || journal.pending === 0}
              size="sm"
            >
              {crawlingDetails ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
              Fetch next batch
            </Button>
            <label className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
              batch size
              <input
                type="number"
                min={1}
                max={50}
                value={detailBatch}
                disabled={crawlingDetails}
                onChange={(e) => setDetailBatch(Number(e.target.value) || 1)}
                className="w-14 rounded-md border border-border bg-transparent px-2 py-1 text-foreground outline-none focus-visible:border-accent"
              />
            </label>
          </div>
        </div>

        {log.length > 0 && (
          <div className="rounded-lg border border-border bg-sidebar p-3 mb-6 max-h-48 overflow-y-auto scrollbar-thin">
            {log.map((l, i) => (
              <p key={i} className="font-mono text-[10.5px] text-muted-foreground leading-relaxed">
                {l}
              </p>
            ))}
          </div>
        )}

        {/* Article list */}
        <div className="flex items-center gap-2 mb-3">
          <div className="flex items-center gap-2 bg-sidebar border border-border rounded-lg px-3 py-2 flex-1 focus-within:border-accent transition-colors">
            <Search size={13} className="text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setPage(1);
                  loadArticles();
                }
              }}
              placeholder="Search crawled articles…"
              className="flex-1 bg-transparent outline-none text-[13px] placeholder:text-muted-foreground"
            />
          </div>
          <Button variant="ghost" size="sm" onClick={loadArticles}>
            <RefreshCcw size={13} />
          </Button>
        </div>

        <div className="space-y-2.5">
          {articles === null &&
            Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[92px] w-full rounded-lg" />)}

          {articles?.map((a) => (
            <Link
              key={a.id}
              href={`/springer/${journalDbId}/${a.id}`}
              className="block rounded-lg border border-border bg-card p-3.5 hover:border-accent transition-colors group"
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <span className="font-mono text-[10px] text-muted-foreground truncate">{a.doi}</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  {a.openAccess && <Badge variant="accent">open access</Badge>}
                  <Badge variant={a.status === "indexed" ? "solid" : "default"}>{a.status}</Badge>
                </div>
              </div>
              <h3 className="font-display font-semibold text-[13.5px] leading-snug group-hover:text-accent transition-colors">
                {a.title}
              </h3>
              {a.abstract && <p className="text-[12px] text-muted-foreground mt-1 line-clamp-2">{a.abstract}</p>}
              <div className="flex items-center gap-2 mt-2 font-mono text-[10px] text-muted-foreground flex-wrap">
                {a.section && <span>{a.section}</span>}
                {a.publishedDate && (
                  <>
                    <span className="text-border">·</span>
                    <span>{a.publishedDate}</span>
                  </>
                )}
              </div>
            </Link>
          ))}

          {articles && articles.length === 0 && (
            <p className="font-mono text-[11px] text-muted-foreground text-center py-8">
              No articles crawled yet — run "Crawl next batch" above.
            </p>
          )}
        </div>

        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 mt-5">
            <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft size={13} />
            </Button>
            <span className="font-mono text-[11px] text-muted-foreground">
              {pagination.page} / {pagination.totalPages}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={page >= pagination.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight size={13} />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-3">
      <p className={`font-display font-semibold text-[20px] ${accent ? "text-accent" : ""}`}>{value}</p>
      <p className="font-mono text-[9.5px] uppercase tracking-wide text-muted-foreground mt-0.5">{label}</p>
    </div>
  );
}
