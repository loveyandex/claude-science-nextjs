import { z } from "zod";
import type { UIMessage } from "ai";
import { prisma } from "@/lib/prisma";
import { getAuthFromRequest, unauthorized } from "@/lib/auth";
import { ensureMessageIds } from "@/lib/message-ids";

export const dynamic = "force-dynamic";

async function loadOwnedChat(chatId: string, userId: string) {
  const chat = await prisma.chat.findUnique({ where: { id: chatId } });
  if (!chat || chat.userId !== userId) return null;
  return chat;
}

export async function GET(req: Request, { params }: { params: { chatId: string } }) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  const chat = await loadOwnedChat(params.chatId, auth.sub);
  if (!chat) return Response.json({ error: "Chat not found." }, { status: 404 });

  // Self-heals chats saved before ensureMessageIds existed in /api/chat's
  // onEnd — see src/lib/message-ids.ts for why this matters.
  const messages = ensureMessageIds((chat.messages as unknown as UIMessage[]) ?? []);

  return Response.json({ chat: { ...chat, messages } });
}

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  model: z.string().optional(),
  thinking: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: { chatId: string } }) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  const existing = await loadOwnedChat(params.chatId, auth.sub);
  if (!existing) return Response.json({ error: "Chat not found." }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid input." }, { status: 400 });

  const chat = await prisma.chat.update({
    where: { id: params.chatId },
    data: parsed.data,
    select: { id: true, mode: true, title: true, model: true, thinking: true, updatedAt: true },
  });

  return Response.json({ chat });
}

export async function DELETE(req: Request, { params }: { params: { chatId: string } }) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  const existing = await loadOwnedChat(params.chatId, auth.sub);
  if (!existing) return Response.json({ error: "Chat not found." }, { status: 404 });

  await prisma.chat.delete({ where: { id: params.chatId } });
  return Response.json({ ok: true });
}
