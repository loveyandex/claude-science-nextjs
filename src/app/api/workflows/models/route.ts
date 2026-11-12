import { prisma } from "@/lib/prisma";
import { getAuthFromRequest, unauthorized } from "@/lib/auth";
import { ensureEnvProvidersSeeded } from "@/lib/ai-providers-settings";

export const dynamic = "force-dynamic";

/** Enabled providers with their enabled models, for the workflow page's provider → model picker. */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req);
  if (!auth) return unauthorized();
  await ensureEnvProvidersSeeded();

  const providers = await prisma.aiProvider.findMany({
    where: { enabled: true },
    orderBy: { createdAt: "asc" },
    include: { models: { where: { enabled: true }, orderBy: { createdAt: "asc" } } },
  });
  return Response.json({
    providers: providers
      .filter((p) => p.models.length > 0)
      .map((p) => ({
        id: p.id,
        label: p.label,
        type: p.type,
        baseUrl: p.baseUrl,
        models: p.models.map((m) => ({ wireId: m.wireId, modelName: m.modelName, label: m.label || m.modelName })),
      })),
  });
}
