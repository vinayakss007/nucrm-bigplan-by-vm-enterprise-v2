import type { Config } from 'drizzle-kit';

export default {
  schema: './drizzle/schema/index.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || (() => { throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill in your database credentials.") })() as string,
  },
} satisfies Config;
