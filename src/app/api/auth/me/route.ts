import { prisma } from "@/lib/prisma";
import { getAuthFromRequest, unauthorized } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  const user = await prisma.user.findUnique({
    where: { id: auth.sub },
    select: { id: true, email: true, createdAt: true },
  });
  if (!user) return unauthorized("Account no longer exists.");

  return Response.json({ user });
}
