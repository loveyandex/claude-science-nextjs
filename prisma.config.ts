import "dotenv/config"; // 👈 Crucial to load your .env file
import { defineConfig, env } from "prisma/config"; // 👈 Prisma 7 helper imports

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("POSTGRES_URL"), // 👈 Safely reads from your environment variables
  },
});
