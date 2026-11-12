"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FlaskConical, Lightbulb, Plus, Search, Workflow, History } from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CreateWorkflowDialog } from "@/components/workflows/create-workflow-dialog";
import { StatusBadge, isActive, timeAgo } from "@/components/workflows/status";
import type { WorkflowSummary } from "@/components/workflows/types";
import { cn } from "@/lib/utils";

export default function WorkflowsPage() {
  const { authFetch } = useAuth();
  const [query, setQuery] = useState("");
  const [workflows, setWorkflows] = useState<WorkflowSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      authFetch(`/api/workflows?limit=50${query.trim() ? `&q=${encodeURIComponent(query.trim())}` : ""}`)
        .then(async (res) => {
          if (!res.ok) throw new Error("Couldn't load workflows.");
          const data = await res.json();
          if (!cancelled) {
            setWorkflows(data.workflows);
            setError(null);
          }
        })
        .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Couldn't load workflows."));
    const debounce = setTimeout(load, query ? 250 : 0);
    // Keep running workflows' status fresh without a reload.
    const poll = setInterval(load, 8000);
    return () => {
      cancelled = true;
      clearTimeout(debounce);
      clearInterval(poll);
    };
  }, [authFetch, query]);

  const running = workflows?.filter((w) => isActive(w.status)).length ?? 0;

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 md:px-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 font-display text-[22px] font-semibold tracking-tight">
              <Workflow size={20} className="text-accent" />
              Workflows
            </h1>
            <p className="mt-1 max-w-xl font-mono text-[11.5px] text-muted-foreground">
              Long-running research agents. Give one a brief, start it, and it reads your library in the
              background — plan, findings and report stay here for when you come back.
            </p>
          </div>
          <CreateWorkflowDialog
            trigger={
              <Button>
                <Plus size={15} /> New workflow
              </Button>
            }
          />
        </div>

        <div className="relative mb-4">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search workflows by name…"
            className="w-full rounded-lg border border-border/70 bg-sidebar py-2 pl-9 pr-3 text-[13.5px] outline-none transition-colors placeholder:text-muted-foreground focus:border-accent"
          />
        </div>

        {workflows && workflows.length > 0 && (
          <p className="mb-2 font-mono text-[11px] text-muted-foreground">
            {workflows.length} workflow{workflows.length === 1 ? "" : "s"}
            {running > 0 && <span className="text-accent"> · {running} running</span>}
          </p>
        )}

        {error && <p className="py-8 text-center font-mono text-[12px] text-destructive">{error}</p>}

        {!workflows && !error && (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[76px] w-full rounded-xl" />
            ))}
          </div>
        )}

        {workflows && workflows.length === 0 && (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border/70 px-6 py-14 text-center">
            <FlaskConical size={26} className="text-accent" />
            <div>
              <p className="font-display text-[15px] font-semibold">
                {query ? "No workflow matches that name" : "No workflows yet"}
              </p>
              <p className="mt-1 font-mono text-[11.5px] text-muted-foreground">
                {query
                  ? "Try another word, or create a new one."
                  : "Create one, tell it what to investigate, and let it work while you're away."}
              </p>
            </div>
          </div>
        )}

        {workflows && workflows.length > 0 && (
          <ul className="space-y-1.5">
            {workflows.map((w) => (
              <li key={w.id}>
                <Link
                  href={`/workflow/${w.id}`}
                  className={cn(
                    "group flex flex-col gap-1.5 rounded-xl border border-border/60 bg-background px-4 py-3 transition-colors hover:border-accent/50 hover:bg-sidebar",
                    isActive(w.status) && "border-accent/40"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-display text-[14.5px] font-semibold group-hover:text-accent">
                      {w.name}
                    </span>
                    <StatusBadge status={w.status} />
                  </div>
                  <p className="line-clamp-2 text-[12.5px] text-muted-foreground">
                    {w.brief || <span className="italic">No brief yet — open it and describe what to research.</span>}
                  </p>
                  <div className="flex flex-wrap items-center gap-3 font-mono text-[10.5px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <History size={11} /> {w.runCount} run{w.runCount === 1 ? "" : "s"}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Lightbulb size={11} /> {w.findingCount} finding{w.findingCount === 1 ? "" : "s"}
                    </span>
                    <span className="ms-auto">active {timeAgo(w.lastActivityAt)}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
