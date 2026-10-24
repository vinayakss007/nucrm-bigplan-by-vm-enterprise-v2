/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  classifySecurityMigration,
  discoverSecurityTags,
  hasSecuritySql,
  MIN_SECURITY_MIGRATIONS,
  RLS_TAG_RE,
  stripSqlComments,
} from '../../scripts/apply-rls-ci.mjs';

/**
 * #3171: `scripts/apply-rls-ci.mjs` decides which migrations CI provisions its
 * integration database with. It did that by matching each FILENAME against
 * `/rls|isolation|polic|bypass|member_read|tenant_reference|force_/i`, which is
 * a proxy for content — so every file that writes policies without saying so in
 * its title was never applied, and a regression that DELETES one of those
 * policies is invisible to CI. That is #2232's failure mode again, one migration
 * number later.
 *
 * The corpus is the real one, because the whole point is a measurement over 132
 * files: a fixture would only prove the regex does something.
 */

const ROOT = join(import.meta.dirname!, '..', '..');
const DIR = join(ROOT, 'drizzle', 'migrations');

const entries = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
  .map((f) => ({ tag: f.replace(/\.sql$/, ''), sql: readFileSync(join(DIR, f), 'utf8') }));

const included = discoverSecurityTags(entries);
const byNameOnly = entries.filter((e) => RLS_TAG_RE.test(e.tag)).map((e) => e.tag);

describe('the files the filename test missed (#3171)', () => {
  // Re-measured at `04698d679`. The issue's table named 11; the wider content
  // test (TRIGGER, GRANT/REVOKE) finds 15 — `0000`, `0002` and `0049` really do
  // carry `grant`/`revoke` statements, and `0042` is the audit-purge trigger
  // whose absence made #3165's suite unable to demonstrate itself.
  const missed = [
    '0000_init',
    '0002_flat_sir_ram',
    '0038_cross_module_record_linking',
    '0041_teams',
    '0042_audit_log_immutability',
    '0049_fk_integrity',
    '0059_custom_entities',
    '0094_sa_audit_tenant_id_uuid',
    '0096_analytics_events_ingest_insert',
    '0098_tenant_hierarchy_party_access',
    '0099_api_keys_auth_lookup',
    '0100_tenants_super_admin_update',
    '0105_email_tracking_pixel_lookup',
    '0127_membership_self_scoped_select',
    '0131_super_admin_usage_read',
  ];

  it.each(missed)('%s is applied because its SQL says so, not its name', (tag) => {
    expect(RLS_TAG_RE.test(tag), `${tag} must stay invisible to the filename test — that is the bug`).toBe(false);
    expect(included, `${tag} is not in CI's provisioning set`).toContain(tag);
    const entry = entries.find((e) => e.tag === tag)!;
    expect(hasSecuritySql(entry.sql)).toBe(true);
  });

  it('and none of them arrived by loosening the name test', () => {
    // The union is additive: every tag the old rule applied is still applied.
    // "content discovery replaced it" would have quietly dropped `0060`,
    // `0066`, `0070`, `0086` and `0124` — four that name-match on prose-ish
    // words and one whose only security statement is a DROP POLICY.
    for (const tag of byNameOnly) expect(included).toContain(tag);
  });
});

describe('prose is not a security object', () => {
  const proseOnly = [
    '0013_workflow_foundation',
    '0018_workflow_foundation_legacy',
    '0109_webhook_events_created_at_not_null',
    '0125_declared_not_null_columns',
    '0129_automations_dedupe_unique',
  ];

  it.each(proseOnly)('%s matches only inside a comment, and stays out', (tag) => {
    const entry = entries.find((e) => e.tag === tag)!;
    expect(RLS_TAG_RE.test(tag)).toBe(false);
    // Raw text says yes…
    expect(entry.sql).toMatch(/GRANT|REVOKE|ROW LEVEL SECURITY|CREATE (OR REPLACE )?TRIGGER/i);
    // …and the classifier says no, because it reads the SQL, not the header.
    expect(hasSecuritySql(entry.sql)).toBe(false);
    expect(included).not.toContain(tag);
  });

  it('blanking a comment keeps every offset, so a report still names the right line', () => {
    const sql = "select 1; -- CREATE POLICY tenant_isolation ON contacts\n/* GRANT */ select 2;\n";
    const blanked = stripSqlComments(sql);
    expect(blanked).toHaveLength(sql.length);
    expect(blanked).not.toMatch(/CREATE POLICY|GRANT/);
    expect(blanked.match(/\n/g)).toHaveLength(sql.match(/\n/g)!.length);
  });

  it('does not confuse an escaped quote or a policy template with a comment', () => {
    // `''` inside a literal is an escape, not a close, and the loop-built
    // `format('CREATE POLICY …')` shape is a real security object that must
    // count (rls-policy-map.mjs calls this shape 2).
    expect(hasSecuritySql("select 'don''t'; -- nothing\n")).toBe(false);
    expect(hasSecuritySql("EXECUTE format('CREATE POLICY %I ON %I', t, tbl);")).toBe(true);
    expect(hasSecuritySql("select '-- not a comment marker';")).toBe(false);
  });
});

describe('the discovery set is measured, not assumed', () => {
  it('provisions more of the chain than the filename test ever did, and fails closed', () => {
    // Floors and membership lists, not an absolute count: `drizzle/migrations`
    // gains a file about every other PR (this repo's own #3172 adds `0132`), and
    // a pinned total would fail a correct new migration while saying nothing
    // about the thing that actually breaks — the content test stopping working.
    // What must not regress is the DELTA: at least 15 applied files carry
    // security SQL their filename never mentioned.
    expect(included.length).toBeGreaterThanOrEqual(38);
    expect(included.length).toBeGreaterThanOrEqual(MIN_SECURITY_MIGRATIONS);
    const foundByContentOnly = included.filter((t) => !RLS_TAG_RE.test(t));
    expect(foundByContentOnly.length).toBeGreaterThanOrEqual(15);
    expect(entries.filter((e) => hasSecuritySql(e.sql)).length).toBeGreaterThanOrEqual(34);
  });

  it('comes back in journal order, oldest first', () => {
    const idxs = included.map((t) => parseInt(t, 10));
    expect(idxs).toEqual([...idxs].sort((a, b) => a - b));
  });

  it('classifies a missing file as missing rather than as a non-match', () => {
    expect(classifySecurityMigration('zzz_rls_named_file', null).included).toBe(true);
    expect(classifySecurityMigration('zzz_plain_rename', null).included).toBe(false);
  });

  it('applies a migration that RETIRES a security object too', () => {
    // Otherwise CI's database keeps a policy production has dropped, and the
    // divergence is silent in the other direction.
    expect(hasSecuritySql('DROP POLICY "tenant_isolation" ON "contacts";')).toBe(true);
    expect(hasSecuritySql('ALTER POLICY "p" ON "t" USING (true);')).toBe(true);
  });

  it('would have caught #3163’s migration, which the filename test cannot see', () => {
    // `0132_public_form_capture_lookup` (PR #3172) creates a SELECT-only policy
    // behind a dedicated GUC. Its name contains none of the eight words.
    const tag = '0132_public_form_capture_lookup';
    const sql =
      '--> statement-breakpoint\n' +
      'CREATE POLICY "forms_public_capture_lookup" ON "forms" AS PERMISSIVE FOR SELECT USING (\n' +
      "  id = (NULLIF(current_setting('app.form_lookup_id', true), ''))::uuid\n);\n";
    expect(RLS_TAG_RE.test(tag)).toBe(false);
    expect(classifySecurityMigration(tag, sql)).toMatchObject({ byContent: true, byName: false, included: true });
  });

  it('is importable without provisioning anything', () => {
    // `main()` needs DATABASE_URL and shells out to psql, and it used to run on
    // import. This file's own top-level import is the assertion: unguarded, the
    // worker would have exited with "DATABASE_URL is required" and every test
    // above would read as a suite failure rather than a discovery set.
    expect(typeof classifySecurityMigration).toBe('function');
    expect(discoverSecurityTags([{ tag: '0001_no_security_sql', sql: 'select 1;' }])).toEqual([]);
  });
});
