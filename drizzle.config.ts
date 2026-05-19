import type { Config } from 'drizzle-kit';

export default {
  schema: './drizzle/schema/index.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || "postgresql://postgres:13d46e6a411e83f9d60730a7f31aae6e@localhost:5432/nucrm",
  },
} satisfies Config;
