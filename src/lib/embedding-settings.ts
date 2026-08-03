import { prisma } from "@/lib/prisma";
import { SETTINGS_ID, getOrCreateSettings } from "@/lib/app-settings";

/**
 * make-embedding pipeline settings.
 *
 * These live in Postgres rather than .env because changing any of them
 * changes how *stored data* is interpreted, not just how this deployment
 * runs: chunk size and model are both folded into each page's content
 * hash (see backend/app/services/embedding_service.py), so editing one
 * invalidates every recorded "resume at chunk N" cursor and forces those
 * pages to be re-embedded. That's a database-visible decision, and it
 * belongs next to the data it invalidates.
 */

export type EmbeddingSettings = {
  collection: string;
  model: string;
  chunkTokens: number;
  chunkOverlap: number;
  pageBatch: number;
};

// Guard rails for user-supplied values. The upper chunk bound is the
// practical ceiling for the small BGE-family models this ships with
// (512 tokens); going past it doesn't error, it silently truncates.
const LIMITS = {
  chunkTokens: { min: 64, max: 512 },
  chunkOverlap: { min: 0, max: 256 },
  pageBatch: { min: 1, max: 50 },
} as const;

function clamp(value: number, { min, max }: { min: number; max: number }): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

export async function getEmbeddingSettings(): Promise<EmbeddingSettings> {
  const settings = await getOrCreateSettings();
  return {
    collection: settings.embeddingCollection,
    model: settings.embeddingModel,
    chunkTokens: settings.embeddingChunkTokens,
    chunkOverlap: settings.embeddingChunkOverlap,
    pageBatch: settings.embeddingPageBatch,
  };
}

export type EmbeddingSettingsPatch = Partial<{
  collection: string;
  model: string;
  chunkTokens: number;
  chunkOverlap: number;
  pageBatch: number;
}>;

export async function updateEmbeddingSettings(
  patch: EmbeddingSettingsPatch
): Promise<EmbeddingSettings> {
  await getOrCreateSettings();

  const data: Record<string, string | number> = {};
  if (typeof patch.collection === "string" && patch.collection.trim()) {
    data.embeddingCollection = patch.collection.trim();
  }
  if (typeof patch.model === "string" && patch.model.trim()) {
    data.embeddingModel = patch.model.trim();
  }
  if (typeof patch.chunkTokens === "number") {
    data.embeddingChunkTokens = clamp(patch.chunkTokens, LIMITS.chunkTokens);
  }
  if (typeof patch.chunkOverlap === "number") {
    data.embeddingChunkOverlap = clamp(patch.chunkOverlap, LIMITS.chunkOverlap);
  }
  if (typeof patch.pageBatch === "number") {
    data.embeddingPageBatch = clamp(patch.pageBatch, LIMITS.pageBatch);
  }

  // Overlap has to stay meaningfully below the chunk size, or every chunk
  // is mostly a copy of the previous one and the run never really advances.
  const nextTokens = (data.embeddingChunkTokens as number) ?? undefined;
  const nextOverlap = (data.embeddingChunkOverlap as number) ?? undefined;
  if (nextTokens !== undefined || nextOverlap !== undefined) {
    const current = await getEmbeddingSettings();
    const tokens = nextTokens ?? current.chunkTokens;
    const overlap = nextOverlap ?? current.chunkOverlap;
    if (overlap > Math.floor(tokens / 2)) {
      data.embeddingChunkOverlap = Math.floor(tokens / 2);
    }
  }

  if (Object.keys(data).length > 0) {
    await prisma.appSettings.update({ where: { id: SETTINGS_ID }, data });
  }
  return getEmbeddingSettings();
}
