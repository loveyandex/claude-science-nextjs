import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { maskKey } from "@/lib/gemma4-settings";

export type ProviderType = "openai-compatible" | "google";

export const PROVIDER_TYPES: ProviderType[] = ["openai-compatible", "google"];

/**
 * Seeds the two legacy env-driven models ("gpt-oss" / "gemini-flash-lite")
 * as real AiProvider/AiProviderModel rows the first time the pool is ever
 * empty — mirrors ensureEnvKeySeeded()'s one-time-only semantics (deleting
 * every row afterward doesn't bring these back). Unconditional on the keys
 * actually being set, same as ai-provider.ts's old "warn, don't throw on a
 * missing key" behavior, so a zero-config checkout still gets a usable
 * default shape.
 *
 * Wrapped in a transaction with a re-check to guard the same double-invoke
 * race getOrCreateSettings() guards against (two concurrent first requests
 * both seeing an empty pool).
 */
export async function ensureEnvProvidersSeeded(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const count = await tx.aiProvider.count();
    if (count > 0) return;

    await tx.aiProvider.create({
      data: {
        type: "openai-compatible",
        label: "OpenAI-compatible (.env)",
        baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
        apiKey: process.env.OPENAI_API_KEY || null,
        source: "env",
        models: {
          create: {
            wireId: "gpt-oss",
            modelName: process.env.MODEL_NAME || "gpt-oss-120b",
          },
        },
      },
    });

    await tx.aiProvider.create({
      data: {
        type: "google",
        label: "Google Gemini (.env)",
        apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || null,
        source: "env",
        models: {
          create: {
            wireId: "gemini-flash-lite",
            modelName: process.env.GEMINI_MODEL_NAME || "gemini-3.1-flash-lite",
          },
        },
      },
    });
  });
}

/** Full CRUD view for the settings panel — every provider/model, enabled or not, apiKey masked. */
export async function listProvidersForSettings() {
  await ensureEnvProvidersSeeded();

  const providers = await prisma.aiProvider.findMany({
    orderBy: { createdAt: "asc" },
    include: { models: { orderBy: { createdAt: "asc" } } },
  });

  return providers.map((p) => ({
    id: p.id,
    type: p.type,
    label: p.label,
    baseUrl: p.baseUrl,
    maskedApiKey: p.apiKey ? maskKey(p.apiKey) : null,
    hasApiKey: !!p.apiKey,
    enabled: p.enabled,
    source: p.source,
    createdAt: p.createdAt.toISOString(),
    models: p.models.map((m) => ({
      id: m.id,
      wireId: m.wireId,
      modelName: m.modelName,
      label: m.label,
      enabled: m.enabled,
      createdAt: m.createdAt.toISOString(),
    })),
  }));
}

/**
 * Flat, chat-picker-facing list: only enabled models on enabled providers.
 * Kept as its own query (not derived from listProvidersForSettings) since
 * this runs on every chat page load via GET /api/chat and shouldn't
 * over-fetch disabled rows.
 */
export async function listChatModels(): Promise<
  { id: string; label: string; description: string }[]
> {
  await ensureEnvProvidersSeeded();

  const models = await prisma.aiProviderModel.findMany({
    where: { enabled: true, provider: { enabled: true } },
    include: { provider: true },
    orderBy: { createdAt: "asc" },
  });

  return models.map((m) => ({
    id: m.wireId,
    label: m.label || m.modelName,
    description: `${m.provider.label} · ${m.provider.type}`,
  }));
}

type DiscoverResult =
  | { ok: true; candidates: { modelName: string; label?: string }[] }
  | { ok: false; error: string };

/**
 * Best-effort live fetch of a provider's own model list — hits an
 * arbitrary user-configured endpoint (e.g. a local Ollama server that may
 * not be running), so every failure mode degrades to {ok:false, error}
 * rather than throwing. Never writes to the DB itself; the settings panel
 * shows candidates as one-click-add suggestions.
 */
export async function discoverModels(provider: {
  type: string;
  baseUrl: string | null;
  apiKey: string | null;
}): Promise<DiscoverResult> {
  try {
    if (provider.type === "openai-compatible") {
      if (!provider.baseUrl) return { ok: false, error: "This provider has no base URL configured." };
      const url = `${provider.baseUrl.replace(/\/+$/, "")}/models`;
      const res = await fetch(url, {
        headers: provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : undefined,
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return { ok: false, error: `Provider returned ${res.status} ${res.statusText}.` };
      const json = await res.json().catch(() => null);
      const data = json?.data;
      if (!Array.isArray(data)) return { ok: false, error: "Unexpected response shape from /models." };
      return {
        ok: true,
        candidates: data
          .filter((m): m is { id: string } => typeof m?.id === "string")
          .map((m) => ({ modelName: m.id })),
      };
    }

    if (provider.type === "google") {
      if (!provider.apiKey) return { ok: false, error: "This provider has no API key configured." };
      const base = (provider.baseUrl || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
      const url = `${base}/models?key=${encodeURIComponent(provider.apiKey)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return { ok: false, error: `Provider returned ${res.status} ${res.statusText}.` };
      const json = await res.json().catch(() => null);
      const models = json?.models;
      if (!Array.isArray(models)) return { ok: false, error: "Unexpected response shape from ListModels." };
      return {
        ok: true,
        candidates: models
          .filter((m): m is { name: string; displayName?: string } => typeof m?.name === "string")
          .map((m) => ({
            modelName: m.name.replace(/^models\//, ""),
            label: m.displayName,
          })),
      };
    }

    return { ok: false, error: `Unknown provider type "${provider.type}".` };
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      return { ok: false, error: "Timed out reaching the provider." };
    }
    return { ok: false, error: err instanceof Error ? err.message : "Failed to reach the provider." };
  }
}

export function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}
