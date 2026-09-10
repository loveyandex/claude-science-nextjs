import { NextResponse } from "next/server";
import { getAuthFromRequest, unauthorized } from "@/lib/auth";
import { listProvidersForSettings } from "@/lib/ai-providers-settings";

export const dynamic = "force-dynamic";

// GET returns every configured provider (enabled or not) with its models
// (enabled or not) and masked API keys — the full picture the settings
// page needs in one call.
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  const providers = await listProvidersForSettings();
  return NextResponse.json({ providers });
}
