import type { Config } from 'drizzle-kit';

export default {
  schema: './drizzle/schema/index.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || "postgresql://nucrm:nucrm_secure_password@localhost:5433/nucrm",
  },
} satisfies Config;
