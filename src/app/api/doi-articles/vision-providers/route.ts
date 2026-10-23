import { getAuthFromRequest, unauthorized } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensureEnvProvidersSeeded } from "@/lib/ai-providers-settings";

export const dynamic = "force-dynamic";

// Enabled openai-compatible providers (the only type the backend's
// transcriber speaks) and their enabled models, for the "make science"
// panel's provider/model pickers. Keys never leave the server.
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();

  await ensureEnvProvidersSeeded();
  const providers = await prisma.aiProvider.findMany({
    where: { enabled: true, type: "openai-compatible" },
    orderBy: { createdAt: "asc" },
    include: { models: { where: { enabled: true }, orderBy: { createdAt: "asc" } } },
  });

  return Response.json({
    providers: providers.map((p) => ({
      id: p.id,
      label: p.label,
      baseUrl: p.baseUrl,
      models: p.models.map((m) => ({ modelName: m.modelName, label: m.label || m.modelName })),
    })),
  });
}
