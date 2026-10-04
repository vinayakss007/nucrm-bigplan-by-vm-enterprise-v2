// Creates Postgres extensions that drizzle/schema indexes depend on but
// drizzle-kit push cannot create on its own (e.g. gin_trgm_ops indexes need
// pg_trgm). Runs before push in CI (npm run db:sync); idempotent.
import 'dotenv/config';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('db-extensions-ci: DATABASE_URL is not set');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, ssl: process.env.DATABASE_SSL === 'true' });
await client.connect();
try {
  await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  console.log('db-extensions-ci: pg_trgm ready');
} finally {
  await client.end();
}
