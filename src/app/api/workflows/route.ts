import { prisma } from "@/lib/prisma";
import { getAuthFromRequest, unauthorized } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 20));
  const where = {
    userId: auth.sub,
    ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.researchWorkflow.findMany({
      where,
      orderBy: { lastActivityAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        name: true,
        brief: true,
        status: true,
        createdAt: true,
        lastActivityAt: true,
        _count: { select: { runs: true, findings: true } },
      },
    }),
    prisma.researchWorkflow.count({ where }),
  ]);

  return Response.json({
    workflows: rows.map((w) => ({
      id: w.id,
      name: w.name,
      brief: w.brief.slice(0, 240),
      status: w.status,
      createdAt: w.createdAt.toISOString(),
      lastActivityAt: w.lastActivityAt.toISOString(),
      runCount: w._count.runs,
      findingCount: w._count.findings,
    })),
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  });
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return Response.json({ error: "Give the workflow a name." }, { status: 400 });
  if (name.length > 120) return Response.json({ error: "Keep the name under 120 characters." }, { status: 400 });

  const workflow = await prisma.researchWorkflow.create({
    data: {
      userId: auth.sub,
      name,
      modelWireId: typeof body.modelWireId === "string" ? body.modelWireId : null,
    },
  });
  return Response.json({ workflow: { id: workflow.id, name: workflow.name } }, { status: 201 });
}
