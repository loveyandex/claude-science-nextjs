"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronLeft, FileText, ScanEye, BookMarked, BookOpenText } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import type { IndexedArticle } from "@/components/science-ui";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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

export default function ArticleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { authFetch } = useAuth();
  const [article, setArticle] = useState<IndexedArticle | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    setArticle(null);
    setNotFound(false);
    authFetch(`/api/articles/${id}`)
      .then(async (res) => {
        if (!res.ok) {
          setNotFound(true);
          return;
        }
        const data = await res.json();
        setArticle(data.article);
      })
      .catch(() => setNotFound(true));
  }, [authFetch, id]);

  const viaGemma = article?.gemmaStatus === "indexed" || article?.gemmaStatus === "partial";

  return (
    <div className="h-full min-h-0 overflow-y-auto scrollbar-thin">
      <div className="max-w-2xl mx-auto w-full px-4 md:px-8 py-6">
        <Link
          href="/library"
          className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-accent transition-colors mb-5"
        >
          <ChevronLeft size={13} /> back to library
        </Link>

        {!article && !notFound && (
          <div className="space-y-3">
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}

        {notFound && (
          <p className="font-mono text-[12px] text-muted-foreground py-10 text-center">
            Article not found.
          </p>
        )}

        {article && (
          <>
            <div className="flex items-center gap-2 mb-3">
              <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <BookMarked size={11} /> source paper
              </span>
            </div>

            <div className="flex items-center gap-2 mb-3">
              <span className="font-mono text-[10px] text-accent-foreground bg-accent rounded px-1.5 py-0.5 inline-flex items-center gap-1">
                {viaGemma ? <ScanEye size={10} /> : <FileText size={10} />}
                {viaGemma ? "gemma4" : "text"}
              </span>
              <span className="font-mono text-[10px] text-muted-foreground truncate" title={article.url}>
                {article.url}
              </span>
            </div>

            <h1 className="font-display font-semibold text-[22px] md:text-[26px] leading-snug text-foreground">
              {article.title}
            </h1>
            <div className="flex items-center gap-2 mt-2 font-mono text-[11px] text-muted-foreground flex-wrap">
              <span>{article.pageCount ?? "?"} pages</span>
              <span className="text-border">·</span>
              <span>indexed {relativeTime(article.createdAt)}</span>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-3">
              <Badge>{article.status}</Badge>
              {article.gemmaStatus && <Badge>gemma4: {article.gemmaStatus}</Badge>}
            </div>

            <div className="mt-6 pt-5 border-t border-border">
              <p className="font-mono text-[10px] uppercase tracking-wide text-accent mb-2">
                Abstract
              </p>
              <p className="font-body text-[14px] leading-relaxed text-foreground">
                {article.abstract || "No abstract extracted for this article."}
              </p>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-2">
              <Button asChild>
                <a href={article.pdfUrl} target="_blank" rel="noreferrer">
                  <FileText size={13} /> Open full PDF
                </a>
              </Button>
              {viaGemma && (
                <Button variant="outline" asChild>
                  <Link href={`/library/${article.id}/markdown`}>
                    <BookOpenText size={13} /> Read as markdown
                  </Link>
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
