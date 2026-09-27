import { NextResponse } from "next/server";
import { getAuthFromRequest, unauthorized } from "@/lib/auth";
import { getSpringerSettings, updateSpringerSettings } from "@/lib/springer-settings";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();
  return NextResponse.json(await getSpringerSettings());
}

export async function PATCH(req: Request) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "A JSON body is required." }, { status: 400 });
  }
  try {
    return NextResponse.json(await updateSpringerSettings(body));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid settings" }, { status: 400 });
  }
}
