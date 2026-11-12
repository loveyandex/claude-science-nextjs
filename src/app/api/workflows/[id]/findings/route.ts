import { prisma } from "@/lib/prisma";
import { loadOwnedWorkflow } from "@/lib/research/access";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const owned = await loadOwnedWorkflow(req, params.id);
  if (!owned.ok) return owned.response;

  const q = new URL(req.url).searchParams.get("q")?.trim();
  const rows = await prisma.researchFinding.findMany({
    where: {
      workflowId: params.id,
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" as const } },
              { content: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    include: { run: { select: { number: true } } },
  });
  return Response.json({
    findings: rows.map((f) => ({
      id: f.id,
      title: f.title,
      content: f.content,
      sources: f.sources,
      confidence: f.confidence,
      tags: f.tags,
      runNumber: f.run?.number ?? null,
      createdAt: f.createdAt.toISOString(),
    })),
  });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const owned = await loadOwnedWorkflow(req, params.id);
  if (!owned.ok) return owned.response;
  const findingId = new URL(req.url).searchParams.get("findingId");
  if (!findingId) return Response.json({ error: "findingId is required." }, { status: 400 });
  const { count } = await prisma.researchFinding.deleteMany({ where: { id: findingId, workflowId: params.id } });
  if (count === 0) return Response.json({ error: "Finding not found." }, { status: 404 });
  return Response.json({ ok: true });
}
