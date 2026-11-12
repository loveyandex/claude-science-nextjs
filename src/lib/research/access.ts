import { prisma } from "@/lib/prisma";
import { getAuthFromRequest, unauthorized } from "@/lib/auth";

type Owned =
  | { ok: true; userId: string; workflow: NonNullable<Awaited<ReturnType<typeof prisma.researchWorkflow.findUnique>>> }
  | { ok: false; response: Response };

/** Auth + ownership for /api/workflows/[id]/* — someone else's workflow is the same 404 as a missing one. */
export async function loadOwnedWorkflow(req: Request, id: string): Promise<Owned> {
  const auth = await getAuthFromRequest(req);
  if (!auth) return { ok: false, response: unauthorized() };
  const workflow = await prisma.researchWorkflow.findUnique({ where: { id } });
  if (!workflow || workflow.userId !== auth.sub) {
    return { ok: false, response: Response.json({ error: "Workflow not found." }, { status: 404 }) };
  }
  return { ok: true, userId: auth.sub, workflow };
}
