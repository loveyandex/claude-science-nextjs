import { prisma } from "@/lib/prisma";
import { loadOwnedWorkflow } from "@/lib/research/access";

export const dynamic = "force-dynamic";

/**
 * Timeline, oldest → newest. `after` (an ISO timestamp) returns only newer
 * events, which is how the page polls; `runId` narrows to one run.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const owned = await loadOwnedWorkflow(req, params.id);
  if (!owned.ok) return owned.response;

  const url = new URL(req.url);
  const runId = url.searchParams.get("runId");
  const after = url.searchParams.get("after");
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 300));
  const afterDate = after ? new Date(after) : null;

  const where = {
    workflowId: params.id,
    ...(runId ? { runId } : {}),
    // gte, not gt: two events can share a millisecond; the client de-dupes by id.
    ...(afterDate && !Number.isNaN(afterDate.getTime()) ? { createdAt: { gte: afterDate } } : {}),
  };
  // Initial load: the newest `limit` events; polls: everything after the cursor.
  const rows = afterDate
    ? await prisma.researchWorkflowEvent.findMany({ where, orderBy: { createdAt: "asc" }, take: limit })
    : (await prisma.researchWorkflowEvent.findMany({ where, orderBy: { createdAt: "desc" }, take: limit })).reverse();

  return Response.json({
    events: rows.map((e) => ({
      id: e.id,
      runId: e.runId,
      type: e.type,
      title: e.title,
      detail: e.detail,
      data: e.data,
      createdAt: e.createdAt.toISOString(),
    })),
  });
}
