import type { ToolContext, ToolName } from "@/lib/research/tool-defs";

// Durable steps for the research workflows. Node-only code (Prisma, fs,
// fetch) is imported inside each step body, so the workflow bundle — which
// runs in a sandbox — never loads it.

const SELF_LOGGING_TOOLS = new Set<ToolName>(["updatePlan", "recordFinding", "writeNote"]);
const MAX_LOGGED_OUTPUT_CHARS = 6000;

function describeCall(name: string, input: Record<string, any>): string {
  const q = input.query ?? input.doi ?? input.url ?? input.title;
  const pages =
    input.fromPage != null ? ` p.${input.fromPage}${input.toPage && input.toPage !== input.fromPage ? `–${input.toPage}` : ""}` : input.page != null ? ` p.${input.page}` : "";
  return q ? `${name} · ${String(q).slice(0, 140)}${pages}` : name;
}

function summarizeOutput(output: unknown): string | null {
  if (!output || typeof output !== "object") return null;
  const o = output as Record<string, any>;
  if (o.error) return `error: ${String(o.error).slice(0, 200)}`;
  if (typeof o.count === "number") return `${o.count} result${o.count === 1 ? "" : "s"}${typeof o.total === "number" ? ` of ${o.total}` : ""}`;
  if (Array.isArray(o.pages)) return `${o.pages.length} page${o.pages.length === 1 ? "" : "s"} read`;
  if (typeof o.text === "string") return `${o.text.length.toLocaleString()} chars`;
  if (typeof o.content === "string") return `${o.content.length.toLocaleString()} chars`;
  return null;
}

export async function runToolStep(name: ToolName, input: Record<string, any>, ctx: ToolContext) {
  "use step";
  const { executeResearchTool } = await import("@/lib/research/tool-exec");
  const startedAt = Date.now();
  let output: unknown;
  let ok = true;
  try {
    output = await executeResearchTool(name, input, ctx);
    if (output && typeof output === "object" && "error" in output && (output as { error?: unknown }).error) ok = false;
  } catch (err) {
    // Handed back as a result rather than thrown, so the agent can adapt
    // (try another query/tool) instead of the whole step being retried.
    ok = false;
    output = { error: err instanceof Error ? err.message : String(err) };
  }

  if (ctx.actor === "run" && ctx.runId) {
    const { prisma } = await import("@/lib/prisma");
    const { addEvent } = await import("@/lib/research/service");
    await prisma.researchRun.update({ where: { id: ctx.runId }, data: { toolCallCount: { increment: 1 } } });
    if (!SELF_LOGGING_TOOLS.has(name)) {
      let serialized = JSON.stringify(output ?? null) ?? "null";
      if (serialized.length > MAX_LOGGED_OUTPUT_CHARS) serialized = `${serialized.slice(0, MAX_LOGGED_OUTPUT_CHARS)}…`;
      await addEvent(ctx.workflowId, ctx.runId, "tool", describeCall(name, input), summarizeOutput(output), {
        tool: name,
        input,
        output: serialized,
        ok,
        durationMs: Date.now() - startedAt,
      });
    }
  }
  return output;
}

export type RunInput = {
  workflowId: string;
  userId: string;
  runId: string;
  number: number;
  name: string;
  brief: string;
  note: string | null;
  maxSteps: number;
  modelWireId: string;
};

export async function beginRunStep(input: RunInput) {
  "use step";
  const { prisma } = await import("@/lib/prisma");
  const { addEvent, loadModelConfig } = await import("@/lib/research/service");

  const run = await prisma.researchRun.findUnique({ where: { id: input.runId } });
  if (!run || run.status === "cancelled") return { cancelled: true as const };

  const cfg = await loadModelConfig(input.modelWireId);
  if (run.status !== "running") {
    await prisma.researchRun.update({
      where: { id: input.runId },
      data: { status: "running", startedAt: run.startedAt ?? new Date() },
    });
    await prisma.researchWorkflow.updateMany({
      where: { id: input.workflowId, currentRunId: input.runId },
      data: { status: "running" },
    });
    await addEvent(input.workflowId, input.runId, "run_started", `Run #${input.number} started`, null, {
      model: cfg.label,
    });
  }

  const [priorFindings, priorRun] = await Promise.all([
    prisma.researchFinding.findMany({
      where: { workflowId: input.workflowId, NOT: { runId: input.runId } },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: { title: true, content: true },
    }),
    prisma.researchRun.findFirst({
      where: { workflowId: input.workflowId, number: { lt: input.number }, report: { not: null } },
      orderBy: { number: "desc" },
      select: { report: true },
    }),
  ]);
  return { cancelled: false as const, cfg, priorFindings, priorReport: priorRun?.report ?? null };
}

export async function recordModelStepStep(args: {
  workflowId: string;
  runId: string;
  stepIndex: number;
  text: string;
  reasoning: string;
  toolNames: string[];
  inputTokens: number;
  outputTokens: number;
}) {
  "use step";
  const { prisma } = await import("@/lib/prisma");
  const { addEvent } = await import("@/lib/research/service");
  await prisma.researchRun.update({
    where: { id: args.runId },
    data: {
      stepCount: args.stepIndex,
      inputTokens: { increment: args.inputTokens },
      outputTokens: { increment: args.outputTokens },
    },
  });
  // The step's final text is the report on the last step — finishRunStep
  // stores that; here only intermediate commentary/reasoning is logged.
  const commentary = [args.reasoning.trim(), args.toolNames.length > 0 ? args.text.trim() : ""].filter(Boolean).join("\n\n");
  if (commentary) {
    const firstLine = commentary.split("\n").find((l) => l.trim())?.replace(/^[#*\s]+/, "") ?? "Thinking";
    await addEvent(args.workflowId, args.runId, "thinking", firstLine.slice(0, 160), commentary.slice(0, 8000), {
      step: args.stepIndex,
      tools: args.toolNames,
    });
  }
}

export async function finishRunStep(args: {
  workflowId: string;
  runId: string;
  number: number;
  status: "completed" | "failed";
  report: string | null;
  error: string | null;
  steps: number;
}) {
  "use step";
  const { prisma } = await import("@/lib/prisma");
  const { addEvent } = await import("@/lib/research/service");

  // A run that stopped before writing its report (model error, empty last
  // answer) still leaves something readable: the findings it recorded.
  let report = args.report;
  if (!report) {
    const findings = await prisma.researchFinding.findMany({
      where: { runId: args.runId },
      orderBy: { createdAt: "asc" },
      select: { title: true, content: true },
    });
    if (findings.length > 0) {
      report =
        `_The agent stopped before writing a report${args.error ? ` (${args.error})` : ""}. ` +
        `These are the ${findings.length} finding(s) it recorded:_\n\n` +
        findings.map((f) => `### ${f.title}\n\n${f.content}`).join("\n\n");
    }
  }

  // "completed" means the plan was carried out, not just that the run ended:
  // one that reported with plan steps still open is "partial".
  let status: "completed" | "partial" | "failed" = args.status;
  let openSteps: string[] = [];
  if (args.status === "completed") {
    const run = await prisma.researchRun.findUnique({ where: { id: args.runId }, select: { plan: true } });
    const plan = Array.isArray(run?.plan) ? (run.plan as { title?: string; status?: string }[]) : [];
    openSteps = plan.filter((s) => s.status === "todo" || s.status === "doing").map((s) => s.title ?? "untitled step");
    if (openSteps.length > 0) status = "partial";
  }

  // A cancel (or an earlier finish) already set a terminal status — keep it.
  const updated = await prisma.researchRun.updateMany({
    where: { id: args.runId, status: { in: ["queued", "running"] } },
    data: {
      status,
      report,
      error: args.error,
      stepCount: args.steps,
      endedAt: new Date(),
    },
  });
  if (updated.count === 0) return;
  await prisma.researchWorkflow.updateMany({
    where: { id: args.workflowId, currentRunId: args.runId },
    data: { status },
  });
  if (status === "completed") {
    await addEvent(
      args.workflowId,
      args.runId,
      "run_completed",
      `Run #${args.number} completed`,
      report ? report.slice(0, 600) : null,
      { steps: args.steps }
    );
  } else if (status === "partial") {
    await addEvent(
      args.workflowId,
      args.runId,
      "run_partial",
      `Run #${args.number} finished with ${openSteps.length} plan step(s) not done`,
      `Not done:\n${openSteps.map((t) => `- ${t}`).join("\n")}${report ? `\n\n${report.slice(0, 600)}` : ""}`,
      { steps: args.steps, openSteps }
    );
  } else {
    await addEvent(args.workflowId, args.runId, "run_failed", `Run #${args.number} failed`, args.error, { steps: args.steps });
  }
}

/**
 * Writes the run's report in one plain model call — no tools offered, none
 * named — from what the run saved. Used when the agent's own last turn
 * failed or ended without a report. Returns null if this fails too, and
 * finishRunStep then falls back to listing the findings.
 */
export async function writeReportStep(args: {
  workflowId: string;
  runId: string;
  modelWireId: string;
  name: string;
  brief: string;
  lastText: string | null;
}): Promise<string | null> {
  "use step";
  const { prisma } = await import("@/lib/prisma");
  const { generateText } = await import("ai");
  const { addEvent, loadModelConfig } = await import("@/lib/research/service");
  const { buildClientModel } = await import("@/lib/research/model");
  const { REPORT_WRITER_INSTRUCTIONS, reportWriterPrompt } = await import("@/lib/research/prompts");

  const [run, findings, notes, toolEvents] = await Promise.all([
    prisma.researchRun.findUnique({ where: { id: args.runId }, select: { plan: true } }),
    prisma.researchFinding.findMany({
      where: { runId: args.runId },
      orderBy: { createdAt: "asc" },
      select: { title: true, content: true, sources: true },
    }),
    prisma.researchWorkflowEvent.findMany({
      where: { runId: args.runId, type: "note" },
      orderBy: { createdAt: "asc" },
      take: 40,
      select: { title: true, detail: true },
    }),
    prisma.researchWorkflowEvent.findMany({
      where: { runId: args.runId, type: "tool" },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: { title: true, detail: true, data: true },
    }),
  ]);
  // Excerpts of what the tools returned, so a run that read papers but
  // recorded no findings still gets a report grounded in what it saw.
  const activity = toolEvents.reverse().map((e) => {
    const output = (e.data as { output?: unknown } | null)?.output;
    return {
      title: e.title,
      summary: e.detail,
      output: typeof output === "string" ? output.slice(0, 700) : null,
    };
  });
  try {
    const cfg = await loadModelConfig(args.modelWireId);
    const { text } = await generateText({
      model: buildClientModel(cfg),
      system: REPORT_WRITER_INSTRUCTIONS,
      prompt: reportWriterPrompt({
        name: args.name,
        brief: args.brief,
        findings,
        notes,
        activity,
        plan: run?.plan ?? null,
        lastText: args.lastText,
      }),
      maxRetries: 3,
    });
    return text.trim() || null;
  } catch (err) {
    await addEvent(
      args.workflowId,
      args.runId,
      "note",
      "Couldn't write the report with the model — keeping the findings as the report",
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}

export async function noteRetryStep(args: { workflowId: string; runId: string; title: string; detail: string }) {
  "use step";
  const { addEvent } = await import("@/lib/research/service");
  await addEvent(args.workflowId, args.runId, "note", args.title, args.detail, { retry: true });
}

export async function prepareChatTurnStep(workflowId: string, modelWireId: string | null) {
  "use step";
  const { getWorkflowState, loadModelConfig } = await import("@/lib/research/service");
  const [cfg, state] = await Promise.all([loadModelConfig(modelWireId), getWorkflowState(workflowId)]);
  return { cfg, stateText: JSON.stringify(state, null, 2) };
}

export async function finishChatTurnStep(workflowId: string, wfRunId: string) {
  "use step";
  const { prisma } = await import("@/lib/prisma");
  await prisma.researchWorkflow.updateMany({
    where: { id: workflowId, activeChatRunId: wfRunId },
    data: { activeChatRunId: null },
  });
}
