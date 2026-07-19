import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

// Prisma 7 requires an explicit driver adapter instead of a bare
// `DATABASE_URL` on the datasource block (which now only configures the
// CLI via prisma.config.ts). better-sqlite3 is a native binding, so this
// also avoids the WASM query engine entirely for local dev.
const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL?.replace(/^file:/, "") || "./prisma/dev.db",
});

// Standard Next.js dev-mode singleton so hot-reload doesn't spawn a new
// PrismaClient (and a new SQLite connection) on every file change.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
