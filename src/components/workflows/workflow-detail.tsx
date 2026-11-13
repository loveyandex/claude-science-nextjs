"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  CircleStop,
  Copy,
  Download,
  FileText,
  Lightbulb,
  Loader2,
  MessageSquare,
  Activity,
  Play,
  RotateCcw,
  Trash2,
  Check,
  PanelLeft,
} from "lucide-react";
import { useAuth } from "@/components/auth/auth-context";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ModelSelect } from "@/components/workflows/model-select";
import { BriefEditor } from "@/components/workflows/brief-editor";
import { RunPanel } from "@/components/workflows/run-panel";
import { ActivityTimeline, ACTIVITY_FILTERS } from "@/components/workflows/activity-timeline";
import { FindingsList } from "@/components/workflows/findings-list";
import { Markdown } from "@/components/workflows/markdown";
import { WorkflowChat } from "@/components/workflows/workflow-chat";
import { StatusBadge, isActive, timeAgo } from "@/components/workflows/status";
import type { Finding, RunRecord, WorkflowDetail as Workflow, WorkflowEvent } from "@/components/workflows/types";
import { cn } from "@/lib/utils";

type Tab = "activity" | "findings" | "report";
const ACTIVE_POLL_MS = 2500;
const IDLE_POLL_MS = 15000;

export function WorkflowDetail({ id }: { id: string }) {
  const router = useRouter();
  const { authFetch } = useAuth();
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [events, setEvents] = useState<WorkflowEvent[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | "all" | null>(null);
  const [tab, setTab] = useState<Tab>("activity");
  const [filter, setFilter] = useState<(typeof ACTIVITY_FILTERS)[number]["id"]>("all");
  const [busy, setBusy] = useState<"start" | "cancel" | "delete" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<"workflow" | "chat">("workflow");
  const [now, setNow] = useState(Date.now());
  const lastEventAt = useRef<string | null>(null);
  const findingCountRef = useRef(0);

  const loadWorkflow = useCallback(async () => {
    const res = await authFetch(`/api/workflows/${id}`);
    if (res.status === 404) {
      setNotFound(true);
      return null;
    }
    if (!res.ok) return null;
    const data = await res.json();
    setWorkflow(data.workflow);
    setRuns(data.runs);
    return data as { workflow: Workflow; runs: RunRecord[] };
  }, [authFetch, id]);

  const loadFindings = useCallback(async () => {
    const res = await authFetch(`/api/workflows/${id}/findings`);
    if (res.ok) setFindings((await res.json()).findings);
  }, [authFetch, id]);

  const loadEvents = useCallback(async () => {
    const after = lastEventAt.current;
    const res = await authFetch(`/api/workflows/${id}/events${after ? `?after=${encodeURIComponent(after)}` : ""}`);
    if (!res.ok) return;
    const incoming: WorkflowEvent[] = (await res.json()).events;
    if (incoming.length === 0) return;
    lastEventAt.current = incoming[incoming.length - 1].createdAt;
    setEvents((prev) => {
      const seen = new Set(prev.map((e) => e.id));
      const fresh = incoming.filter((e) => !seen.has(e.id));
      return fresh.length ? [...prev, ...fresh] : prev;
    });
  }, [authFetch, id]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadWorkflow(), loadEvents(), loadFindings()]);
  }, [loadWorkflow, loadEvents, loadFindings]);

  useEffect(() => {
    lastEventAt.current = null;
    setEvents([]);
    refreshAll();
  }, [refreshAll]);

  // Poll fast while a run is active, slowly otherwise (the chat can start one).
  const anyActive = runs.some((r) => isActive(r.status));
  useEffect(() => {
    const t = setInterval(() => {
      loadWorkflow();
      loadEvents();
    }, anyActive ? ACTIVE_POLL_MS : IDLE_POLL_MS);
    return () => clearInterval(t);
  }, [anyActive, loadWorkflow, loadEvents]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // New findings arrive as "finding" events — refetch the notebook then.
  const findingEvents = events.filter((e) => e.type === "finding").length;
  useEffect(() => {
    if (findingEvents !== findingCountRef.current) {
      findingCountRef.current = findingEvents;
      loadFindings();
    }
  }, [findingEvents, loadFindings]);

  const runNumbers = useMemo(() => new Map(runs.map((r) => [r.id, r.number])), [runs]);
  const selectedRun =
    selectedRunId === "all" ? null : runs.find((r) => r.id === selectedRunId) ?? runs[0] ?? null;
  const activeRun = runs.find((r) => isActive(r.status)) ?? null;

  const visibleEvents = useMemo(() => {
    const types = ACTIVITY_FILTERS.find((f) => f.id === filter)?.types as readonly string[] | null;
    return events.filter(
      (e) =>
        (selectedRunId === "all" || !selectedRun || e.runId === selectedRun.id || (e.runId === null && filter === "runs")) &&
        (!types || types.includes(e.type))
    );
  }, [events, filter, selectedRun, selectedRunId]);

  async function patch(data: Record<string, unknown>) {
    const res = await authFetch(`/api/workflows/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Couldn't save.");
    setWorkflow((w) => (w ? { ...w, ...body.workflow } : w));
    loadEvents();
  }

  async function runAction(kind: "start" | "cancel") {
    setBusy(kind);
    setActionError(null);
    try {
      const res = await authFetch(`/api/workflows/${id}/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Couldn't ${kind} the run.`);
      if (kind === "start") {
        setSelectedRunId(body.runId);
        setTab("activity");
      }
      await refreshAll();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function deleteWorkflow() {
    if (!confirm(`Delete "${workflow?.name}" with all its runs, findings and chat? This can't be undone.`)) return;
    setBusy("delete");
    const res = await authFetch(`/api/workflows/${id}`, { method: "DELETE" });
    if (res.ok) router.push("/workflows");
    else {
      setBusy(null);
      setActionError("Couldn't delete the workflow.");
    }
  }

  if (notFound) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="font-mono text-[12px] text-muted-foreground">This workflow doesn&apos;t exist (or isn&apos;t yours).</p>
        <Link href="/workflows" className="font-mono text-[12px] text-accent hover:underline">
          ← back to workflows
        </Link>
      </div>
    );
  }

  if (!workflow) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-3 px-6 py-8">
        <Skeleton className="h-7 w-1/2" />
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      {/* ---------- left: the workflow itself ---------- */}
      <div className={cn("min-w-0 flex-1 flex-col", mobilePane === "workflow" ? "flex" : "hidden lg:flex")}>
        <header className="shrink-0 border-b border-border/60 px-4 py-2.5 md:px-6">
          <div className="flex items-center gap-2">
            <Link
              href="/workflows"
              className="inline-flex shrink-0 items-center gap-0.5 font-mono text-[11px] text-muted-foreground hover:text-accent"
            >
              <ChevronLeft size={13} /> workflows
            </Link>
            <span className="text-border">/</span>
            <EditableName name={workflow.name} onSave={(name) => patch({ name })} />
            <StatusBadge status={workflow.status} />
            <div className="ms-auto flex items-center gap-1">
              <button
                onClick={() => setMobilePane("chat")}
                className="flex items-center gap-1 rounded-md px-2 py-1 font-mono text-[11px] text-muted-foreground hover:bg-foreground/5 lg:hidden"
              >
                <MessageSquare size={13} /> chat
              </button>
              <button
                onClick={deleteWorkflow}
                disabled={busy !== null}
                title="Delete workflow"
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                {busy === "delete" ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              </button>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <ModelSelect value={workflow.modelWireId} onChange={(wireId) => patch({ modelWireId: wireId })} />
            <MaxStepsInput value={workflow.maxSteps} onSave={(maxSteps) => patch({ maxSteps })} />
            <div className="ms-auto flex items-center gap-1.5">
              {activeRun ? (
                <Button size="sm" variant="outline" onClick={() => runAction("cancel")} disabled={busy !== null}>
                  {busy === "cancel" ? <Loader2 size={13} className="animate-spin" /> : <CircleStop size={13} />}
                  Cancel run #{activeRun.number}
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => runAction("start")}
                  disabled={busy !== null}
                  title={workflow.brief.trim() ? undefined : "Tip: write a brief first (or ask the assistant)"}
                >
                  {busy === "start" ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : runs.length > 0 ? (
                    <RotateCcw size={13} />
                  ) : (
                    <Play size={13} />
                  )}
                  {runs.length > 0 ? "Run again" : "Start research"}
                </Button>
              )}
            </div>
          </div>
          {actionError && <p className="mt-1.5 font-mono text-[11px] text-destructive">{actionError}</p>}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-5 md:px-6">
            <BriefEditor brief={workflow.brief} locked={Boolean(activeRun)} onSave={(brief) => patch({ brief })} />

            {runs.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="me-1 font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">runs</span>
                {runs.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setSelectedRunId(r.id)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[11px] transition-colors",
                      selectedRun?.id === r.id && selectedRunId !== "all"
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-border/70 text-muted-foreground hover:border-accent/50 hover:text-foreground"
                    )}
                  >
                    #{r.number}
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        isActive(r.status) && "animate-pulse bg-accent",
                        r.status === "completed" && "bg-success",
                        r.status === "failed" && "bg-destructive",
                        (r.status === "cancelled" || r.status === "partial") && "bg-warning"
                      )}
                    />
                  </button>
                ))}
                <button
                  onClick={() => setSelectedRunId("all")}
                  className={cn(
                    "rounded-md border px-2 py-0.5 font-mono text-[11px] transition-colors",
                    selectedRunId === "all"
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border/70 text-muted-foreground hover:text-foreground"
                  )}
                >
                  all
                </button>
                <span className="ms-auto font-mono text-[10.5px] text-muted-foreground">
                  last activity {timeAgo(workflow.lastActivityAt, now)}
                </span>
              </div>
            )}

            {selectedRun && <RunPanel run={selectedRun} now={now} />}

            <div>
              <div className="mb-3 flex items-center gap-1 border-b border-border/60">
                <TabButton active={tab === "activity"} onClick={() => setTab("activity")} icon={Activity}>
                  Activity
                </TabButton>
                <TabButton active={tab === "findings"} onClick={() => setTab("findings")} icon={Lightbulb}>
                  Findings <span className="font-mono text-[10.5px] text-muted-foreground">{findings.length}</span>
                </TabButton>
                <TabButton active={tab === "report"} onClick={() => setTab("report")} icon={FileText}>
                  Report
                </TabButton>
              </div>

              {tab === "activity" && (
                <>
                  <div className="mb-3 flex flex-wrap gap-1">
                    {ACTIVITY_FILTERS.map((f) => (
                      <button
                        key={f.id}
                        onClick={() => setFilter(f.id)}
                        className={cn(
                          "rounded-full px-2.5 py-0.5 font-mono text-[10.5px] transition-colors",
                          filter === f.id ? "bg-foreground text-background" : "bg-foreground/[0.05] text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                  <ActivityTimeline
                    events={visibleEvents}
                    runNumbers={runNumbers}
                    live={Boolean(selectedRun && isActive(selectedRun.status)) || (selectedRunId === "all" && anyActive)}
                  />
                </>
              )}

              {tab === "findings" && (
                <FindingsList
                  findings={findings}
                  onDelete={async (findingId) => {
                    const res = await authFetch(`/api/workflows/${id}/findings?findingId=${findingId}`, { method: "DELETE" });
                    if (res.ok) setFindings((fs) => fs.filter((f) => f.id !== findingId));
                  }}
                />
              )}

              {tab === "report" && <ReportView run={selectedRun ?? runs.find((r) => r.report) ?? null} workflowName={workflow.name} />}
            </div>
          </div>
        </div>
      </div>

      {/* ---------- right: chat pane ---------- */}
      <aside
        className={cn(
          "min-h-0 w-full flex-col border-border/60 lg:w-[400px] lg:border-l xl:w-[440px]",
          mobilePane === "chat" ? "flex" : "hidden lg:flex"
        )}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-4 py-2.5">
          <button
            onClick={() => setMobilePane("workflow")}
            className="rounded-md p-1 text-muted-foreground hover:bg-foreground/5 lg:hidden"
            aria-label="Back to workflow"
          >
            <PanelLeft size={15} />
          </button>
          <MessageSquare size={14} className="text-accent" />
          <span className="font-display text-[13.5px] font-semibold">Assistant</span>
          <span className="ms-auto font-mono text-[10px] text-muted-foreground">same model as the runs</span>
        </div>
        <div className="min-h-0 flex-1">
          <WorkflowChat workflowId={id} initialMessages={workflow.chatMessages} onTurnEnd={refreshAll} />
        </div>
      </aside>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Activity;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-1.5 text-[13px] transition-colors",
        active ? "border-accent text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
      )}
    >
      <Icon size={13} />
      {children}
    </button>
  );
}

function EditableName({ name, onSave }: { name: string; onSave: (name: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);

  if (!editing) {
    return (
      <h1
        onClick={() => setEditing(true)}
        title="Click to rename"
        className="min-w-0 cursor-text truncate rounded px-1 font-display text-[15px] font-semibold hover:bg-foreground/5"
      >
        {name}
      </h1>
    );
  }
  const commit = async () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== name) await onSave(draft.trim()).catch(() => setDraft(name));
    else setDraft(name);
  };
  return (
    <input
      autoFocus
      value={draft}
      maxLength={120}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") {
          setDraft(name);
          setEditing(false);
        }
      }}
      className="min-w-0 flex-1 rounded border border-accent bg-background px-1 font-display text-[15px] font-semibold outline-none"
    />
  );
}

function MaxStepsInput({ value, onSave }: { value: number; onSave: (n: number) => Promise<void> }) {
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState(false);
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <label className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground" title="Max model steps per run (cost/time budget)">
      budget
      <input
        type="number"
        min={3}
        max={300}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={async () => {
          const n = Number(draft);
          if (n === value) return;
          try {
            await onSave(n);
            setError(false);
          } catch {
            setError(true);
            setDraft(String(value));
          }
        }}
        className={cn(
          "w-14 rounded-md border bg-background px-1.5 py-0.5 text-foreground outline-none focus:border-accent",
          error ? "border-destructive" : "border-border/70"
        )}
      />
      steps
    </label>
  );
}

function ReportView({ run, workflowName }: { run: RunRecord | null; workflowName: string }) {
  const [copied, setCopied] = useState(false);
  if (!run) {
    return <p className="py-10 text-center font-mono text-[11.5px] text-muted-foreground">No run yet.</p>;
  }
  if (!run.report) {
    return (
      <p className="py-10 text-center font-mono text-[11.5px] text-muted-foreground">
        {isActive(run.status)
          ? `Run #${run.number} is still working — its report appears here when it finishes.`
          : `Run #${run.number} ended without a report.`}
      </p>
    );
  }
  const download = () => {
    const blob = new Blob([run.report!], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${workflowName.replace(/[^\w-]+/g, "-").toLowerCase()}-run-${run.number}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <article className="rounded-xl border border-border/60 bg-background px-5 py-4">
      <div className="mb-3 flex items-center gap-2 border-b border-border/50 pb-2">
        <FileText size={14} className="text-accent" />
        <span className="font-display text-[14px] font-semibold">Report · run #{run.number}</span>
        <div className="ms-auto flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await navigator.clipboard.writeText(run.report!);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
          </Button>
          <Button variant="ghost" size="sm" onClick={download}>
            <Download size={13} /> .md
          </Button>
        </div>
      </div>
      <Markdown className="text-[14px]">{run.report}</Markdown>
    </article>
  );
}
