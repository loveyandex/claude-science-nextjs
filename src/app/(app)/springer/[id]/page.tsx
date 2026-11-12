"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { BookMarked, ChevronLeft, ChevronRight, ExternalLink, ListChecks, Loader2, Play, RefreshCcw, Search } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  HeadlessToggle,
  NumberField,
  PipelineSteps,
  RunLog,
  runNdjsonStream,
  StatCard,
  useStoredBool,
  type StageStats,
} from "@/components/springer/pipeline-steps";
import { VlmStep } from "@/components/springer/vlm-step";
import type { VlmCounts, VlmJob } from "@/lib/springer-vlm";

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
  pdf: { downloaded: number; notFound: number; failed: number; untried: number };
  vlm: VlmCounts;
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
  pdfStatus: string | null;
  createdAt: string;
};

type Pagination = { page: number; limit: number; total: number; totalPages: number };

type SpringerVolume = {
  volume: number;
  period: string | null;
  issues: { issue: string; month: string | null; title: string | null }[];
};

// The articles a stage-1 run saved (new or already known), so stages 2 and
// 3 can be pointed at just them.
type LastRun = { label: string; dois: string[]; at: string };

type ScopeStats = StageStats & { total: number; indexed: number; failed: number; vlm: VlmCounts };

const MAX_ISSUES_PER_RUN = 60;
const MAX_LOG_LINES = 500;

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
  const [stepsBusy, setStepsBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [pageCount, setPageCount] = useState(3);
  const [listHeadless, setListHeadless] = useStoredBool("springer:headless:list", false);
  const [listByIssue, setListByIssue] = useStoredBool("springer:list:byIssue", false);
  const [volumeNum, setVolumeNum] = useState(1);
  const [issueFrom, setIssueFrom] = useState(1);
  const [issueTo, setIssueTo] = useState(1);
  const [volumes, setVolumes] = useState<SpringerVolume[] | null>(null);
  const [loadingVolumes, setLoadingVolumes] = useState(false);
  const [volumesError, setVolumesError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<LastRun | null>(null);
  const [scopeLastRun, setScopeLastRun] = useStoredBool("springer:scope:lastRun", true);
  const [scopeStats, setScopeStats] = useState<ScopeStats | null>(null);
  const busy = crawlingList || stepsBusy;
  const volumesCacheKey = `springer:volumes:${journalDbId}`;
  const lastRunKey = `springer:lastRun:${journalDbId}`;
  const useLastRunScope = scopeLastRun && !!lastRun && lastRun.dois.length > 0;

  const appendLog = (line: string) => setLog((l) => [...l, line].slice(-MAX_LOG_LINES));

  const selectedVolume = volumes?.find((v) => v.volume === volumeNum) ?? null;
  const issueLo = Math.min(issueFrom, issueTo);
  const issueHi = Math.max(issueFrom, issueTo);
  // With the index loaded, crawl the issues that actually exist in the range
  // (and keep Springer's own labels, e.g. a combined "1-2"); without it,
  // assume plain consecutive issue numbers.
  const issuesToCrawl: SpringerVolume["issues"] = selectedVolume
    ? selectedVolume.issues
        .filter((i) => {
          const n = parseInt(i.issue, 10);
          return n >= issueLo && n <= issueHi;
        })
        .sort((a, b) => parseInt(a.issue, 10) - parseInt(b.issue, 10))
    : Array.from({ length: Math.min(issueHi - issueLo + 1, MAX_ISSUES_PER_RUN + 1) }, (_, k) => ({
        issue: String(issueLo + k),
        month: null,
        title: null,
      }));

  const pickVolume = (v: SpringerVolume) => {
    const nums = v.issues.map((i) => parseInt(i.issue, 10)).filter((n) => !Number.isNaN(n));
    setVolumeNum(v.volume);
    setIssueFrom(nums.length ? Math.min(...nums) : 1);
    setIssueTo(nums.length ? Math.max(...nums) : 1);
  };

  useEffect(() => {
    try {
      const cached = localStorage.getItem(volumesCacheKey);
      if (!cached) return;
      const parsed: SpringerVolume[] = JSON.parse(cached);
      setVolumes(parsed);
      if (parsed[0]) pickVolume(parsed[0]);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volumesCacheKey]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(lastRunKey);
      if (stored) setLastRun(JSON.parse(stored));
    } catch {}
  }, [lastRunKey]);

  const saveLastRun = (run: LastRun) => {
    setLastRun(run);
    try {
      localStorage.setItem(lastRunKey, JSON.stringify(run));
    } catch {}
  };

  const loadScopeStats = () => {
    if (!lastRun || lastRun.dois.length === 0) {
      setScopeStats(null);
      return;
    }
    authFetch(`/api/springer/journals/${journalDbId}/scope`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dois: lastRun.dois }),
    })
      .then((res) => res.json())
      .then((data) => setScopeStats(data.scope ?? null))
      .catch(() => setScopeStats(null));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadScopeStats, [authFetch, journalDbId, lastRun]);

  const loadVolumes = async () => {
    setLoadingVolumes(true);
    setVolumesError(null);
    try {
      const res = await authFetch(`/api/springer/journals/${journalDbId}/volumes?headless=${listHeadless ? "1" : "0"}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      setVolumes(data.volumes);
      try {
        localStorage.setItem(volumesCacheKey, JSON.stringify(data.volumes));
      } catch {}
      if (!data.volumes.some((v: SpringerVolume) => v.volume === volumeNum) && data.volumes[0]) {
        pickVolume(data.volumes[0]);
      }
    } catch (err) {
      setVolumesError(err instanceof Error ? err.message : "Failed to load volumes");
    } finally {
      setLoadingVolumes(false);
    }
  };

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

  const refreshAll = () => {
    loadJournal();
    loadArticles();
    loadScopeStats();
  };

  // Refresh the counts each time the PDF-reading job finishes an article.
  const jobProgress = useRef<string | null>(null);
  const onVlmJob = (job: VlmJob | null) => {
    const key = job ? `${job.id}:${job.processed}` : null;
    if (jobProgress.current !== null && key !== jobProgress.current) refreshAll();
    jobProgress.current = key;
  };

  const crawlList = async () => {
    setCrawlingList(true);
    setLog([]);
    const dois: string[] = [];
    const pages: number[] = [];
    try {
      await runNdjsonStream(
        authFetch,
        `/api/springer/journals/${journalDbId}/crawl-list`,
        { pageCount, headless: listHeadless },
        (ev) => {
          if (ev.type === "page_start") appendLog(`Fetching list page ${ev.page}…`);
          if (ev.type === "page_done") {
            appendLog(`Page ${ev.page}: found ${ev.found} articles, ${ev.added} new`);
            dois.push(...(ev.dois as string[]));
            pages.push(ev.page as number);
            const label =
              pages.length === 1 ? `list page ${pages[0]}` : `list pages ${pages[0]}–${pages[pages.length - 1]}`;
            saveLastRun({ label, dois: [...dois], at: new Date().toISOString() });
          }
          if (ev.type === "stopped") appendLog(`Stopped: ${ev.reason}`);
          if (ev.type === "done") appendLog(`Done — ${ev.pagesCrawled} pages, ${ev.articlesFound} articles saved`);
          if (ev.type === "fatal") appendLog(`Fatal: ${ev.message}`);
        }
      );
    } catch (err) {
      appendLog(err instanceof Error ? err.message : "Crawl failed");
    } finally {
      setCrawlingList(false);
      loadJournal();
      loadArticles();
    }
  };

  const crawlIssues = async () => {
    setCrawlingList(true);
    setLog([]);
    const dois: string[] = [];
    const done: string[] = [];
    try {
      await runNdjsonStream(
        authFetch,
        `/api/springer/journals/${journalDbId}/crawl-issues`,
        { volume: volumeNum, issues: issuesToCrawl.map((i) => i.issue), headless: listHeadless },
        (ev) => {
          if (ev.type === "issue_start") appendLog(`[${ev.index}/${ev.total}] Fetching volume ${ev.volume}, issue ${ev.issue}…`);
          if (ev.type === "issue_done") {
            appendLog(
              `Issue ${ev.issue}: found ${ev.found}${ev.totalArticles != null ? ` of ${ev.totalArticles}` : ""} articles, ${ev.added} new`
            );
            dois.push(...(ev.dois as string[]));
            done.push(ev.issue as string);
            const label =
              done.length === 1
                ? `vol ${volumeNum} · issue ${done[0]}`
                : `vol ${volumeNum} · issues ${done[0]}–${done[done.length - 1]}`;
            saveLastRun({ label, dois: [...dois], at: new Date().toISOString() });
          }
          if (ev.type === "issue_error") appendLog(`✗ Issue ${ev.issue}: ${ev.message}`);
          if (ev.type === "done") {
            appendLog(`Done — ${ev.issuesCrawled} issues, ${ev.articlesFound} articles saved (${ev.articlesAdded} new)`);
            if ((ev.articlesFound as number) > 0 && ev.articlesAdded === 0)
              appendLog(
                "All of them were already saved (e.g. by page mode), so the crawled count doesn't change — run steps 2 and 3 on \"last step 1 run\" to process just these."
              );
          }
          if (ev.type === "fatal") appendLog(`Fatal: ${ev.message}`);
        }
      );
    } catch (err) {
      appendLog(err instanceof Error ? err.message : "Crawl failed");
    } finally {
      setCrawlingList(false);
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

  const stageStats: StageStats | null = useLastRunScope
    ? scopeStats
    : { pending: journal.pending, pdf: journal.pdf };

  const scopePicker = (
    <>
      <div className="inline-flex items-center rounded-md border border-border p-0.5 font-mono text-[10.5px] mb-2">
        {(
          [
            [true, lastRun ? `last step 1 run · ${lastRun.label}` : "last step 1 run"],
            [false, "all remaining in journal"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={String(value)}
            type="button"
            disabled={busy || (value && !lastRun)}
            onClick={() => setScopeLastRun(value)}
            className={`rounded px-2 py-0.5 transition-colors disabled:opacity-50 ${
              (value ? useLastRunScope : !useLastRunScope)
                ? "bg-sidebar text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="font-mono text-[10.5px] text-muted-foreground">
        {useLastRunScope && lastRun
          ? scopeStats
            ? `${lastRun.dois.length} articles from ${lastRun.label} (crawled ${new Date(lastRun.at).toLocaleString()}) — ${scopeStats.indexed} indexed, ${scopeStats.pending} pending, ${scopeStats.failed} failed`
            : `${lastRun.dois.length} articles from ${lastRun.label}…`
          : !lastRun
            ? "Run step 1 to point steps 2 and 3 at just the articles it found. Until then they work through the whole journal, oldest first."
            : `Every article in the journal that still needs a step, oldest first — ${journal.pending} pending.`}
      </p>
    </>
  );

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

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
          <StatCard label="crawled" value={journal.articleCount} />
          <StatCard label="indexed" value={journal.indexed} accent />
          <StatCard label="pending →" value={journal.pending} href={`/springer/${journalDbId}/pending`} />
          <StatCard label="open access" value={journal.openAccess} />
          <StatCard
            label={`pdfs · ${journal.vlm.done} read →`}
            value={journal.pdf.downloaded}
            accent
            href={`/springer/${journalDbId}/pdfs`}
          />
        </div>

        {/* Stage 1: crawl list */}
        <div className="rounded-lg border border-border bg-card p-3.5 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <ListChecks size={14} className="text-accent" />
            <h2 className="font-display font-semibold text-[13px]">1. Crawl article list</h2>
            <div className="ml-auto flex items-center rounded-md border border-border p-0.5 font-mono text-[10.5px]">
              {(
                [
                  [false, "by page"],
                  [true, "by volume / issue"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={label}
                  type="button"
                  disabled={crawlingList}
                  onClick={() => setListByIssue(value)}
                  className={`rounded px-2 py-0.5 transition-colors ${
                    listByIssue === value ? "bg-sidebar text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {!listByIssue ? (
            <>
              <p className="font-mono text-[11px] text-muted-foreground mb-3">
                Pages through link.springer.com/journal/{journal.journalId}/articles, saving each article&apos;s
                doi/title/href as a stub row.
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <Button onClick={crawlList} disabled={busy} size="sm">
                  {crawlingList ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                  Crawl next batch
                </Button>
                <NumberField label="pages" value={pageCount} onChange={setPageCount} max={20} width="w-14" disabled={crawlingList} />
                <HeadlessToggle checked={listHeadless} onChange={setListHeadless} disabled={crawlingList} />
              </div>
            </>
          ) : (
            <>
              <p className="font-mono text-[11px] text-muted-foreground mb-3 break-all">
                Crawls link.springer.com/journal/{journal.journalId}/volumes-and-issues/&lt;volume&gt;-&lt;issue&gt;
                for each issue in the range, saving every article in it as a stub row — same as page mode.
              </p>

              <div className="flex items-center gap-2 flex-wrap mb-2.5">
                {volumes && (
                  <select
                    value={selectedVolume ? String(selectedVolume.volume) : ""}
                    disabled={crawlingList}
                    onChange={(e) => {
                      const v = volumes.find((x) => String(x.volume) === e.target.value);
                      if (v) pickVolume(v);
                    }}
                    className="rounded-md border border-border bg-card px-2 py-1 font-mono text-[11px] text-foreground outline-none focus-visible:border-accent"
                  >
                    {!selectedVolume && <option value="">volume {volumeNum} (not in index)</option>}
                    {volumes.map((v) => (
                      <option key={v.volume} value={String(v.volume)}>
                        Vol {v.volume} — {v.period ?? "?"} ({v.issues.length} issues)
                      </option>
                    ))}
                  </select>
                )}
                <Button variant="ghost" size="sm" onClick={loadVolumes} disabled={loadingVolumes || crawlingList}>
                  {loadingVolumes ? <Loader2 size={13} className="animate-spin" /> : <RefreshCcw size={13} />}
                  {volumes ? "Refresh volumes" : "Load volumes & years"}
                </Button>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  onClick={crawlIssues}
                  disabled={busy || issuesToCrawl.length === 0 || issuesToCrawl.length > MAX_ISSUES_PER_RUN}
                  size="sm"
                >
                  {crawlingList ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                  Crawl {issuesToCrawl.length} issue{issuesToCrawl.length === 1 ? "" : "s"}
                </Button>
                <NumberField label="volume" value={volumeNum} onChange={setVolumeNum} disabled={crawlingList} />
                <NumberField label="issues" value={issueFrom} onChange={setIssueFrom} disabled={crawlingList} />
                <NumberField label="to" value={issueTo} onChange={setIssueTo} disabled={crawlingList} />
                <HeadlessToggle checked={listHeadless} onChange={setListHeadless} disabled={crawlingList} />
              </div>

              <p className="font-mono text-[10.5px] text-muted-foreground mt-2.5">
                {issuesToCrawl.length > MAX_ISSUES_PER_RUN
                  ? `At most ${MAX_ISSUES_PER_RUN} issues per run — narrow the range.`
                  : issuesToCrawl.length === 0
                    ? `Volume ${volumeNum} has no issues numbered ${issueLo}–${issueHi}.`
                    : [
                        selectedVolume ? `Volume ${volumeNum} · ${selectedVolume.period ?? ""}` : `Volume ${volumeNum}`,
                        describeIssue(issuesToCrawl[0]) +
                          (issuesToCrawl.length > 1 ? ` → ${describeIssue(issuesToCrawl[issuesToCrawl.length - 1])}` : ""),
                      ].join(" · ")}
              </p>
              {volumesError && <p className="font-mono text-[10.5px] text-destructive mt-1">{volumesError}</p>}
            </>
          )}
        </div>

        <PipelineSteps
          journalDbId={journalDbId}
          dois={useLastRunScope && lastRun ? lastRun.dois : null}
          stats={stageStats}
          scope={scopePicker}
          scopeTitle="Run steps 2–4 on"
          disabled={crawlingList}
          onBusyChange={setStepsBusy}
          onLog={appendLog}
          onLogReset={() => setLog([])}
          onBatchDone={refreshAll}
        />

        <VlmStep
          journalDbId={journalDbId}
          dois={useLastRunScope && lastRun ? lastRun.dois : null}
          scopeLabel={useLastRunScope && lastRun ? lastRun.label : "whole journal"}
          counts={useLastRunScope ? (scopeStats?.vlm ?? null) : journal.vlm}
          onJob={onVlmJob}
          onFinished={refreshAll}
        />

        <RunLog lines={log} />

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
                  {a.pdfStatus === "downloaded" && <Badge variant="accent">pdf</Badge>}
                  {a.pdfStatus === "not_found" && <Badge>no pdf</Badge>}
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
              No articles crawled yet — run &quot;Crawl next batch&quot; above.
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

function describeIssue(i: SpringerVolume["issues"][number]) {
  return `issue ${i.issue}${i.month ? ` (${i.month})` : ""}`;
}