import { WorkflowAgent, type ModelCallStreamPart } from "@ai-sdk/workflow";
import { convertToModelMessages, isStepCount, type UIMessage } from "ai";
import { getWorkflowMetadata, getWritable } from "workflow";
import { buildModel } from "@/lib/research/model";
import { dropUnansweredToolCalls, stripReasoningFor } from "@/lib/research/prompt-shaping";
import { chatInstructions } from "@/lib/research/prompts";
import { CHAT_TOOLS } from "@/lib/research/tool-defs";
import { buildTools } from "@/workflows/research-tools";
import { finishChatTurnStep, prepareChatTurnStep } from "@/workflows/research-steps";

/**
 * One chat-pane turn on a research workflow: a WorkflowAgent that can read
 * the workflow's state, edit its brief, start/cancel runs and use the
 * library tools. Streams to the client through WorkflowChatTransport, which
 * reconnects via /api/workflows/[id]/chat/[runId]/stream if the response drops.
 */
export async function researchChatTurn(input: {
  workflowId: string;
  userId: string;
  modelWireId: string | null;
  messages: UIMessage[];
}) {
  "use workflow";

  const { cfg, stateText } = await prepareChatTurnStep(input.workflowId, input.modelWireId);
  const agent = new WorkflowAgent({
    model: buildModel(cfg),
    instructions: chatInstructions(stateText),
    maxRetries: 3,
    prepareStep: ({ messages }) => ({ messages: stripReasoningFor(cfg.type, messages) }),
    tools: buildTools(CHAT_TOOLS, {
      workflowId: input.workflowId,
      userId: input.userId,
      runId: null,
      actor: "chat",
    }),
  });

  try {
    const result = await agent.stream({
      messages: dropUnansweredToolCalls(await convertToModelMessages(input.messages)),
      writable: getWritable<ModelCallStreamPart>(),
      stopWhen: isStepCount(12),
    });
    return { steps: result.steps.length };
  } finally {
    await finishChatTurnStep(input.workflowId, getWorkflowMetadata().workflowRunId);
  }
}
