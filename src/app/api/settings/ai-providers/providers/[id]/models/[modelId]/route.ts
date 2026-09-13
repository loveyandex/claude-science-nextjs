import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthFromRequest, unauthorized } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string; modelId: string } }
) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  const body = await req.json().catch(() => null);
  const { enabled, label } = (body ?? {}) as { enabled?: unknown; label?: unknown };

  const existing = await prisma.aiProviderModel.findFirst({
    where: { id: params.modelId, providerId: params.id },
  });
  if (!existing) {
    return NextResponse.json({ error: "No such model." }, { status: 404 });
  }

  await prisma.aiProviderModel.update({
    where: { id: params.modelId },
    data: {
      ...(typeof enabled === "boolean" ? { enabled } : {}),
      ...(typeof label === "string" ? { label: label.trim() || null } : {}),
    },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string; modelId: string } }
) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  const existing = await prisma.aiProviderModel.findFirst({
    where: { id: params.modelId, providerId: params.id },
  });
  if (!existing) {
    return NextResponse.json({ error: "No such model." }, { status: 404 });
  }

  await prisma.aiProviderModel.delete({ where: { id: params.modelId } });
  return NextResponse.json({ ok: true });
}
