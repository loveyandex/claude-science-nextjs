import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthFromRequest, unauthorized } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  const body = await req.json().catch(() => null);
  const { enabled } = (body ?? {}) as { enabled?: unknown };
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "enabled (boolean) is required." }, { status: 400 });
  }

  const existing = await prisma.cerebrasApiKey.findUnique({ where: { id: params.id } });
  if (!existing) {
    return NextResponse.json({ error: "No such API key." }, { status: 404 });
  }

  await prisma.cerebrasApiKey.update({ where: { id: params.id }, data: { enabled } });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  const existing = await prisma.cerebrasApiKey.findUnique({ where: { id: params.id } });
  if (!existing) {
    return NextResponse.json({ error: "No such API key." }, { status: 404 });
  }

  await prisma.cerebrasApiKey.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
