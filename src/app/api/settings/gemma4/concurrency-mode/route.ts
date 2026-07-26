import { NextResponse } from "next/server";
import { getAuthFromRequest, unauthorized } from "@/lib/auth";
import { setConcurrencyMode, type ConcurrencyMode } from "@/lib/gemma4-settings";

export const dynamic = "force-dynamic";

const VALID_MODES: ConcurrencyMode[] = ["pages_per_pdf", "pdfs_per_key"];

export async function PATCH(req: Request) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  const body = await req.json().catch(() => null);
  const { mode } = (body ?? {}) as { mode?: unknown };
  if (typeof mode !== "string" || !VALID_MODES.includes(mode as ConcurrencyMode)) {
    return NextResponse.json(
      { error: `mode must be one of: ${VALID_MODES.join(", ")}` },
      { status: 400 }
    );
  }

  await setConcurrencyMode(mode as ConcurrencyMode);
  return NextResponse.json({ ok: true, concurrencyMode: mode });
}
