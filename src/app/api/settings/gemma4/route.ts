import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthFromRequest, unauthorized } from "@/lib/auth";
import { ensureEnvKeySeeded, getAppSettings, maskKey } from "@/lib/gemma4-settings";

export const dynamic = "force-dynamic";

// GET returns the whole gemma4-settings picture the settings page needs in
// one call: the key pool (masked) and the current concurrency mode.
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  await ensureEnvKeySeeded();

  const [keys, settings] = await Promise.all([
    prisma.cerebrasApiKey.findMany({ orderBy: { createdAt: "asc" } }),
    getAppSettings(),
  ]);

  return NextResponse.json({
    keys: keys.map((k: { id: string; label: string | null; key: string; source: string; enabled: boolean; createdAt: Date }) => ({
      id: k.id,
      label: k.label,
      maskedKey: maskKey(k.key),
      source: k.source,
      enabled: k.enabled,
      createdAt: k.createdAt.toISOString(),
    })),
    concurrencyMode: settings.gemma4ConcurrencyMode,
  });
}
