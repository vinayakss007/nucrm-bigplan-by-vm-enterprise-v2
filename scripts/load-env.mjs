/**
 * NuCRM — preload that loads `.env.local` into `process.env`.
 *
 * PM2's `env_file` key is not implemented by PM2 7.x (it is silently ignored),
 * so anything PM2 launches with bare `node`/`tsx` starts with an empty
 * environment. `next start` gets around this because Next.js loads .env* itself;
 * `tsx` processes (worker.ts, scripts/cron-scheduler.ts) do NOT, which is why
 * the cron app died with "FATAL: CRON_SECRET is required" and the worker fell
 * back to redis://localhost:6379.
 *
 * Same contract as the dotenv calls in scripts/seed-dev.ts and
 * scripts/stress-test.ts, and idempotent: values already present in the
 * environment win (dotenv never overwrites), so `pm2 start --env` overrides and
 * systemd/CI-injected variables still take precedence.
 *
 * Usage:
 *   node --import ./scripts/load-env.mjs <entry>
 *   tsx --import ./scripts/load-env.mjs <entry>
 */
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

for (const file of ['.env.local', '.env']) {
  const result = config({ path: path.join(ROOT, file), quiet: true });
  // .env.local is the canonical file (deploy/generate-secrets.sh writes it and
  // ecosystem.config.cjs declares it). Stop there so a stale `.env` left over
  // from an older release can never shadow a rotated secret.
  if (!result.error) break;
}
