import { prisma } from "@/lib/prisma";
import { ensureMessageIds } from "@/lib/message-ids";
import { loadOwnedWorkflow } from "@/lib/research/access";
import { addEvent, cancelResearchRun, ACTIVE_RUN_STATUSES } from "@/lib/research/service";
import type { UIMessage } from "ai";

export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

export async function GET(req: Request, { params }: Params) {
  const owned = await loadOwnedWorkflow(req, params.id);
  if (!owned.ok) return owned.response;
  const { workflow } = owned;

  const [runs, findingCount, eventCount] = await Promise.all([
    prisma.researchRun.findMany({ where: { workflowId: workflow.id }, orderBy: { number: "desc" } }),
    prisma.researchFinding.count({ where: { workflowId: workflow.id } }),
    prisma.researchWorkflowEvent.count({ where: { workflowId: workflow.id } }),
  ]);

  return Response.json({
    workflow: {
      id: workflow.id,
      name: workflow.name,
      brief: workflow.brief,
      status: workflow.status,
      modelWireId: workflow.modelWireId,
      maxSteps: workflow.maxSteps,
      currentRunId: workflow.currentRunId,
      activeChatRunId: workflow.activeChatRunId,
      createdAt: workflow.createdAt.toISOString(),
      lastActivityAt: workflow.lastActivityAt.toISOString(),
      chatMessages: ensureMessageIds((workflow.chatMessages as unknown as UIMessage[]) ?? []),
      findingCount,
      eventCount,
    },
    runs: runs.map((r) => ({
      id: r.id,
      number: r.number,
      status: r.status,
      brief: r.brief,
      modelLabel: r.modelLabel,
      maxSteps: r.maxSteps,
      stepCount: r.stepCount,
      toolCallCount: r.toolCallCount,
      plan: r.plan,
      report: r.report,
      error: r.error,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      startedAt: r.startedAt?.toISOString() ?? null,
      endedAt: r.endedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}

export async function PATCH(req: Request, { params }: Params) {
  const owned = await loadOwnedWorkflow(req, params.id);
  if (!owned.ok) return owned.response;
  const body = await req.json().catch(() => ({}));

  const data: { name?: string; brief?: string; modelWireId?: string | null; maxSteps?: number } = {};
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name || name.length > 120) return Response.json({ error: "Name must be 1–120 characters." }, { status: 400 });
    data.name = name;
  }
  if (body.brief !== undefined) data.brief = String(body.brief);
  if (body.modelWireId !== undefined) {
    if (body.modelWireId === null) data.modelWireId = null;
    else {
      const model = await prisma.aiProviderModel.findFirst({
        where: { wireId: String(body.modelWireId), enabled: true, provider: { enabled: true } },
      });
      if (!model) return Response.json({ error: "That model isn't available." }, { status: 400 });
      data.modelWireId = model.wireId;
    }
  }
  if (body.maxSteps !== undefined) {
    const n = Number(body.maxSteps);
    if (!Number.isInteger(n) || n < 3 || n > 300) {
      return Response.json({ error: "Max steps must be a whole number between 3 and 300." }, { status: 400 });
    }
    data.maxSteps = n;
  }

  const updated = await prisma.researchWorkflow.update({ where: { id: params.id }, data });
  if (data.brief !== undefined && data.brief !== owned.workflow.brief) {
    await addEvent(params.id, null, "brief_updated", "Brief edited", data.brief);
  }
  return Response.json({
    workflow: {
      id: updated.id,
      name: updated.name,
      brief: updated.brief,
      modelWireId: updated.modelWireId,
      maxSteps: updated.maxSteps,
    },
  });
}

export async function DELETE(req: Request, { params }: Params) {
  const owned = await loadOwnedWorkflow(req, params.id);
  if (!owned.ok) return owned.response;
  const active = await prisma.researchRun.count({
    where: { workflowId: params.id, status: { in: ACTIVE_RUN_STATUSES } },
  });
  if (active > 0) await cancelResearchRun(params.id, "Workflow deleted");
  await prisma.researchWorkflow.delete({ where: { id: params.id } });
  return Response.json({ ok: true });
}
