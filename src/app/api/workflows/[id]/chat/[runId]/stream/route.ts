import { createModelCallToUIChunkTransform } from "@ai-sdk/workflow";
import { createUIMessageStreamResponse } from "ai";
import { getRun } from "workflow/api";
import { loadOwnedWorkflow } from "@/lib/research/access";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** WorkflowChatTransport's reconnect endpoint: replays a chat turn's stream from a UI chunk index. */
export async function GET(req: Request, { params }: { params: { id: string; runId: string } }) {
  const owned = await loadOwnedWorkflow(req, params.id);
  if (!owned.ok) return owned.response;

  const startIndex = Number(new URL(req.url).searchParams.get("startIndex") ?? "0");
  if (!Number.isSafeInteger(startIndex) || startIndex < 0) {
    return Response.json({ error: "startIndex must be a non-negative integer." }, { status: 400 });
  }
  // The transport falls back to the chat id (= workflow id) when it has no
  // run id yet, e.g. resuming after a reload: use the turn still in flight.
  const runId = params.runId === params.id ? owned.workflow.activeChatRunId : params.runId;
  if (!runId) return new Response(null, { status: 204 });

  const readable = getRun(runId)
    .getReadable({ startIndex: 0 })
    .pipeThrough(createModelCallToUIChunkTransform({ uiStartIndex: startIndex }));
  return createUIMessageStreamResponse({ stream: readable, headers: { "x-workflow-run-id": runId } });
}
