import { WorkflowAgent } from "@ai-sdk/workflow";
import { isStepCount, type ModelMessage } from "ai";
import { sleep } from "workflow";
import { buildModel } from "@/lib/research/model";
import { dropUnansweredToolCalls, stripReasoningFor } from "@/lib/research/prompt-shaping";
import { PLAN_WRAP_UP, researchInstructions, runKickoffMessage } from "@/lib/research/prompts";
import { RESEARCH_TOOLS } from "@/lib/research/tool-defs";
import { buildTools } from "@/workflows/research-tools";
import {
  beginRunStep,
  finishRunStep,
  noteRetryStep,
  recordModelStepStep,
  writeReportStep,
  type RunInput,
} from "@/workflows/research-steps";

const RESUME_DELAYS = [30_000, 60_000, 120_000, 300_000, 600_000];

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
  return String(err);
}

function isTransientError(err: unknown): boolean {
  const status = (err as { statusCode?: number } | null)?.statusCode;
  if (typeof status === "number") return status === 408 || status === 429 || status >= 500;
  return /high demand|overloaded|unavailable|rate.?limit|quota|too many requests|timed? ?out|timeout|ECONNRESET|ECONNREFUSED|socket|network|fetch failed|\b5\d\d\b|\b429\b/i.test(
    errorMessage(err)
  );
}

// The provider rejected a malformed or unexpected tool call (Groq's
// tool_use_failed) — usually fine on a retry, except on the report step.
function isToolUseError(err: unknown): boolean {
  return /tool_use_failed|tool choice is none|called a tool|failed to call a function/i.test(errorMessage(err));
}

function formatDelay(ms: number) {
  return ms >= 60_000 ? `${ms / 60_000} min` : `${ms / 1000}s`;
}


// Tool results older than this many prompt messages get trimmed before each
// model call, so a long run's context stays bounded; what mattered should
// already be in findings/notes by then.
const KEEP_RECENT_MESSAGES = 12;
const TRIM_OVER_CHARS = 2000;

type PromptMessage = { role: string; content: unknown };

function trimOldToolResults<T extends PromptMessage[]>(messages: T): T {
  const cutoff = messages.length - KEEP_RECENT_MESSAGES;
  if (cutoff <= 0) return messages;
  return messages.map((m, i) => {
    if (i >= cutoff || m.role !== "tool" || !Array.isArray(m.content)) return m;
    return {
      ...m,
      content: m.content.map((part: any) => {
        if (part?.type !== "tool-result" || part.output == null) return part;
        const size = JSON.stringify(part.output).length;
        if (size <= TRIM_OVER_CHARS) return part;
        const value = part.output.value;
        const preview = (typeof value === "string" ? value : JSON.stringify(value ?? "")).slice(0, 600);
        return {
          ...part,
          output: {
            type: "text",
            value: `[older tool output trimmed from ${size} chars to save context — call the tool again if you need it]\n${preview}…`,
          },
        };
      }),
    };
  }) as T;
}

/**
 * One research run: a WorkflowAgent working through the brief with the
 * library/notebook tools. Durable — every model call and tool call is a
 * workflow step, so a server restart resumes the run where it stopped.
 * Progress is written to Postgres by the steps (not streamed), which is
 * what the /workflow/[id] timeline polls.
 */
export async function researchRunWorkflow(input: RunInput) {
  "use workflow";

  const begin = await beginRunStep(input);
  if (begin.cancelled) return { status: "cancelled" as const };

  const ctx = { workflowId: input.workflowId, userId: input.userId, runId: input.runId, actor: "run" as const };
  const instructions = researchInstructions({ name: input.name, maxSteps: input.maxSteps });
  const kickoff: ModelMessage = {
    role: "user",
    content: runKickoffMessage({
      number: input.number,
      brief: input.brief,
      note: input.note,
      priorFindings: begin.priorFindings,
      priorReport: begin.priorReport,
    }),
  };
  // The whole conversation so far, appended after every finished step, so a
  // provider failure — returned or thrown — can resume exactly where it stopped.
  const conversation: ModelMessage[] = [kickoff];
  // Model steps finished so far, across resumes.
  let stepIndex = 0;
  let stepsBefore = 0;
  let lastText: string | null = null;
  const reportArgs = () => ({
    workflowId: input.workflowId,
    runId: input.runId,
    modelWireId: input.modelWireId,
    name: input.name,
    brief: input.brief,
    lastText,
  });

  const agent = new WorkflowAgent({
    model: buildModel(begin.cfg),
    instructions,
    tools: buildTools(RESEARCH_TOOLS, ctx),
    toolCallConcurrency: 1,
    maxRetries: 4,
    prepareStep: ({ stepNumber, messages }) => {
      const used = stepsBefore + stepNumber;
      const left = input.maxSteps - 1 - used;
      return {
        messages: stripReasoningFor(begin.cfg.type, trimOldToolResults(messages as PromptMessage[])) as typeof messages,
        // Last allowed step: the tools are withheld entirely (some providers
        // ignore toolChoice "none"), so the only possible answer is the report.
        ...(left <= 0
          ? {
              activeTools: [],
              system: `${instructions}\n\nYour step budget is used up. Do not call any tools. Reply now with the final report in markdown, based on what you found so far.`,
            }
          : left === 1
            ? {
                // Closes out the plan while a tool is still allowed, so the run's
                // final status reflects what was actually done.
                activeTools: ["updatePlan"],
                toolChoice: { type: "tool" as const, toolName: "updatePlan" },
                system: `${instructions}\n\n${PLAN_WRAP_UP}`,
              }
          : used >= Math.floor(input.maxSteps * 0.6)
            ? {
                system: `${instructions}\n\nBudget check: ${left} step(s) left before the report. Stop broad searching — read the most relevant pages you've found and record findings for what you verify.`,
              }
            : {}),
      };
    },
    onStepEnd: async (step) => {
      stepIndex += 1;
      if (step.text?.trim()) lastText = step.text;
      conversation.push(...((step.response?.messages ?? []) as ModelMessage[]));
      await recordModelStepStep({
        workflowId: input.workflowId,
        runId: input.runId,
        stepIndex,
        text: step.text ?? "",
        reasoning: step.reasoningText ?? "",
        toolNames: (step.toolCalls ?? []).map((c) => c.toolName),
        inputTokens: step.usage?.inputTokens ?? 0,
        outputTokens: step.usage?.outputTokens ?? 0,
      });
    },
  });

  try {
    // Consecutive provider failures without progress; any finished step resets it.
    let retries = 0;
    for (;;) {
      stepsBefore = stepIndex;
      let error: unknown = undefined;
      let thrown = false;
      let report: string | null = null;
      try {
        const result = await agent.stream({
          messages: dropUnansweredToolCalls(conversation),
          stopWhen: isStepCount(Math.max(1, input.maxSteps - stepsBefore)),
        });
        report = result.steps[result.steps.length - 1]?.text?.trim() || null;
        if ("error" in result && result.error !== undefined && !report) error = result.error ?? "Unknown model error";
      } catch (err) {
        // A model step that exhausted its own retries throws instead.
        error = err;
        thrown = true;
      }

      if (error === undefined) {
        await finishRunStep({
          workflowId: input.workflowId,
          runId: input.runId,
          number: input.number,
          status: "completed",
          report: report ?? (await writeReportStep(reportArgs())),
          error: null,
          steps: stepIndex,
        });
        return { status: "completed" as const };
      }

      const message = errorMessage(error);
      const onReportStep = stepIndex >= input.maxSteps - 1;
      if (onReportStep) {
        // The research itself is done; only the closing answer failed.
        const written = await writeReportStep(reportArgs());
        if (written) {
          await noteRetryStep({
            workflowId: input.workflowId,
            runId: input.runId,
            title: "The last model turn failed — report written from the notebook instead",
            detail: message,
          });
          await finishRunStep({
            workflowId: input.workflowId,
            runId: input.runId,
            number: input.number,
            status: "completed",
            report: written,
            error: null,
            steps: stepIndex,
          });
          return { status: "completed" as const };
        }
      }
      // A returned error still went through onStepEnd for the broken step
      // itself, so only steps beyond that one count as progress.
      if (stepIndex - stepsBefore > (thrown ? 0 : 1)) retries = 0;
      const recoverable = isTransientError(error) || isToolUseError(error);
      if (!recoverable || onReportStep || retries >= RESUME_DELAYS.length || stepIndex >= input.maxSteps) {
        throw new Error(message);
      }
      // A busy/rate-limited provider shouldn't end hours of work: wait
      // (durably — a restart mid-wait keeps the schedule) and continue the
      // same conversation where it stopped.
      const delay = RESUME_DELAYS[retries];
      retries += 1;
      await noteRetryStep({
        workflowId: input.workflowId,
        runId: input.runId,
        title: `${isToolUseError(error) ? "Model sent a malformed tool call" : "Provider busy"} — resuming in ${formatDelay(delay)} (retry ${retries}/${RESUME_DELAYS.length})`,
        detail: message,
      });
      await sleep(delay);
    }
  } catch (err) {
    await finishRunStep({
      workflowId: input.workflowId,
      runId: input.runId,
      number: input.number,
      status: "failed",
      report: null,
      error: err instanceof Error ? err.message : String(err),
      steps: stepIndex,
    });
    return { status: "failed" as const };
  }
}
