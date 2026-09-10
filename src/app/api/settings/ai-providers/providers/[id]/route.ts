import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthFromRequest, unauthorized } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  const body = await req.json().catch(() => null);
  const { label, baseUrl, apiKey, enabled } = (body ?? {}) as {
    label?: unknown;
    baseUrl?: unknown;
    apiKey?: unknown;
    enabled?: unknown;
  };

  const existing = await prisma.aiProvider.findUnique({ where: { id: params.id } });
  if (!existing) {
    return NextResponse.json({ error: "No such provider." }, { status: 404 });
  }

  await prisma.aiProvider.update({
    where: { id: params.id },
    data: {
      ...(typeof label === "string" && label.trim() ? { label: label.trim() } : {}),
      ...(typeof baseUrl === "string" ? { baseUrl: baseUrl.trim() || null } : {}),
      ...(typeof apiKey === "string" ? { apiKey: apiKey.trim() || null } : {}),
      ...(typeof enabled === "boolean" ? { enabled } : {}),
    },
  });

  return NextResponse.json({ ok: true });
}

// Cascades to this provider's AiProviderModel rows via the schema's
// onDelete: Cascade — old Chat rows referencing one of those wireIds
// still resolve via ai-provider.ts's getModel() fallback, they just stop
// pointing at this specific provider.
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  const existing = await prisma.aiProvider.findUnique({ where: { id: params.id } });
  if (!existing) {
    return NextResponse.json({ error: "No such provider." }, { status: 404 });
  }

  await prisma.aiProvider.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
