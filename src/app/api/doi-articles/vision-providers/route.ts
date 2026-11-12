import { getAuthFromRequest, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensureEnvProvidersSeeded } from "@/lib/ai-providers-settings";

export const dynamic = "force-dynamic";

// Enabled providers the backend's transcriber can talk to — openai-compatible
// and google (Gemini API) — and their enabled models, for the "make science"
// pickers. Whether a model accepts images is the user's call; the backend
// reports one that doesn't. Keys never leave the server.
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  await ensureEnvProvidersSeeded();
  const providers = await prisma.aiProvider.findMany({
    where: { enabled: true, type: { in: ["openai-compatible", "google"] } },
    orderBy: { createdAt: "asc" },
    include: { models: { where: { enabled: true }, orderBy: { createdAt: "asc" } } },
  });

  return Response.json({
    providers: providers.map((p) => ({
      id: p.id,
      type: p.type,
      label: p.label,
      baseUrl: p.baseUrl,
      models: p.models.map((m) => ({ modelName: m.modelName, label: m.label || m.modelName })),
    })),
  });
}
