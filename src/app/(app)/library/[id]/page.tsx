import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, FileText, ArrowUpRight, BookMarked } from "lucide-react";
import { PAPERS } from "@/lib/data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function generateStaticParams() {
  return PAPERS.map((p) => ({ id: String(p.id) }));
}

export default function PaperDetailPage({ params }: { params: { id: string } }) {
  const paper = PAPERS.find((p) => p.id === Number(params.id));
  if (!paper) return notFound();

  return (
    <div className="h-full min-h-0 overflow-y-auto scrollbar-thin">
      <div className="max-w-2xl mx-auto w-full px-4 md:px-8 py-6">
        <Link
          href="/library"
          className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-accent transition-colors mb-5"
        >
          <ChevronLeft size={13} /> back to library
        </Link>

        <div className="flex items-center gap-2 mb-3">
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <BookMarked size={11} /> source paper
          </span>
        </div>

        <div className="flex items-center gap-2 mb-3">
          <span className="font-mono text-[10px] text-accent-foreground bg-accent rounded px-1.5 py-0.5">
            #{paper.id}
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">{paper.doi}</span>
        </div>

        <h1 className="font-display font-semibold text-[22px] md:text-[26px] leading-snug text-foreground">
          {paper.title}
        </h1>
        <p className="font-body text-[14px] text-muted-foreground mt-2">{paper.authors}</p>
        <div className="flex items-center gap-2 mt-2 font-mono text-[11px] text-muted-foreground flex-wrap">
          <span>{paper.journal}</span>
          <span className="text-border">·</span>
          <span>{paper.year}</span>
          <span className="text-border">·</span>
          <span>{paper.citations} citations</span>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-3">
          {paper.tags.map((t) => (
            <Badge key={t}>{t}</Badge>
          ))}
        </div>

        <div className="mt-6 pt-5 border-t border-border">
          <p className="font-mono text-[10px] uppercase tracking-wide text-accent mb-2">
            Abstract
          </p>
          <p className="font-body text-[14px] leading-relaxed text-foreground">
            {paper.abstract}
          </p>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <Button>
            <FileText size={13} /> Open full PDF
          </Button>
          <Button variant="outline">
            <ArrowUpRight size={13} /> View on publisher site
          </Button>
        </div>
      </div>
    </div>
  );
}
