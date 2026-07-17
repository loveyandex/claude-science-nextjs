"use client";

import Link from "next/link";
import { Quote } from "lucide-react";
import type { Paper } from "@/lib/data";
import { Badge } from "@/components/ui/badge";

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
