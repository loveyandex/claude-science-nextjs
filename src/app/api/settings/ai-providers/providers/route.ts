import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthFromRequest, unauthorized } from "@/lib/auth";
import { maskKey } from "@/lib/gemma4-settings";
import { PROVIDER_TYPES, type ProviderType } from "@/lib/ai-providers-settings";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  const body = await req.json().catch(() => null);
  const { type, label, baseUrl, apiKey } = (body ?? {}) as {
    type?: unknown;
    label?: unknown;
    baseUrl?: unknown;
    apiKey?: unknown;
  };

  if (typeof type !== "string" || !PROVIDER_TYPES.includes(type as ProviderType)) {
    return NextResponse.json(
      { error: `type must be one of: ${PROVIDER_TYPES.join(", ")}` },
      { status: 400 }
    );
  }
  if (typeof label !== "string" || !label.trim()) {
    return NextResponse.json({ error: "A non-empty label is required." }, { status: 400 });
  }
  if (type === "openai-compatible" && (typeof baseUrl !== "string" || !baseUrl.trim())) {
    return NextResponse.json(
      { error: "baseUrl is required for an openai-compatible provider." },
      { status: 400 }
    );
  }

  const created = await prisma.aiProvider.create({
    data: {
      type,
      label: label.trim(),
      baseUrl: typeof baseUrl === "string" && baseUrl.trim() ? baseUrl.trim() : null,
      apiKey: typeof apiKey === "string" && apiKey.trim() ? apiKey.trim() : null,
      source: "manual",
    },
  });

  return NextResponse.json({
    id: created.id,
    type: created.type,
    label: created.label,
    baseUrl: created.baseUrl,
    maskedApiKey: created.apiKey ? maskKey(created.apiKey) : null,
    hasApiKey: !!created.apiKey,
    enabled: created.enabled,
    source: created.source,
    createdAt: created.createdAt.toISOString(),
    models: [],
  });
}
