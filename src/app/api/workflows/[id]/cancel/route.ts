import { loadOwnedWorkflow } from "@/lib/research/access";
import { cancelResearchRun } from "@/lib/research/service";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const owned = await loadOwnedWorkflow(req, params.id);
  if (!owned.ok) return owned.response;
  const body = await req.json().catch(() => ({}));
  const result = await cancelResearchRun(params.id, typeof body.reason === "string" ? body.reason : "Cancelled by user");
  if (!result.ok) return Response.json({ error: result.error }, { status: 409 });
  return Response.json(result);
}
