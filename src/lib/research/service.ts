import { getRun, start } from "workflow/api";
import { prisma } from "@/lib/prisma";
import { ensureEnvProvidersSeeded } from "@/lib/ai-providers-settings";
import type { ModelConfig } from "@/lib/research/model";
import { researchRunWorkflow } from "@/workflows/research-run";

// Server-side operations on research workflows, shared by the API routes
// and by the chat agent's tools (which run inside workflow steps).

export const ACTIVE_RUN_STATUSES = ["queued", "running"];

export async function addEvent(
  workflowId: string,
  runId: string | null,
  type: string,
  title: string,
  detail?: string | null,
  data?: unknown
) {
  const now = new Date();
  await prisma.$transaction([
    prisma.researchWorkflowEvent.create({
      data: {
        workflowId,
        runId,
        type,
        title: title.slice(0, 300),
        detail: detail ?? null,
        data: data === undefined ? undefined : (data as object),
        createdAt: now,
      },
    }),
    prisma.researchWorkflow.update({ where: { id: workflowId }, data: { lastActivityAt: now } }),
  ]);
}

/**
 * Resolves an AiProviderModel.wireId to plain provider config. Same
 * fallback as getModel(): a missing/disabled id falls back to the first
 * enabled model, so a workflow whose model was deleted still runs.
 */
export async function loadModelConfig(wireId: string | null | undefined): Promise<ModelConfig> {
  await ensureEnvProvidersSeeded();
  const where = { enabled: true, provider: { enabled: true } };
  const row =
    (wireId
      ? await prisma.aiProviderModel.findFirst({ where: { ...where, wireId }, include: { provider: true } })
      : null) ??
    (await prisma.aiProviderModel.findFirst({ where, include: { provider: true }, orderBy: { createdAt: "asc" } }));
  if (!row) throw new Error("No AI provider is configured — add one in Settings.");
  return {
    wireId: row.wireId,
    type: row.provider.type,
    providerLabel: row.provider.label,
    baseUrl: row.provider.baseUrl,
    apiKey: row.provider.apiKey,
    modelName: row.modelName,
    label: `${row.label || row.modelName} · ${row.provider.label}`,
  };
}

type StartResult = { ok: true; runId: string; number: number } | { ok: false; error: string };

export async function startResearchRun(workflowId: string, note?: string | null): Promise<StartResult> {
  const workflow = await prisma.researchWorkflow.findUnique({ where: { id: workflowId } });
  if (!workflow) return { ok: false, error: "Workflow not found." };

  let modelLabel: string;
  let modelWireId: string;
  try {
    const cfg = await loadModelConfig(workflow.modelWireId);
    modelLabel = cfg.label;
    modelWireId = cfg.wireId;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const created = await prisma.$transaction(async (tx) => {
    const active = await tx.researchRun.findFirst({
      where: { workflowId, status: { in: ACTIVE_RUN_STATUSES } },
      select: { number: true },
    });
    if (active) return { error: `Run #${active.number} is still running — cancel it first.` } as const;
    const last = await tx.researchRun.findFirst({
      where: { workflowId },
      orderBy: { number: "desc" },
      select: { number: true },
    });
    const run = await tx.researchRun.create({
      data: {
        workflowId,
        number: (last?.number ?? 0) + 1,
        status: "queued",
        brief: workflow.brief,
        modelWireId,
        modelLabel,
        maxSteps: workflow.maxSteps,
      },
    });
    await tx.researchWorkflow.update({
      where: { id: workflowId },
      data: { status: "running", currentRunId: run.id, lastActivityAt: new Date() },
    });
    return { run } as const;
  });
  if ("error" in created) return { ok: false, error: created.error as string };
  const { run } = created;

  try {
    const wfRun = await start(researchRunWorkflow, [
      {
        workflowId,
        userId: workflow.userId,
        runId: run.id,
        number: run.number,
        name: workflow.name,
        brief: workflow.brief,
        note: note?.trim() || null,
        maxSteps: workflow.maxSteps,
        modelWireId,
      },
    ]);
    await prisma.researchRun.update({ where: { id: run.id }, data: { wfRunId: wfRun.runId } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.researchRun.update({
      where: { id: run.id },
      data: { status: "failed", error: `Couldn't start: ${message}`, endedAt: new Date() },
    });
    await prisma.researchWorkflow.update({ where: { id: workflowId }, data: { status: "failed" } });
    await addEvent(workflowId, run.id, "run_failed", `Run #${run.number} couldn't start`, message);
    return { ok: false, error: `Couldn't start the run: ${message}` };
  }

  await addEvent(
    workflowId,
    run.id,
    "run_queued",
    `Run #${run.number} queued`,
    note?.trim() ? `Guidance: ${note.trim()}` : null,
    { model: modelLabel, maxSteps: workflow.maxSteps }
  );
  return { ok: true, runId: run.id, number: run.number };
}

type CancelResult = { ok: true; number: number } | { ok: false; error: string };

export async function cancelResearchRun(workflowId: string, reason?: string | null): Promise<CancelResult> {
  const run = await prisma.researchRun.findFirst({
    where: { workflowId, status: { in: ACTIVE_RUN_STATUSES } },
    orderBy: { number: "desc" },
  });
  if (!run) return { ok: false, error: "No research run is in progress." };

  // Mark it first: the run's own finish step won't overwrite a terminal
  // status, so whatever the runtime does next, the user sees "cancelled".
  await prisma.researchRun.update({
    where: { id: run.id },
    data: { status: "cancelled", endedAt: new Date(), error: reason?.trim() || null },
  });
  await prisma.researchWorkflow.updateMany({
    where: { id: workflowId, currentRunId: run.id },
    data: { status: "cancelled" },
  });

  let cancelError: string | null = null;
  if (run.wfRunId) {
    try {
      await getRun(run.wfRunId).cancel();
    } catch (err) {
      cancelError = err instanceof Error ? err.message : String(err);
    }
  }
  await addEvent(
    workflowId,
    run.id,
    "run_cancelled",
    `Run #${run.number} cancelled`,
    [reason?.trim(), cancelError ? `Runtime: ${cancelError}` : null].filter(Boolean).join("\n\n") || null
  );
  return { ok: true, number: run.number };
}

const clip = (s: string | null | undefined, n: number) => (s ? (s.length > n ? `${s.slice(0, n)}…` : s) : null);

/** Compact snapshot for the chat agent — its system prompt and getWorkflowState. */
export async function getWorkflowState(workflowId: string) {
  const workflow = await prisma.researchWorkflow.findUnique({
    where: { id: workflowId },
    include: {
      runs: { orderBy: { number: "desc" }, take: 5 },
      events: { orderBy: { createdAt: "desc" }, take: 12 },
      findings: { orderBy: { createdAt: "desc" }, take: 30, select: { title: true, confidence: true, createdAt: true } },
      _count: { select: { findings: true, runs: true } },
    },
  });
  if (!workflow) return null;
  let model: string | null = null;
  try {
    model = (await loadModelConfig(workflow.modelWireId)).label;
  } catch {
    model = null;
  }
  const latest = workflow.runs[0];
  return {
    name: workflow.name,
    status: workflow.status,
    model,
    maxStepsPerRun: workflow.maxSteps,
    brief: workflow.brief || "(empty — not written yet)",
    runCount: workflow._count.runs,
    latestRun: latest
      ? {
          number: latest.number,
          status: latest.status,
          startedAt: latest.startedAt?.toISOString() ?? null,
          endedAt: latest.endedAt?.toISOString() ?? null,
          steps: `${latest.stepCount}/${latest.maxSteps}`,
          toolCalls: latest.toolCallCount,
          tokens: { input: latest.inputTokens, output: latest.outputTokens },
          plan: latest.plan,
          error: latest.error,
          reportExcerpt: clip(latest.report, 1500),
        }
      : null,
    earlierRuns: workflow.runs.slice(1).map((r) => ({
      number: r.number,
      status: r.status,
      endedAt: r.endedAt?.toISOString() ?? null,
      steps: `${r.stepCount}/${r.maxSteps}`,
      error: r.error,
    })),
    findingCount: workflow._count.findings,
    findings: workflow.findings.map((f) => ({ title: f.title, confidence: f.confidence })),
    recentActivity: workflow.events.map((e) => ({
      at: e.createdAt.toISOString(),
      type: e.type,
      title: e.title,
    })),
  };
}
