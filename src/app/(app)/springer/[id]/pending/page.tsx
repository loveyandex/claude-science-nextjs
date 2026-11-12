"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Hourglass, Loader2, RefreshCcw } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PipelineSteps, RunLog, StatCard, type StreamEvent } from "@/components/springer/pipeline-steps";
import { formatBytes } from "@/lib/utils";

type JournalDetail = {
  id: string;
  journalId: string;
  name: string;
  articleCount: number;
  indexed: number;
  pending: number;
  pdf: { downloaded: number; notFound: number; failed: number; untried: number };
};

type QueueRow = {
  id: string;
  doi: string;
  title: string;
  section: string | null;
  publishedDate: string | null;
  status: string;
  pdfStatus: string | null;
};

type Pagination = { page: number; limit: number; total: number; totalPages: number };
type Queue = "details" | "pdfs";
type Finished = { doi: string; title: string; ok: boolean; result: string };

const LIMIT = 20;
const MAX_FINISHED = 30;
const MAX_LOG_LINES = 500;

// Every article in the journal that still needs stage 2 or 3, in the same
// order those stages pick them up (oldest first), so while a run is going
// the top of the list is literally what's being processed next.
export default function SpringerPendingPage() {
  const params = useParams<{ id: string }>();
  const journalDbId = params.id;
  const { authFetch } = useAuth();

  const [journal, setJournal] = useState<JournalDetail | null>(null);
  const [queue, setQueue] = useState<Queue>("details");
  const [rows, setRows] = useState<QueueRow[] | null>(null);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [page, setPage] = useState(1);
  const [log, setLog] = useState<string[]>([]);
  const [current, setCurrent] = useState<{ stage: Queue; doi: string } | null>(null);
  const [finished, setFinished] = useState<Finished[]>([]);
  const titles = useRef(new Map<string, string>());
  // PipelineSteps holds on to the callbacks it was given when a run started,
  // so they read the tab/page the user is on now through these.
  const queueRef = useRef(queue);
  const pageRef = useRef(page);
  queueRef.current = queue;
  pageRef.current = page;

  const loadJournal = () => {
    authFetch(`/api/springer/journals/${journalDbId}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => setJournal(data.journal ?? null))
      .catch(() => setJournal(null));
  };

  const loadRows = (q: Queue = queueRef.current, p: number = pageRef.current) => {
    const sp = new URLSearchParams({ journalId: journalDbId, page: String(p), limit: String(LIMIT), order: "oldest" });
    if (q === "details") sp.set("status", "pending");
    else sp.set("pdf", "todo");
    authFetch(`/api/springer/articles?${sp.toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        const list: QueueRow[] = data.articles ?? [];
        for (const r of list) titles.current.set(r.doi, r.title);
        setRows(list);
        setPagination(data.pagination ?? null);
      })
      .catch(() => setRows([]));
  };

  useEffect(loadJournal, [authFetch, journalDbId]);
  useEffect(() => {
    setRows(null);
    loadRows(queue, page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authFetch, journalDbId, queue, page]);

  const switchQueue = (q: Queue) => {
    if (q === queueRef.current) return;
    queueRef.current = q;
    pageRef.current = 1;
    setQueue(q);
    setPage(1);
  };

  const pushFinished = (f: Finished) => setFinished((list) => [f, ...list].slice(0, MAX_FINISHED));
  const titleOf = (doi: string) => titles.current.get(doi) ?? doi;

  const onEvent = (stage: Queue, ev: StreamEvent) => {
    const doi = ev.doi as string | undefined;
    if (ev.type === "batch_start") switchQueue(stage);
    if (ev.type === "start" && doi) setCurrent({ stage, doi });
    if (!doi || ev.type === "start" || ev.type === "challenge") return;
    setCurrent(null);
    if (stage === "details") {
      if (ev.type === "success")
        pushFinished({
          doi,
          title: (ev.title as string) || titleOf(doi),
          ok: true,
          result: ev.openAccess ? (ev.hasContent ? "abstract + full text" : "abstract · open access") : "abstract",
        });
      if (ev.type === "error") pushFinished({ doi, title: titleOf(doi), ok: false, result: String(ev.message) });
    } else {
      if (ev.type === "downloaded")
        pushFinished({ doi, title: titleOf(doi), ok: true, result: `pdf · ${formatBytes(ev.size as number)}` });
      if (ev.type === "not_found") pushFinished({ doi, title: titleOf(doi), ok: false, result: "no pdf at provider" });
      if (ev.type === "error") pushFinished({ doi, title: titleOf(doi), ok: false, result: String(ev.message) });
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

  const pdfTodo = journal.pdf.untried + journal.pdf.failed;

  return (
    <div className="h-full min-h-0 overflow-y-auto scrollbar-thin">
      <div className="max-w-3xl mx-auto w-full px-4 md:px-8 py-6">
        <Link
          href={`/springer/${journalDbId}`}
          className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-accent mb-3"
        >
          <ChevronLeft size={12} /> {journal.name}
        </Link>

        <div className="flex items-center gap-2 mb-1">
          <Hourglass size={16} className="text-accent" />
          <h1 className="font-display font-semibold text-[18px]">Pending articles</h1>
        </div>
        <p className="font-mono text-[11px] text-muted-foreground mb-6">
          journal #{journal.journalId} · everything that still needs step 2 or 3, oldest first
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <StatCard label="crawled" value={journal.articleCount} />
          <StatCard label="need step 2" value={journal.pending} />
          <StatCard label="need step 3" value={pdfTodo} />
          <StatCard label="pdfs" value={journal.pdf.downloaded} accent />
        </div>

        <PipelineSteps
          journalDbId={journalDbId}
          dois={null}
          stats={{ pending: journal.pending, pdf: journal.pdf }}
          scope={
            <p className="font-mono text-[10.5px] text-muted-foreground">
              All remaining articles in the journal. The queue below updates as each batch finishes.
            </p>
          }
          onLog={(line) => setLog((l) => [...l, line].slice(-MAX_LOG_LINES))}
          onLogReset={() => setLog([])}
          onEvent={onEvent}
          onBatchDone={() => {
            loadJournal();
            loadRows();
          }}
        />

        <RunLog lines={log} />

        {finished.length > 0 && (
          <div className="mb-6">
            <h2 className="font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground mb-2">Just finished</h2>
            <div className="space-y-1">
              {finished.map((f, i) => (
                <div key={`${f.doi}-${i}`} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-sidebar">
                  <span className={`font-mono text-[11px] ${f.ok ? "text-success" : "text-destructive"}`}>
                    {f.ok ? "✓" : "✗"}
                  </span>
                  <span className="text-[12px] truncate flex-1">{f.title}</span>
                  <span className="font-mono text-[10px] text-muted-foreground shrink-0 max-w-[40%] truncate">
                    {f.result}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 mb-3">
          <div className="inline-flex items-center rounded-md border border-border p-0.5 font-mono text-[10.5px]">
            {(
              [
                ["details", `need step 2 · ${journal.pending}`],
                ["pdfs", `need step 3 · ${pdfTodo}`],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => switchQueue(value)}
                className={`rounded px-2 py-0.5 transition-colors ${
                  queue === value ? "bg-sidebar text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => loadRows()}>
            <RefreshCcw size={13} />
          </Button>
        </div>

        <div className="space-y-2">
          {rows === null &&
            Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[64px] w-full rounded-lg" />)}

          {rows?.map((r) => {
            const active = current?.doi === r.doi && current.stage === queue;
            return (
              <Link
                key={r.id}
                href={`/springer/${journalDbId}/${r.id}`}
                className={`block rounded-lg border bg-card p-3 transition-colors group ${
                  active ? "border-accent" : "border-border hover:border-accent"
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className="font-mono text-[10px] text-muted-foreground truncate">{r.doi}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {active && (
                      <Badge variant="accent">
                        <Loader2 size={10} className="animate-spin mr-1" />
                        {queue === "details" ? "fetching abstract" : "fetching pdf"}
                      </Badge>
                    )}
                    {r.pdfStatus === "failed" && <Badge>pdf failed before</Badge>}
                    <Badge variant={r.status === "indexed" ? "solid" : "default"}>{r.status}</Badge>
                  </div>
                </div>
                <h3 className="font-display font-semibold text-[13px] leading-snug group-hover:text-accent transition-colors">
                  {r.title}
                </h3>
                <div className="flex items-center gap-2 mt-1 font-mono text-[10px] text-muted-foreground flex-wrap">
                  {r.section && <span>{r.section}</span>}
                  {r.publishedDate && (
                    <>
                      <span className="text-border">·</span>
                      <span>{r.publishedDate}</span>
                    </>
                  )}
                </div>
              </Link>
            );
          })}

          {rows && rows.length === 0 && (
            <p className="font-mono text-[11px] text-muted-foreground text-center py-8">
              Nothing left in this queue.
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
