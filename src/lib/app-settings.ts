import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Accessor for the single `AppSettings` row.
 *
 * Extracted out of gemma4-settings.ts once a second feature (the
 * make-embedding pipeline) needed the same row: both pipelines store
 * their settings here, and neither should own the other's find-or-create.
 */

export const SETTINGS_ID = "singleton";

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
export async function getOrCreateSettings() {
  const existing = await prisma.appSettings.findUnique({ where: { id: SETTINGS_ID } });
  if (existing) return existing;
  try {
    return await prisma.appSettings.create({ data: { id: SETTINGS_ID } });
  } catch (err) {
    if (!isUniqueConstraintError(err)) throw err;
    return prisma.appSettings.findUniqueOrThrow({ where: { id: SETTINGS_ID } });
  }
}
