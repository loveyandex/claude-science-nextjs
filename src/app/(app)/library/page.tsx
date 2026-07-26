"use client";

import { useCallback, useEffect, useState } from "react";
import { Search, SlidersHorizontal, ChevronLeft, ChevronRight } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { ArticleCard, type IndexedArticle } from "@/components/science-ui";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

type Pagination = { page: number; limit: number; total: number; totalPages: number };

const LIMIT = 20;

export default function LibraryPage() {
  const { authFetch } = useAuth();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [articles, setArticles] = useState<IndexedArticle[] | null>(null);
  const [pagination, setPagination] = useState<Pagination | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQuery(query.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (debouncedQuery) params.set("q", debouncedQuery);
    authFetch(`/api/articles?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        setArticles(data.articles ?? []);
        setPagination(data.pagination ?? null);
      })
      .catch(() => {
        setArticles([]);
        setPagination(null);
      });
  }, [authFetch, page, debouncedQuery]);

  useEffect(() => {
    setArticles(null); // show skeleton while (re)loading
    load();
  }, [load]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 md:px-8 py-4 border-b border-border bg-card shrink-0 space-y-2.5">
        <div className="max-w-3xl mx-auto w-full space-y-2.5">
          <div className="flex items-center gap-2 bg-sidebar border border-border rounded-lg px-3 py-2 focus-within:border-accent transition-colors">
            <Search size={14} className="text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search indexed papers by title or abstract..."
              className="flex-1 bg-transparent outline-none text-[13px] font-body placeholder:text-muted-foreground"
            />
            <SlidersHorizontal size={13} className="text-muted-foreground" />
          </div>
          <p className="font-mono text-[10px] text-muted-foreground">
            {pagination ? `${pagination.total} results · sorted by newest indexed` : " "}
          </p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin px-4 md:px-8 py-5">
        <div className="max-w-3xl mx-auto w-full space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {articles === null &&
              Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-[126px] w-full rounded-lg" />
              ))}

            {articles?.map((a) => (
              <ArticleCard key={a.id} article={a} />
            ))}
          </div>

          {articles !== null && articles.length === 0 && (
            <div className="col-span-full text-center py-10">
              <p className="font-mono text-[11px] text-muted-foreground">
                {debouncedQuery
                  ? "No matches. Try a broader term."
                  : "No papers indexed yet — run make/science to index some."}
              </p>
            </div>
          )}

          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft size={14} /> prev
              </Button>
              <span className="font-mono text-[11px] text-muted-foreground">
                page {pagination.page} / {pagination.totalPages}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={page >= pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                next <ChevronRight size={14} />
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
