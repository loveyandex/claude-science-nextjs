"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

type Results = {
  articles: { id: string; title: string; doi: string; abstract: string | null; publishedDate: string | null }[];
  pagination: { total: number; totalPages: number };
};

export default function SpringerIndexedPage() {
  const { id } = useParams<{ id: string }>();
  const { authFetch } = useAuth();
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [results, setResults] = useState<Results | null>(null);
  const [error, setError] = useState<string | null>(null);
  const journalPath = `/springer/${id}`;

  useEffect(() => {
    const request = new AbortController();
    setResults(null);
    setError(null);
    const params = new URLSearchParams({ journalId: id, status: "indexed", q: query, page: String(page), limit: "20" });
    authFetch(`/api/springer/articles?${params}`, { cache: "no-store", signal: request.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error("Could not load indexed articles.");
        const data: Results = await res.json();
        if (!request.signal.aborted) setResults(data);
      })
      .catch(() => {
        if (!request.signal.aborted) setError("Could not load indexed articles.");
      });
    return () => request.abort();
  }, [authFetch, id, query, page]);

  return (
    <div className="h-full min-h-0 overflow-y-auto scrollbar-thin">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8">
        <Link href={journalPath} className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-accent">
          <ChevronLeft size={14} /> Back to journal
        </Link>
        <h1 className="mb-4 font-display text-xl font-semibold">Indexed articles</h1>
        <form className="mb-4 flex gap-2" onSubmit={(event) => {
          event.preventDefault();
          setQuery(draft.trim());
          setPage(1);
        }}>
          <Input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Search titles and abstracts" aria-label="Search titles and abstracts" maxLength={250} />
          <Button type="submit"><Search size={15} /> Search</Button>
        </form>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : !results ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <>
            <p className="mb-3 text-xs text-muted-foreground">{results.pagination.total.toLocaleString()} indexed articles</p>
            {results.articles.length === 0 && <p className="text-sm text-muted-foreground">No indexed articles match this search.</p>}
            <ul className="space-y-2">
              {results.articles.map((article) => (
                <li key={article.id}>
                  <Link href={`${journalPath}/${article.id}`} className="block rounded-lg border border-border bg-card p-3 hover:border-accent">
                    <h2 className="text-sm font-semibold">{article.title}</h2>
                    <p className="mt-1 break-words font-mono text-xs text-muted-foreground">
                      {article.doi}{article.publishedDate && ` · ${article.publishedDate}`}
                    </p>
                    {article.abstract && <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{article.abstract}</p>}
                  </Link>
                </li>
              ))}
            </ul>
            {results.pagination.totalPages > 1 && (
              <nav aria-label="Article pages" className="mt-4 flex items-center justify-between gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={14} /> Previous</Button>
                <span className="text-xs text-muted-foreground">Page {page} of {results.pagination.totalPages}</span>
                <Button variant="outline" size="sm" disabled={page >= results.pagination.totalPages} onClick={() => setPage(page + 1)}>Next <ChevronRight size={14} /></Button>
              </nav>
            )}
          </>
        )}
      </div>
    </div>
  );
}
