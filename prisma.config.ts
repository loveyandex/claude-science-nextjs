import "dotenv/config"; // ensures .env is loaded when the CLI runs this file standalone
import { defineConfig, env } from "prisma/config";

// Prisma 7 moved the datasource URL out of schema.prisma and into this
// config file for CLI commands (migrate dev, db push, studio). The Prisma
// Client itself is instantiated with the pg driver adapter in
// src/lib/prisma.ts — this file only affects `prisma` CLI invocations.
//
// env() (vs. a bare process.env.POSTGRES_URL) throws a clear error if the
// variable is missing, rather than silently passing `undefined` through to
// the Postgres connection and failing later with a much less obvious error.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("POSTGRES_URL"),
  },
});
