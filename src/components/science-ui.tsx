"use client";

import Link from "next/link";
import { FileText, Quote, ScanEye } from "lucide-react";
import type { Paper } from "@/lib/data";
import { Badge } from "@/components/ui/badge";

export type IndexedArticle = {
  id: string;
  url: string;
  pdfUrl: string;
  title: string;
  abstract: string;
  pageCount: number | null;
  status: string;
  gemmaStatus: string | null;
  createdAt: string;
};

/** Last path segment of an article's source `url`, used as a stand-in for
 * an authors/journal line since the indexed metadata has no such fields. */
function sourceLabel(url: string): string {
  const decoded = decodeURIComponent(url.split("/").pop() || url);
  return decoded.replace(/\.pdf$/i, "");
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function ArticleCard({ article }: { article: IndexedArticle }) {
  const viaGemma = article.gemmaStatus === "indexed" || article.gemmaStatus === "partial";
  return (
    <Link
      href={`/library/${article.id}`}
      className="w-full text-left bg-card border border-border rounded-lg p-3.5 hover:border-accent transition-colors group block"
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <span
          className="font-mono text-[10px] text-muted-foreground truncate"
          title={article.url}
        >
          {sourceLabel(article.url)}
        </span>
        <span className="shrink-0 inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
          {viaGemma ? <ScanEye size={11} /> : <FileText size={11} />}
          {viaGemma ? "gemma4" : "text"}
        </span>
      </div>
      <h3 className="font-display font-semibold text-[14px] leading-snug text-foreground group-hover:text-accent transition-colors">
        {article.title}
      </h3>
      <p className="font-body text-[12px] text-muted-foreground mt-1.5 line-clamp-2">
        {article.abstract || "No abstract extracted."}
      </p>
      <div className="flex items-center gap-2 mt-2 font-mono text-[11px] text-muted-foreground flex-wrap">
        <span>{article.pageCount ?? "?"} pages</span>
        <span className="text-border">·</span>
        <span>indexed {relativeTime(article.createdAt)}</span>
      </div>
    </Link>
  );
}

export function RelevanceBars({ score }: { score: number }) {
  const filled = Math.round(score / 12.5);
  return (
    <div className="flex items-end gap-[2px] h-3.5" aria-hidden="true">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className={`w-[3px] rounded-sm transition-colors ${
            i < filled ? "bg-accent" : "bg-border"
          }`}
          style={{ height: `${4 + i * 1.4}px` }}
        />
      ))}
    </div>
  );
}

export function PaperCard({ paper, compact }: { paper: Paper; compact?: boolean }) {
  return (
    <Link
      href={`/library/${paper.id}`}
      className="w-full text-left bg-card border border-border rounded-lg p-3.5 hover:border-accent transition-colors group block"
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <span className="font-mono text-[10px] text-accent">#{paper.id}</span>
        <RelevanceBars score={paper.relevance} />
      </div>
      <h3 className="font-display font-semibold text-[14px] leading-snug text-foreground group-hover:text-accent transition-colors">
        {paper.title}
      </h3>
      <p className="font-body text-[12px] text-muted-foreground mt-1">{paper.authors}</p>
      <div className="flex items-center gap-2 mt-2 font-mono text-[11px] text-muted-foreground flex-wrap">
        <span>{paper.journal}</span>
        <span className="text-border">·</span>
        <span>{paper.year}</span>
        <span className="text-border">·</span>
        <span>{paper.citations} cites</span>
      </div>
      {!compact && (
        <div className="flex flex-wrap gap-1 mt-2.5">
          {paper.tags.map((t) => (
            <Badge key={t}>{t}</Badge>
          ))}
        </div>
      )}
    </Link>
  );
}

export function CitationChip({
  number,
  paper,
}: {
  number: number;
  paper?: Paper;
}) {
  if (!paper) return <span className="font-mono text-xs">[{number}]</span>;
  return (
    <Link
      href={`/library/${paper.id}`}
      className="inline-flex items-center justify-center align-super font-mono text-[10px] leading-none mx-0.5 w-4 h-4 rounded bg-accent/10 text-accent border border-accent/30 hover:bg-accent hover:text-accent-foreground transition-colors"
      title={paper.title}
    >
      {number}
    </Link>
  );
}

export function MessageContent({
  text,
  citations,
  papers,
}: {
  text: string;
  citations?: number[];
  papers: Paper[];
}) {
  const paperByNum: Record<number, Paper | undefined> = {};
  (citations || []).forEach((id) => {
    paperByNum[id] = papers.find((p) => p.id === id);
  });
  const parts = text.split(/\[(\d+)\]/g);
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 1) {
          const num = parseInt(part, 10);
          return <CitationChip key={i} number={num} paper={paperByNum[num]} />;
        }
        return part.split("\n\n").map((para, j, arr) => (
          <span key={`${i}-${j}`}>
            {para}
            {j < arr.length - 1 && (
              <>
                <br />
                <br />
              </>
            )}
          </span>
        ));
      })}
    </>
  );
}

export function CitationRow({ ids, papers }: { ids: number[]; papers: Paper[] }) {
  return (
    <div className="flex flex-wrap gap-1.5 mt-3 pt-2.5 border-t border-border/70">
      {ids.map((id) => {
        const p = papers.find((pp) => pp.id === id);
        if (!p) return null;
        return (
          <Link
            key={id}
            href={`/library/${p.id}`}
            className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground bg-sidebar border border-border rounded px-1.5 py-0.5 hover:border-accent hover:text-accent transition-colors"
          >
            <Quote size={9} /> {id}
          </Link>
        );
      })}
    </div>
  );
}
