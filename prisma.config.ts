import { defineConfig } from "prisma/config";

// Prisma 7 moved the datasource URL out of schema.prisma and into this
// config file for CLI commands (db push, migrate, studio). The Prisma
// Client itself is instantiated with the better-sqlite3 driver adapter in
// src/lib/prisma.ts — this file only affects `prisma` CLI invocations.
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
