import { loadOwnedWorkflow } from "@/lib/research/access";
import { startResearchRun } from "@/lib/research/service";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const owned = await loadOwnedWorkflow(req, params.id);
  if (!owned.ok) return owned.response;
  const body = await req.json().catch(() => ({}));
  const result = await startResearchRun(params.id, typeof body.note === "string" ? body.note : null);
  if (!result.ok) return Response.json({ error: result.error }, { status: 409 });
  return Response.json(result, { status: 201 });
}
