import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthFromRequest, unauthorized } from "@/lib/auth";
import { maskKey } from "@/lib/gemma4-settings";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  const body = await req.json().catch(() => null);
  const { label, key } = (body ?? {}) as { label?: unknown; key?: unknown };

  if (typeof key !== "string" || !key.trim()) {
    return NextResponse.json({ error: "A non-empty API key is required." }, { status: 400 });
  }

  const created = await prisma.cerebrasApiKey.create({
    data: {
      key: key.trim(),
      label: typeof label === "string" && label.trim() ? label.trim() : null,
      source: "manual",
    },
  });

  return NextResponse.json({
    id: created.id,
    label: created.label,
    maskedKey: maskKey(created.key),
    source: created.source,
    enabled: created.enabled,
    createdAt: created.createdAt.toISOString(),
  });
}
