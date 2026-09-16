"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BookMarked, Plus, Loader2, ExternalLink, AlertTriangle } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

type Journal = {
  id: string;
  journalId: string;
  name: string;
  url: string;
  lastListPage: number;
  totalArticles: number | null;
  articleCount: number;
  createdAt: string;
};

export default function SpringerJournalsPage() {
  const { authFetch } = useAuth();
  const [journals, setJournals] = useState<Journal[] | null>(null);
  const [journalIdInput, setJournalIdInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    authFetch("/api/springer/journals", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => setJournals(data.journals ?? []))
      .catch(() => setJournals([]));
  };

  useEffect(load, [authFetch]);

  const addJournal = async () => {
    const journalId = journalIdInput.trim();
    if (!journalId) return;
    setAdding(true);
    setError(null);
    try {
      const res = await authFetch("/api/springer/journals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ journalId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add journal");
      setJournalIdInput("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add journal");
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto scrollbar-thin">
      <div className="max-w-3xl mx-auto w-full px-4 md:px-8 py-6">
        <div className="flex items-center gap-2 mb-1">
          <BookMarked size={16} className="text-accent" />
          <h1 className="font-display font-semibold text-[18px]">springer journals</h1>
        </div>
        <p className="font-mono text-[11px] text-muted-foreground mb-5">
          Register a Springer journal by its numeric id (the path segment in
          link.springer.com/journal/&lt;id&gt;) and crawl its article list + abstracts into a
          separate Springer articles table.
        </p>

        <div className="flex items-center gap-2 mb-2">
          <Input
            value={journalIdInput}
            onChange={(e) => setJournalIdInput(e.target.value)}
            placeholder="e.g. 10853"
            onKeyDown={(e) => e.key === "Enter" && addJournal()}
            disabled={adding}
            className="max-w-[200px]"
          />
          <Button onClick={addJournal} disabled={adding || !journalIdInput.trim()}>
            {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Add journal
          </Button>
        </div>
        <p className="font-mono text-[10px] text-muted-foreground mb-6">
          Example: <code>10853</code> is the{" "}
          <a
            href="https://link.springer.com/journal/10853"
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline"
          >
            Journal of Materials Science
          </a>
          .
        </p>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 mb-6 text-[13px]">
            <AlertTriangle size={15} className="text-destructive shrink-0 mt-0.5" />
            <p className="text-destructive">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {journals === null &&
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[104px] w-full rounded-lg" />)}

          {journals?.map((j) => (
            <Link
              key={j.id}
              href={`/springer/${j.id}`}
              className="bg-card border border-border rounded-lg p-3.5 hover:border-accent transition-colors group block"
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <span className="font-mono text-[10px] text-muted-foreground">#{j.journalId}</span>
                <a
                  href={j.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-muted-foreground hover:text-accent transition-colors"
                >
                  <ExternalLink size={12} />
                </a>
              </div>
              <h3 className="font-display font-semibold text-[14px] leading-snug group-hover:text-accent transition-colors">
                {j.name}
              </h3>
              <div className="flex items-center gap-2 mt-2 font-mono text-[11px] text-muted-foreground flex-wrap">
                <span>{j.articleCount} crawled</span>
                {j.totalArticles != null && (
                  <>
                    <span className="text-border">·</span>
                    <span>{j.totalArticles.toLocaleString()} total on Springer</span>
                  </>
                )}
              </div>
            </Link>
          ))}

          {journals && journals.length === 0 && (
            <p className="font-mono text-[11px] text-muted-foreground py-8 col-span-2 text-center">
              No journals registered yet — add one above.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
