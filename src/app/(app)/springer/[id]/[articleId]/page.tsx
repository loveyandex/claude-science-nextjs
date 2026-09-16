"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronLeft, ExternalLink } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

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
  journal: { id: string; journalId: string; name: string };
};

export default function SpringerArticleDetailPage() {
  const params = useParams<{ id: string; articleId: string }>();
  const { authFetch } = useAuth();
  const [article, setArticle] = useState<ArticleDetail | null>(null);

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
