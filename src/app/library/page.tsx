"use client";

import { useState } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { PAPERS } from "@/lib/data";
import { PaperCard } from "@/components/science-ui";

export default function LibraryPage() {
  const [query, setQuery] = useState("");

  const filtered = PAPERS.filter((p) => {
    const q = query.toLowerCase();
    if (!q) return true;
    return (
      p.title.toLowerCase().includes(q) ||
      p.authors.toLowerCase().includes(q) ||
      p.tags.some((t) => t.toLowerCase().includes(q))
    );
  }).sort((a, b) => b.relevance - a.relevance);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 md:px-8 py-4 border-b border-border bg-card shrink-0 space-y-2.5">
        <div className="max-w-3xl mx-auto w-full space-y-2.5">
          <div className="flex items-center gap-2 bg-sidebar border border-border rounded-lg px-3 py-2 focus-within:border-accent transition-colors">
            <Search size={14} className="text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search 20M papers by title, author, topic..."
              className="flex-1 bg-transparent outline-none text-[13px] font-body placeholder:text-muted-foreground"
            />
            <SlidersHorizontal size={13} className="text-muted-foreground" />
          </div>
          <p className="font-mono text-[10px] text-muted-foreground">
            {filtered.length} results · sorted by relevance
          </p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin px-4 md:px-8 py-5">
        <div className="max-w-3xl mx-auto w-full grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filtered.map((p) => (
            <PaperCard key={p.id} paper={p} />
          ))}
          {filtered.length === 0 && (
            <div className="col-span-full text-center py-10">
              <p className="font-mono text-[11px] text-muted-foreground">
                No matches. Try a broader term.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
