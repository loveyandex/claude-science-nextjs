import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type ConcurrencyMode = "pages_per_pdf" | "pdfs_per_key";

const SETTINGS_ID = "singleton";

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/**
 * Prisma's `upsert` isn't safe against a genuinely concurrent insert (seen
 * in practice: React dev-mode double-invoking an effect fires two requests
 * at once, both see "no row", both try `create`, the second hits a unique
 * violation instead of falling back to update). This does the same
 * find-or-create but treats a P2002 on create as "someone else just made
 * it" and re-reads instead of crashing.
 */
async function getOrCreateSettings() {
  const existing = await prisma.appSettings.findUnique({ where: { id: SETTINGS_ID } });
  if (existing) return existing;
  try {
    return await prisma.appSettings.create({ data: { id: SETTINGS_ID } });
  } catch (err) {
    if (!isUniqueConstraintError(err)) throw err;
    return prisma.appSettings.findUniqueOrThrow({ where: { id: SETTINGS_ID } });
  }
}

/** Never return a raw key to the client — first 6 + last 4 chars only. */
export function maskKey(key: string): string {
  if (key.length <= 10) return "••••••••";
  return `${key.slice(0, 6)}••••${key.slice(-4)}`;
}

/**
 * If the pool is completely empty and CEREBRAS_API_KEY is set in the
 * Next.js app's own .env, seed it as one entry. Only runs once ever —
 * once the pool has any row (including one the user later deletes), this
 * is a no-op, so deleting the env-seeded key doesn't bring it back.
 */
export async function ensureEnvKeySeeded(): Promise<void> {
  const count = await prisma.cerebrasApiKey.count();
  if (count > 0) return;
  const envKey = process.env.CEREBRAS_API_KEY;
  if (!envKey) return;
  await prisma.cerebrasApiKey.create({
    data: { label: "From .env", key: envKey, source: "env" },
  });
}

export async function getEnabledKeyValues(): Promise<string[]> {
  await ensureEnvKeySeeded();
  const keys = await prisma.cerebrasApiKey.findMany({
    where: { enabled: true },
    select: { key: true },
    orderBy: { createdAt: "asc" },
  });
  return keys.map((k: { key: string }) => k.key);
}

export async function getConcurrencyMode(): Promise<ConcurrencyMode> {
  const settings = await getOrCreateSettings();
  return settings.gemma4ConcurrencyMode as ConcurrencyMode;
}

export async function setConcurrencyMode(mode: ConcurrencyMode): Promise<void> {
  await getOrCreateSettings();
  await prisma.appSettings.update({ where: { id: SETTINGS_ID }, data: { gemma4ConcurrencyMode: mode } });
}

/** Used by the /api/settings/gemma4 GET route — the settings page needs both pieces at once. */
export async function getAppSettings() {
  return getOrCreateSettings();
}
