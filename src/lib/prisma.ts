import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Prisma 7 requires an explicit driver adapter instead of a bare connection
// string on the datasource block (that only configures the CLI now, via
// prisma.config.ts). PrismaPg accepts a plain connection string directly.
const adapter = new PrismaPg(
  process.env.POSTGRES_URL || "postgresql://admin:admin@localhost:5432/locaul-science"
);

// Standard Next.js dev-mode singleton so hot-reload doesn't spawn a new
// PrismaClient (and a new connection pool) on every file change.
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
