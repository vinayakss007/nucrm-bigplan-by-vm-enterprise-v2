/**
 * #2237 — static guard for migration 0109_webhook_events_created_at_not_null.
 *
 * Shape copied from tests/unit/schema/invoices-quote-unique-migration.test.ts:
 * the live wedge scenario (NULL created_at → `lt(createdAt, cutoff)` never
 * matches → UNIQUE(provider, event_id) claim stuck "already processed"
 * forever) is proven against a real DB by CI; what this file protects is
 * that the fix keeps its shape:
 *   - the migration is registered in _journal.json (scripts/migrate.ts is
 *     journal-driven; an unregistered file is never applied);
 *   - it is NOT an RLS migration, so its tag stays outside the RLS_TAG_RE
 *     discovery in scripts/apply-rls-ci.mjs;
 *   - the backfill UPDATE runs under the platform GUC (webhook_events is
 *     FORCE RLS since 0088 — without it the UPDATE matches zero rows and
 *     SET NOT NULL aborts on every DB that actually has NULLs);
 *   - the backfill sentinel makes an orphaned 'claimed' row immediately
 *     stealable (ancient time), not "fresh";
 *   - DEFAULT now() + SET NOT NULL are restated so the column can never go
 *     blind again;
 *   - the down migration only relaxes NOT NULL (the honest timestamps are
 *     never reversed);
 *   - the drizzle schema (drizzle/schema/billing.ts) declares the column
 *     notNull, and the sweeper (lib/webhooks/idempotency.ts) keeps its
 *     NULL-tolerant OR branch for databases where 0109 has not replayed yet.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname!, '../../..');
const MIGRATIONS_DIR = join(ROOT, 'drizzle/migrations');
const UP_FILE = join(MIGRATIONS_DIR, '0109_webhook_events_created_at_not_null.sql');
const DOWN_FILE = join(MIGRATIONS_DIR, '0109_webhook_events_created_at_not_null.down.sql');
const JOURNAL_FILE = join(MIGRATIONS_DIR, 'meta', '_journal.json');

const TAG = '0109_webhook_events_created_at_not_null';

const sql = readFileSync(UP_FILE, 'utf8');
const downSql = readFileSync(DOWN_FILE, 'utf8');
const journal = JSON.parse(readFileSync(JOURNAL_FILE, 'utf8')) as {
  entries: Array<{ idx: number; when: number; tag: string; breakpoints: boolean }>;
};

describe(`migration ${TAG} (#2237)`, () => {
  it('is registered in _journal.json with increasing idx/when', () => {
    const entry = journal.entries.find((e) => e.tag === TAG);
    expect(entry, `${TAG} missing from _journal.json — migrate.ts would never apply it`).toBeDefined();
    const pos = journal.entries.indexOf(entry!);
    expect(pos).toBeGreaterThan(0);
    const prev = journal.entries[pos - 1];
    expect(entry!.idx).toBeGreaterThan(prev.idx);
    expect(entry!.when).toBeGreaterThan(prev.when);
    // The slot reserved for this fix (issue #2237 / rebased tip had 0108@105).
    expect(entry!.idx).toBe(106);
    expect(entry!.tag).toBe('0109_webhook_events_created_at_not_null');
    expect(entry!.breakpoints).toBe(true);
  });

  it('is NOT mislabeled as an RLS migration (stays out of apply-rls-ci discovery)', () => {
    // In sync with RLS_TAG_RE in scripts/apply-rls-ci.mjs — this migration
    // tightens a column, not a policy, and must not be picked up there.
    expect(TAG).not.toMatch(/rls|isolation|polic|bypass|member_read|tenant_reference|force_/i);
  });

  it('backfills NULL created_at under the platform GUC, sentinel ancient for claims', () => {
    const executable = sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    // FORCE RLS (0088) — without the GUC the UPDATE silently matches 0 rows.
    expect(executable).toContain(`set_config('app.is_super_admin', 'true', true)`);
    expect(executable).toMatch(/COALESCE\("processed_at",\s*to_timestamp\(0\)\)/);
    expect(executable).toMatch(/WHERE\s+"created_at" IS NULL/);
    // Catalogue-guarded for idempotent re-runs.
    expect(executable).toMatch(/is_nullable\s*=\s*'YES'/);
  });

  it('restates the default and enforces NOT NULL', () => {
    const executable = sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    expect(executable).toMatch(/ALTER TABLE "webhook_events" ALTER COLUMN "created_at" SET DEFAULT now\(\)/);
    expect(executable).toMatch(/ALTER TABLE "webhook_events" ALTER COLUMN "created_at" SET NOT NULL/);
  });

  it('down migration relaxes NOT NULL only and never destroys data', () => {
    expect(downSql).toMatch(/ALTER COLUMN "created_at" DROP NOT NULL/);
    expect(downSql).not.toMatch(/DELETE|TRUNCATE|DROP TABLE/i);
  });

  it('drizzle schema declares the column notNull with a default', () => {
    const schema = readFileSync(join(ROOT, 'drizzle/schema/billing.ts'), 'utf8');
    const decl = schema.match(
      /createdAt: timestamp\('created_at', \{ withTimezone: true \}\)\.defaultNow\(\)\.notNull\(\),\s*processedAt[\s\S]*?\/\/ ── SERVICE SUBSCRIPTIONS/,
    );
    expect(decl, 'webhook_events.created_at must be notNull().defaultNow() in the schema').not.toBeNull();
  });

  it('sweeper keeps its NULL-tolerant OR branch (pre-0109 databases self-heal)', () => {
    const sweeper = readFileSync(join(ROOT, 'lib/webhooks/idempotency.ts'), 'utf8');
    expect(sweeper).toMatch(/import \{[^}]*\bor\b[^}]*\} from 'drizzle-orm'/);
    expect(sweeper).toMatch(/import \{[^}]*\bisNull\b[^}]*\} from 'drizzle-orm'/);
    expect(sweeper).toMatch(
      /or\(\s*isNull\(webhookEvents\.createdAt\),\s*lt\(webhookEvents\.createdAt, staleBefore\),?\s*\)/,
    );
  });
});
