"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  BookOpenText,
} from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ArticlePage = { pageNumber: number; content: string };

export default function ArticleMarkdownPage() {
  const { id } = useParams<{ id: string }>();
  const { authFetch } = useAuth();
  const [title, setTitle] = useState<string | null>(null);
  const [pages, setPages] = useState<ArticlePage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    setPages(null);
    setError(null);
    authFetch(`/api/articles/${id}/pages`)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(res.status === 404 ? "Article not found." : "Failed to load pages.");
        }
        const data = await res.json();
        setTitle(data.article?.title ?? null);
        setPages(data.pages ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load pages."));
  }, [authFetch, id]);

  useEffect(() => {
    setPageIndex(0);
  }, [id]);

  const current = pages?.[pageIndex];

  const remarkPlugins = useMemo(() => [remarkGfm, remarkMath], []);
  const rehypePlugins = useMemo(() => [rehypeKatex], []);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
      if (e.key === "ArrowRight") setPageIndex((i) => (pages ? Math.min(i + 1, pages.length - 1) : i));
      if (e.key === "ArrowLeft") setPageIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen, pages]);

  return (
    <div
      className={cn(
        "flex flex-col min-h-0",
        fullscreen ? "fixed inset-0 z-50 bg-background" : "h-full"
      )}
    >
      <div className="px-4 md:px-8 py-3 border-b border-border bg-card shrink-0 flex items-center gap-3">
        <Link
          href={`/library/${id}`}
          className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-accent transition-colors shrink-0"
        >
          <ChevronLeft size={13} /> back to article
        </Link>

        <div className="min-w-0 flex-1 flex items-center gap-1.5">
          <BookOpenText size={13} className="text-accent shrink-0" />
          <h1 className="font-display font-semibold text-[13px] truncate text-foreground">
            {title ?? "Loading…"}
          </h1>
        </div>

        {pages && pages.length > 0 && (
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              disabled={pageIndex <= 0}
              onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
            >
              <ChevronLeft size={14} />
            </Button>
            <span className="font-mono text-[11px] text-muted-foreground whitespace-nowrap">
              page {current?.pageNumber ?? "?"} · {pageIndex + 1} / {pages.length}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={pageIndex >= pages.length - 1}
              onClick={() => setPageIndex((i) => Math.min(pages.length - 1, i + 1))}
            >
              <ChevronRight size={14} />
            </Button>
          </div>
        )}

        <Button
          variant="ghost"
          size="sm"
          onClick={() => setFullscreen((f) => !f)}
          aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        >
          {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin px-4 md:px-8 py-6">
        <div className="max-w-2xl mx-auto w-full">
          {pages === null && !error && (
            <div className="space-y-3">
              <Skeleton className="h-5 w-1/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-40 w-full" />
            </div>
          )}

          {error && (
            <p className="font-mono text-[12px] text-muted-foreground py-10 text-center">
              {error}
            </p>
          )}

          {pages !== null && pages.length === 0 && !error && (
            <p className="font-mono text-[12px] text-muted-foreground py-10 text-center">
              No page transcriptions available for this article yet.
            </p>
          )}

          {current && (
            <div className="chat-markdown chat-markdown-wrap text-[14px] leading-relaxed text-foreground animate-fade-in">
              <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>
                {current.content}
              </ReactMarkdown>
            </div>
          )}

          {pages && pages.length > 0 && (
            <div className="flex items-center justify-center gap-3 pt-8">
              <Button
                variant="ghost"
                size="sm"
                disabled={pageIndex <= 0}
                onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
              >
                <ChevronLeft size={14} /> prev page
              </Button>
              <span className="font-mono text-[11px] text-muted-foreground">
                {pageIndex + 1} / {pages.length}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={pageIndex >= pages.length - 1}
                onClick={() => setPageIndex((i) => Math.min(pages.length - 1, i + 1))}
              >
                next page <ChevronRight size={14} />
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
