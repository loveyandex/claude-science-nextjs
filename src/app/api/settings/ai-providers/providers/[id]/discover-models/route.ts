import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthFromRequest, unauthorized } from "@/lib/auth";
import { discoverModels } from "@/lib/ai-providers-settings";

export const dynamic = "force-dynamic";

// Returns HTTP 200 whether or not discovery itself succeeded — transport
// success and discovery outcome are separate things, so the panel can
// render a readable error inline without special-casing non-2xx.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  const provider = await prisma.aiProvider.findUnique({ where: { id: params.id } });
  if (!provider) {
    return NextResponse.json({ error: "No such provider." }, { status: 404 });
  }

  const result = await discoverModels(provider);
  return NextResponse.json(result);
}
