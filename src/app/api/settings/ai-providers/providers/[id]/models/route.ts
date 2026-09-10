import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthFromRequest, unauthorized } from "@/lib/auth";
import { isUniqueConstraintError } from "@/lib/ai-providers-settings";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  const body = await req.json().catch(() => null);
  const { modelName, label, wireId } = (body ?? {}) as {
    modelName?: unknown;
    label?: unknown;
    wireId?: unknown;
  };

  if (typeof modelName !== "string" || !modelName.trim()) {
    return NextResponse.json({ error: "A non-empty modelName is required." }, { status: 400 });
  }

  const provider = await prisma.aiProvider.findUnique({ where: { id: params.id } });
  if (!provider) {
    return NextResponse.json({ error: "No such provider." }, { status: 404 });
  }

  const resolvedWireId = typeof wireId === "string" && wireId.trim() ? wireId.trim() : randomUUID();

  try {
    const created = await prisma.aiProviderModel.create({
      data: {
        providerId: provider.id,
        wireId: resolvedWireId,
        modelName: modelName.trim(),
        label: typeof label === "string" && label.trim() ? label.trim() : null,
      },
    });
    return NextResponse.json({
      id: created.id,
      wireId: created.wireId,
      modelName: created.modelName,
      label: created.label,
      enabled: created.enabled,
      createdAt: created.createdAt.toISOString(),
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return NextResponse.json({ error: `wireId "${resolvedWireId}" is already in use.` }, { status: 409 });
    }
    throw err;
  }
}
