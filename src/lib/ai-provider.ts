import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { prisma } from "@/lib/prisma";
import { ensureEnvProvidersSeeded } from "@/lib/ai-providers-settings";

/**
 * Provider clients are built per-request from DB rows (src/lib/ai-providers-settings.ts
 * owns the pool) rather than once at import time, since which providers
 * exist is no longer a build-time/.env-only fact — it's editable from
 * /settings. See getModel() below.
 */

export type ResolvedModel = {
  model: LanguageModel;
  providerType: string;
  modelName: string;
};

function buildClientModel(
  provider: { type: string; baseUrl: string | null; apiKey: string | null; label: string },
  modelName: string
): LanguageModel {
  if (provider.type === "google") {
    // baseURL is optional here — omitting it falls back to the AI SDK's
    // own default (https://generativelanguage.googleapis.com/v1beta), but
    // a user-set one lets this point at a proxy or a Vertex-compatible
    // gateway instead of Google's public endpoint directly.
    const google = createGoogleGenerativeAI({
      apiKey: provider.apiKey ?? undefined,
      baseURL: provider.baseUrl || undefined,
    });
    return google(modelName);
  }
  // "openai-compatible" (and any unrecognized type, defensively) — baseUrl
  // is required for this type; validated on write in the settings routes.
  const openaiCompatible = createOpenAICompatible({
    name: provider.label,
    baseURL: provider.baseUrl || "https://api.openai.com/v1",
    apiKey: provider.apiKey ?? undefined,
  });
  return openaiCompatible(modelName);
}

/**
 * Resolve a client-selected model id (AiProviderModel.wireId) to an actual
 * AI SDK LanguageModel, plus enough metadata (providerType/modelName) for
 * callers like the chat route to make provider-aware decisions (e.g.
 * Gemini-only thinking mode) without a second DB round trip.
 *
 * An unrecognized/missing/deleted id doesn't error — it falls back to the
 * first enabled model on the first enabled provider (oldest first), so a
 * stale id from an old Chat row or another browser tab never hard-fails.
 */
export async function getModel(id: string | undefined | null): Promise<ResolvedModel> {
  await ensureEnvProvidersSeeded();

  if (id) {
    const row = await prisma.aiProviderModel.findFirst({
      where: { wireId: id, enabled: true, provider: { enabled: true } },
      include: { provider: true },
    });
    if (row) {
      return {
        model: buildClientModel(row.provider, row.modelName),
        providerType: row.provider.type,
        modelName: row.modelName,
      };
    }
  }

  const fallback = await prisma.aiProviderModel.findFirst({
    where: { enabled: true, provider: { enabled: true } },
    include: { provider: true },
    orderBy: { createdAt: "asc" },
  });
  if (!fallback) {
    throw new Error("No AI provider is configured — add one in Settings.");
  }
  return {
    model: buildClientModel(fallback.provider, fallback.modelName),
    providerType: fallback.provider.type,
    modelName: fallback.modelName,
  };
}

/** The default chat-capable model — used by /make-science's extraction step, which doesn't offer a picker. */
export async function getDefaultModel(): Promise<LanguageModel> {
  const resolved = await getModel(undefined);
  return resolved.model;
}
