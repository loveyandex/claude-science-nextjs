import 'dotenv/config'; // Required to load variables from .env
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma', // Path to your schema
  datasource: {
    url: env('DATABASE_URL'), // Reads DATABASE_URL securely
  },
});
