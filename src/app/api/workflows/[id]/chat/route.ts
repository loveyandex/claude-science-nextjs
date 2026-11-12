import { createModelCallToUIChunkTransform } from "@ai-sdk/workflow";
import { createUIMessageStreamResponse, readUIMessageStream, type UIMessage, type UIMessageChunk } from "ai";
import { start } from "workflow/api";
import { prisma } from "@/lib/prisma";
import { ensureMessageIds } from "@/lib/message-ids";
import { loadOwnedWorkflow } from "@/lib/research/access";
import { researchChatTurn } from "@/workflows/research-chat";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Saves the conversation once the turn's stream ends. Reads its own branch
 * of the stream, so the reply is stored even if the browser disconnects
 * mid-turn (the workflow keeps running either way).
 */
async function persistReply(workflowId: string, incoming: UIMessage[], stream: ReadableStream<UIMessageChunk>) {
  let reply: UIMessage | undefined;
  try {
    for await (const message of readUIMessageStream({ stream })) reply = message;
  } catch (err) {
    console.error("[workflows/chat] reading the reply stream failed:", err);
  }
  if (!reply || reply.parts.length === 0) return;
  await prisma.researchWorkflow.update({
    where: { id: workflowId },
    data: { chatMessages: ensureMessageIds([...incoming, reply]) as unknown as object },
  });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const owned = await loadOwnedWorkflow(req, params.id);
  if (!owned.ok) return owned.response;

  const body = await req.json().catch(() => ({}));
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return Response.json({ error: "messages is required." }, { status: 400 });
  }
  const incoming = ensureMessageIds(body.messages as UIMessage[]);
  const modelWireId = typeof body.model === "string" && body.model ? body.model : owned.workflow.modelWireId;

  // Store the user's message right away, so a reload mid-turn still shows it.
  await prisma.researchWorkflow.update({
    where: { id: params.id },
    data: { chatMessages: incoming as unknown as object, lastActivityAt: new Date() },
  });

  const run = await start(researchChatTurn, [
    { workflowId: params.id, userId: owned.userId, modelWireId, messages: incoming },
  ]);
  await prisma.researchWorkflow.update({ where: { id: params.id }, data: { activeChatRunId: run.runId } });

  const [toClient, toStore] = run.readable.pipeThrough(createModelCallToUIChunkTransform()).tee();
  void persistReply(params.id, incoming, toStore);

  return createUIMessageStreamResponse({
    stream: toClient,
    headers: { "x-workflow-run-id": run.runId },
  });
}
