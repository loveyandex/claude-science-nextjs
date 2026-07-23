import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyPassword, signToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1, "Password is required."),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || "Invalid input." },
      { status: 400 }
    );
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  // Same generic error whether the email doesn't exist or the password is
  // wrong — don't leak which one it was.
  const invalid = () => Response.json({ error: "Invalid email or password." }, { status: 401 });

  if (!user) return invalid();
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return invalid();

  const token = await signToken({ sub: user.id, email: user.email });
  return Response.json({
    token,
    user: { id: user.id, email: user.email, createdAt: user.createdAt },
  });
}
