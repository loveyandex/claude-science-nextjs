"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronLeft, Download, ExternalLink, FileText, Loader2 } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes } from "@/lib/utils";

type ArticleDetail = {
  id: string;
  doi: string;
  href: string;
  title: string;
  section: string | null;
  publishedDate: string | null;
  openAccess: boolean;
  abstract: string | null;
  content: string | null;
  status: string;
  errorReason: string | null;
  pdfStatus: string | null;
  pdfSize: number | null;
  pdfSourceUrl: string | null;
  pdfError: string | null;
  pdfCheckedAt: string | null;
  journal: { id: string; journalId: string; name: string };
};

export default function SpringerArticleDetailPage() {
  const params = useParams<{ id: string; articleId: string }>();
  const { authFetch } = useAuth();
  const [article, setArticle] = useState<ArticleDetail | null>(null);
  const [pdfBusy, setPdfBusy] = useState<"open" | "download" | null>(null);
  const [pdfActionError, setPdfActionError] = useState<string | null>(null);

  // The PDF route needs the Bearer token, which a plain <a href> can't
  // send — so fetch it as a blob and hand the browser an object URL.
  const loadPdf = async (mode: "open" | "download") => {
    if (!article) return;
    setPdfBusy(mode);
    setPdfActionError(null);
    // Opened synchronously inside the click so popup blockers allow it.
    const tab = mode === "open" ? window.open("", "_blank") : null;
    try {
      const res = await authFetch(`/api/springer/articles/${article.id}/pdf`, { cache: "no-store" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to load PDF (${res.status})`);
      }
      const url = URL.createObjectURL(await res.blob());
      if (tab) {
        tab.location.href = url;
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.download = `${article.doi.replace(/[^\w.-]+/g, "_")}.pdf`;
        a.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      tab?.close();
      setPdfActionError(err instanceof Error ? err.message : "Failed to load PDF");
    } finally {
      setPdfBusy(null);
    }
  };

  useEffect(() => {
    authFetch(`/api/springer/articles/${params.articleId}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => setArticle(data.article ?? null))
      .catch(() => setArticle(null));
  }, [authFetch, params.articleId]);

  if (!article) {
    return (
      <div className="h-full min-h-0 overflow-y-auto scrollbar-thin">
        <div className="max-w-2xl mx-auto w-full px-4 md:px-8 py-6 space-y-3">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto scrollbar-thin">
      <div className="max-w-2xl mx-auto w-full px-4 md:px-8 py-6">
        <Link
          href={`/springer/${params.id}`}
          className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-accent mb-4"
        >
          <ChevronLeft size={12} /> {article.journal.name}
        </Link>

        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
          {article.openAccess && <Badge variant="accent">open access</Badge>}
          <Badge variant={article.status === "indexed" ? "solid" : "default"}>{article.status}</Badge>
          {article.section && <Badge>{article.section}</Badge>}
        </div>

        <h1 className="font-display font-semibold text-[20px] leading-snug mb-2">{article.title}</h1>

        <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground mb-6 flex-wrap">
          <span>{article.doi}</span>
          {article.publishedDate && (
            <>
              <span className="text-border">·</span>
              <span>{article.publishedDate}</span>
            </>
          )}
          <a
            href={`https://link.springer.com${article.href}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-accent hover:underline"
          >
            <ExternalLink size={11} /> view on Springer
          </a>
        </div>

        <PdfPanel article={article} busy={pdfBusy} onLoad={loadPdf} actionError={pdfActionError} />

        {article.status === "failed" && article.errorReason && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 mb-6 text-[13px] text-destructive">
            Detail crawl failed: {article.errorReason}
          </div>
        )}

        {article.abstract ? (
          <div className="mb-6">
            <h2 className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
              Abstract
            </h2>
            <p className="text-[14px] leading-relaxed whitespace-pre-line">{article.abstract}</p>
          </div>
        ) : (
          article.status === "pending" && (
            <p className="font-mono text-[11px] text-muted-foreground mb-6">
              Abstract not crawled yet — run stage 2 on the journal page.
            </p>
          )
        )}

        {article.content && (
          <div>
            <h2 className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
              Full text (open access)
            </h2>
            <div className="text-[13.5px] leading-relaxed whitespace-pre-line">{article.content}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function PdfPanel({
  article,
  busy,
  onLoad,
  actionError,
}: {
  article: ArticleDetail;
  busy: "open" | "download" | null;
  onLoad: (mode: "open" | "download") => void;
  actionError: string | null;
}) {
  const statusText: Record<string, string> = {
    downloaded: "PDF downloaded",
    not_found: "Provider has no PDF for this DOI",
    failed: "PDF fetch failed — will be retried on the next stage 3 run",
  };

  return (
    <div className="rounded-lg border border-border bg-card p-3.5 mb-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <FileText size={14} className="text-accent shrink-0" />
          <div className="min-w-0">
            <p className="text-[13px] font-medium">
              {article.pdfStatus ? statusText[article.pdfStatus] ?? article.pdfStatus : "PDF not fetched yet"}
              {article.pdfStatus === "downloaded" && article.pdfSize ? ` · ${formatBytes(article.pdfSize)}` : ""}
            </p>
            {article.pdfSourceUrl && (
              <p className="font-mono text-[10px] text-muted-foreground truncate" title={article.pdfSourceUrl}>
                {article.pdfSourceUrl}
              </p>
            )}
            {!article.pdfStatus && (
              <p className="font-mono text-[10px] text-muted-foreground">Run stage 3 on the journal page.</p>
            )}
          </div>
        </div>
        {article.pdfStatus === "downloaded" && (
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" variant="outline" onClick={() => onLoad("open")} disabled={busy !== null}>
              {busy === "open" ? <Loader2 size={13} className="animate-spin" /> : <ExternalLink size={13} />}
              Open
            </Button>
            <Button size="sm" onClick={() => onLoad("download")} disabled={busy !== null}>
              {busy === "download" ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
              Download
            </Button>
          </div>
        )}
      </div>
      {article.pdfError && article.pdfStatus !== "downloaded" && (
        <p className="font-mono text-[10.5px] text-muted-foreground mt-2 break-words">{article.pdfError}</p>
      )}
      {actionError && <p className="text-[12px] text-destructive mt-2">{actionError}</p>}
    </div>
  );
}
