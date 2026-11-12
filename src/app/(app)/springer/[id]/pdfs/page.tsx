"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronLeft, ChevronRight, FileDown, Loader2, Play, RefreshCcw } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/springer/pipeline-steps";
import { VlmStep, type VlmStepHandle } from "@/components/springer/vlm-step";
import { formatBytes } from "@/lib/utils";
import type { VlmCounts, VlmInfo, VlmJob, VlmState } from "@/lib/springer-vlm";

type PdfRow = {
  id: string;
  doi: string;
  title: string;
  publishedDate: string | null;
  pdfSize: number | null;
  vlm: VlmInfo;
};

type Pagination = { page: number; limit: number; total: number; totalPages: number };
type Filter = VlmState | "all";

const LIMIT = 20;

const STATE_LABEL: Record<VlmState, string> = {
  done: "read",
  partial: "partial",
  failed: "failed",
  todo: "not read",
};

// A journal's downloaded PDFs and whether the vision model has read them
// (stage 4) — including PDFs read before stage 4 existed, through the
// single-article "Make science" panel, since both write the same rows.
export default function SpringerPdfsPage() {
  const params = useParams<{ id: string }>();
  const journalDbId = params.id;
  const { authFetch } = useAuth();

  const [journalName, setJournalName] = useState<string | null>(null);
  const [counts, setCounts] = useState<VlmCounts | null>(null);
  const [rows, setRows] = useState<PdfRow[] | null>(null);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const [job, setJob] = useState<VlmJob | null>(null);
  const step = useRef<VlmStepHandle>(null);
  const filterRef = useRef(filter);
  const pageRef = useRef(page);
  filterRef.current = filter;
  pageRef.current = page;

  const loadRows = () => {
    const sp = new URLSearchParams({ page: String(pageRef.current), limit: String(LIMIT) });
    if (filterRef.current !== "all") sp.set("state", filterRef.current);
    authFetch(`/api/springer/journals/${journalDbId}/pdfs?${sp.toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        setRows(data.articles ?? []);
        setCounts(data.counts ?? null);
        setPagination(data.pagination ?? null);
      })
      .catch(() => setRows([]));
  };

  useEffect(() => {
    authFetch(`/api/springer/journals/${journalDbId}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => setJournalName(data.journal?.name ?? null))
      .catch(() => {});
  }, [authFetch, journalDbId]);

  useEffect(() => {
    setRows(null);
    loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authFetch, journalDbId, filter, page]);

  // Reload the list each time the job finishes an article.
  const jobProgress = useRef<string | null>(null);
  const onJob = (next: VlmJob | null) => {
    setJob(next);
    const key = next ? `${next.id}:${next.processed}` : null;
    if (jobProgress.current !== null && key !== jobProgress.current) loadRows();
    jobProgress.current = key;
  };

  const jobActive = job?.status === "running" || job?.status === "stopping";
  const currentDoi = jobActive && job?.journalDbId === journalDbId ? job.current?.doi : null;

  const tabs: [Filter, string][] = [
    ["all", `all · ${counts?.downloaded ?? "…"}`],
    ["todo", `not read · ${counts?.todo ?? "…"}`],
    ["partial", `partial · ${counts?.partial ?? "…"}`],
    ["failed", `failed · ${counts?.failed ?? "…"}`],
    ["done", `read · ${counts?.done ?? "…"}`],
  ];

  return (
    <div className="h-full min-h-0 overflow-y-auto scrollbar-thin">
      <div className="max-w-3xl mx-auto w-full px-4 md:px-8 py-6">
        <Link
          href={`/springer/${journalDbId}`}
          className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-accent mb-3"
        >
          <ChevronLeft size={12} /> {journalName ?? "journal"}
        </Link>

        <div className="flex items-center gap-2 mb-1">
          <FileDown size={16} className="text-accent" />
          <h1 className="font-display font-semibold text-[18px]">Downloaded PDFs</h1>
        </div>
        <p className="font-mono text-[11px] text-muted-foreground mb-6">
          every PDF from step 3, and whether a vision model has read all of its pages
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
          <StatCard label="pdfs" value={counts?.downloaded ?? "…"} />
          <StatCard label="fully read" value={counts?.done ?? "…"} accent />
          <StatCard label="partial" value={counts?.partial ?? "…"} />
          <StatCard label="failed" value={counts?.failed ?? "…"} />
          <StatCard label="not read" value={counts?.todo ?? "…"} />
        </div>

        <VlmStep
          ref={step}
          journalDbId={journalDbId}
          dois={null}
          scopeLabel="all downloaded PDFs"
          counts={counts}
          onJob={onJob}
          onFinished={loadRows}
        />

        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <div className="inline-flex items-center rounded-md border border-border p-0.5 font-mono text-[10.5px] flex-wrap">
            {tabs.map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setFilter(value);
                  setPage(1);
                }}
                className={`rounded px-2 py-0.5 transition-colors ${
                  filter === value ? "bg-sidebar text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={loadRows}>
            <RefreshCcw size={13} />
          </Button>
        </div>

        <div className="space-y-2">
          {rows === null &&
            Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[72px] w-full rounded-lg" />)}

          {rows?.map((r) => {
            const active = currentDoi === r.doi;
            const { state, pagesDone, pageCount } = r.vlm;
            return (
              <div
                key={r.id}
                className={`rounded-lg border bg-card p-3 transition-colors ${active ? "border-accent" : "border-border"}`}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className="font-mono text-[10px] text-muted-foreground truncate">{r.doi}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {active ? (
                      <Badge variant="accent">
                        <Loader2 size={10} className="animate-spin mr-1" />
                        reading · {job?.current?.pagesDone ?? 0}/{job?.current?.pageCount ?? "?"}
                      </Badge>
                    ) : (
                      <Badge variant={state === "done" ? "solid" : state === "partial" ? "accent" : "default"}>
                        {STATE_LABEL[state]}
                        {state !== "todo" && pageCount != null ? ` · ${pagesDone}/${pageCount}` : ""}
                        {state === "partial" && pageCount == null ? ` · ${pagesDone} pages` : ""}
                      </Badge>
                    )}
                  </div>
                </div>
                <Link
                  href={`/springer/${journalDbId}/${r.id}`}
                  className="font-display font-semibold text-[13px] leading-snug hover:text-accent transition-colors"
                >
                  {r.title}
                </Link>
                <div className="flex items-center gap-2 mt-1.5 font-mono text-[10px] text-muted-foreground flex-wrap">
                  {r.publishedDate && <span>{r.publishedDate}</span>}
                  {r.pdfSize != null && (
                    <>
                      <span className="text-border">·</span>
                      <span>{formatBytes(r.pdfSize)}</span>
                    </>
                  )}
                  {r.vlm.model && (
                    <>
                      <span className="text-border">·</span>
                      <span>{r.vlm.model}</span>
                    </>
                  )}
                  {state !== "done" && !active && (
                    <button
                      type="button"
                      disabled={jobActive}
                      onClick={() => step.current?.start([r.doi], r.title.slice(0, 80))}
                      className="ml-auto inline-flex items-center gap-1 text-accent hover:underline disabled:opacity-40 disabled:no-underline"
                    >
                      <Play size={10} /> {state === "partial" ? "resume" : "read"} this one
                    </button>
                  )}
                </div>
                {r.vlm.error && state !== "done" && (
                  <p className="font-mono text-[10px] text-destructive mt-1 line-clamp-2 break-words">{r.vlm.error}</p>
                )}
              </div>
            );
          })}

          {rows && rows.length === 0 && (
            <p className="font-mono text-[11px] text-muted-foreground text-center py-8">Nothing here.</p>
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
