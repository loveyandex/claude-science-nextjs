"use client";

import { useEffect, useState } from "react";
import { Loader2, PenLine, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/workflows/markdown";

/** The workflow's standing instructions — editable here, or written by the chat assistant. */
export function BriefEditor({
  brief,
  onSave,
  locked,
}: {
  brief: string;
  onSave: (brief: string) => Promise<void>;
  locked?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(brief);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(brief);
  }, [brief, editing]);

  const long = brief.length > 420;

  return (
    <section className="rounded-xl border border-border/60 bg-background">
      <div className="flex items-center justify-between gap-2 border-b border-border/50 px-4 py-2">
        <h2 className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
          <ScrollText size={12} className="text-accent" /> brief
        </h2>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          >
            <PenLine size={11} /> edit
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-2 p-3">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.min(16, Math.max(5, draft.split("\n").length + 1))}
            placeholder="Goal, scope, questions to answer, what counts as done, preferred sources…"
            className="w-full resize-y rounded-lg border border-border/70 bg-sidebar px-3 py-2 text-[13.5px] leading-relaxed outline-none focus:border-accent"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10.5px] text-muted-foreground">
              {locked ? "applies to the next run — the current one keeps its brief" : "used by the next run"}
            </span>
            <div className="flex gap-1.5">
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={saving}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={saving || draft === brief}
                onClick={async () => {
                  setSaving(true);
                  try {
                    await onSave(draft);
                    setEditing(false);
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {saving && <Loader2 size={12} className="animate-spin" />} Save brief
              </Button>
            </div>
          </div>
        </div>
      ) : brief.trim() ? (
        <div className="px-4 py-3">
          <div className={long && !expanded ? "relative max-h-40 overflow-hidden" : undefined}>
            <Markdown>{brief}</Markdown>
            {long && !expanded && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-background to-transparent" />
            )}
          </div>
          {long && (
            <button
              onClick={() => setExpanded((e) => !e)}
              className="mt-1 font-mono text-[10.5px] text-accent hover:underline"
            >
              {expanded ? "show less" : "show all"}
            </button>
          )}
        </div>
      ) : (
        <div className="px-4 py-4 text-[13px] text-muted-foreground">
          No brief yet. Describe what you want researched in the chat on the right and the assistant will write it — or{" "}
          <button onClick={() => setEditing(true)} className="text-accent hover:underline">
            write it yourself
          </button>
          .
        </div>
      )}
    </section>
  );
}
