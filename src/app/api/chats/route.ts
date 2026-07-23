import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthFromRequest, unauthorized } from "@/lib/auth";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  mode: z.enum(["chat", "chat-assist-ui"]).default("chat"),
  model: z.string().optional(),
  thinking: z.boolean().optional(),
});

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid input." }, { status: 400 });
  }

  const chat = await prisma.chat.create({
    data: {
      userId: auth.sub,
      mode: parsed.data.mode,
      model: parsed.data.model ?? "gpt-oss",
      thinking: parsed.data.thinking ?? false,
    },
    select: { id: true, mode: true, title: true, model: true, thinking: true, createdAt: true },
  });

  return Response.json({ chat }, { status: 201 });
}

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() || undefined;
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(searchParams.get("limit") || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT)
  );

  const where = {
    userId: auth.sub,
    // Exclude rows created by NewChatRedirect that were never actually
    // sent a message — otherwise every visit to /chat that didn't result
    // in a message would clutter this list.
    messages: { not: [] },
    ...(q ? { title: { contains: q, mode: "insensitive" as const } } : {}),
  };

  const [chats, total] = await Promise.all([
    prisma.chat.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      select: { id: true, mode: true, title: true, model: true, updatedAt: true, createdAt: true },
    }),
    prisma.chat.count({ where }),
  ]);

  return Response.json({
    chats,
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  });
}
