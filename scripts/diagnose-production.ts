#!/usr/bin/env npx tsx
/**
 * Production diagnostic — READ ONLY.
 *
 * Answers the two questions that block the migration-chain baseline (ADR-0008)
 * and confirm whether tenant isolation has ever been active (#642), so nobody
 * has to know them from memory.
 *
 *   1. Is row-level security actually enabled, and are the policies enforced?
 *   2. Was this database built by `db:migrate` or by `db:push`/`db:sync`,
 *      and does it hold real customer data?
 *
 * SAFETY: this script issues SELECT statements only. It creates nothing, alters
 * nothing and deletes nothing. It opens a read-only transaction and rolls it
 * back, so it cannot write even if something in it were wrong. It prints counts
 * and schema facts — never row contents, never PII.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/diagnose-production.ts
 *   npm run db:diagnose
 */
import { Pool } from 'pg';

interface Row { [key: string]: unknown }

function heading(text: string): void {
  console.log(`\n${text}`);
  console.log('='.repeat(text.length));
}

function line(label: string, value: unknown): void {
  console.log(`  ${label.padEnd(38)} ${String(value)}`);
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('ERROR: DATABASE_URL is required.');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: url,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
    max: 1,
  });
  const client = await pool.connect();

  // Belt and braces: even a SELECT-only script runs inside a read-only
  // transaction, so a mistake cannot write to a production database.
  await client.query('BEGIN READ ONLY');

  const q = async (sql: string, params: unknown[] = []): Promise<Row[]> => {
    const r = await client.query(sql, params);
    return r.rows as Row[];
  };
  const one = async (sql: string): Promise<unknown> => {
    const rows = await q(sql);
    return rows[0] ? Object.values(rows[0])[0] : null;
  };
  const exists = async (sql: string): Promise<boolean> => Boolean(await one(sql));

  console.log('NuCRM production diagnostic (read-only)');
  console.log(`host database : ${await one('SELECT current_database()')}`);
  console.log(`connected as  : ${await one('SELECT current_user')}`);
  console.log(`server version: ${await one('SHOW server_version')}`);

  // ---------------------------------------------------------------
  // QUESTION 1 — row-level security
  // ---------------------------------------------------------------
  heading('QUESTION 1: is tenant isolation actually enforced?');

  const tablesTotal = await one(
    `SELECT count(*) FROM pg_tables WHERE schemaname = 'public'`
  );
  const rlsEnabled = await one(
    `SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND rowsecurity`
  );
  const policies = await one(
    `SELECT count(*) FROM pg_policies WHERE schemaname = 'public'`
  );
  const forced = await one(
    `SELECT count(*) FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relforcerowsecurity`
  );
  const tenantScoped = await one(
    `SELECT count(*) FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name = 'tenant_id'`
  );

  line('tables in public', tablesTotal);
  line('...that are tenant-scoped', tenantScoped);
  line('tables with RLS ENABLED', rlsEnabled);
  line('policies defined', policies);
  line('tables with FORCE ROW LEVEL SECURITY', forced);

  // Does the connecting role bypass RLS regardless of policies?
  const roleInfo = (await q(
    `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`
  ))[0];
  const ownsTables = await one(
    `SELECT count(*) FROM pg_tables
     WHERE schemaname = 'public' AND tableowner = current_user`
  );
  line('role is superuser', roleInfo?.rolsuper);
  line('role has BYPASSRLS', roleInfo?.rolbypassrls);
  line('tables owned by this role', ownsTables);

  console.log('');
  if (Number(rlsEnabled) === 0 || Number(policies) === 0) {
    console.log('  VERDICT: RLS is NOT active. Tenant isolation currently rests');
    console.log('           entirely on application-level WHERE clauses.');
  } else if (Number(forced) === 0 && (Number(ownsTables) > 0 || roleInfo?.rolsuper || roleInfo?.rolbypassrls)) {
    console.log('  VERDICT: policies exist but are INERT for this role — it owns the');
    console.log('           tables (or bypasses RLS), and PostgreSQL exempts owners');
    console.log('           from their own policies unless FORCE is set.');
  } else {
    console.log('  VERDICT: RLS appears to be enforced for this role.');
  }

  // ---------------------------------------------------------------
  // QUESTION 2 — how was this database built?
  // ---------------------------------------------------------------
  heading('QUESTION 2: db:migrate or db:push/db:sync?');

  // There are two candidate ledgers, and the difference matters:
  //   drizzle.__drizzle_migrations  - the one drizzle's migrate() consults
  //   public.__drizzle_migrations   - written by a historical bug in migrate.ts,
  //                                   which drizzle never reads
  // A database with rows in public but not in drizzle is the dangerous state:
  // it looks migrated but migrate() will try to replay everything.
  const ledgers: { schema: string; rows: number | null }[] = [];
  for (const schema of ['drizzle', 'public']) {
    const present = await exists(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = '${schema}' AND table_name = '__drizzle_migrations'`
    );
    ledgers.push({
      schema,
      rows: present ? Number(await one(`SELECT count(*) FROM "${schema}"."__drizzle_migrations"`)) : null,
    });
  }
  for (const l of ledgers) {
    line(`${l.schema}.__drizzle_migrations`, l.rows === null ? 'absent' : `${l.rows} row(s)`);
  }

  const authoritative = ledgers.find(l => l.schema === 'drizzle')?.rows ?? null;
  const strayLedger = ledgers.find(l => l.schema === 'public')?.rows ?? null;

  if (authoritative !== null && authoritative > 0) {
    const rows = await q(
      `SELECT hash, created_at FROM "drizzle"."__drizzle_migrations"
       ORDER BY created_at ASC, id ASC`
    );
    const last = rows[rows.length - 1];
    if (last) line('newest recorded entry', String(last.hash).slice(0, 48));
  }

  console.log('');
  if (authoritative === null || authoritative === 0) {
    console.log('  VERDICT: built with db:push / db:sync (or restored from a dump).');
    console.log('           drizzle has NO record of any migration, so the baseline must be');
    console.log('           STAMPED as already-applied, never executed.');
    if (strayLedger !== null && strayLedger > 0) {
      console.log('');
      console.log(`  !! WARNING: public.__drizzle_migrations holds ${strayLedger} row(s) while the`);
      console.log('     ledger drizzle reads is empty. That is the known migrate.ts bug: the');
      console.log('     recovery path seeded the wrong table, so `db:migrate` would try to');
      console.log('     replay every migration from 0000_init over this live schema.');
      console.log('     DO NOT run db:migrate until the fix in this branch is deployed.');
    }
  } else {
    console.log(`  VERDICT: built with db:migrate — ${authoritative} migration(s) recorded.`);
    console.log('           The baseline can be stamped against this ledger.');
  }

  // ---------------------------------------------------------------
  // QUESTION 2b — is there real customer data?
  // ---------------------------------------------------------------
  heading('QUESTION 2b: does this database hold real customer data?');

  const counts: { table: string; rows: number }[] = [];
  for (const t of ['tenants', 'users', 'contacts', 'companies', 'deals', 'invoices', 'audit_logs']) {
    const present = await exists(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = '${t}'`
    );
    if (!present) {
      counts.push({ table: t, rows: -1 });
      continue;
    }
    counts.push({ table: t, rows: Number(await one(`SELECT count(*) FROM "${t}"`)) });
  }
  for (const c of counts) {
    line(c.table, c.rows < 0 ? '(table absent)' : c.rows);
  }

  const total = counts.filter(c => c.rows > 0).reduce((s, c) => s + c.rows, 0);
  const tenantCount = counts.find(c => c.table === 'tenants')?.rows ?? 0;

  console.log('');
  if (total === 0) {
    console.log('  VERDICT: empty database — safe to rebuild from scratch.');
  } else if (tenantCount <= 1) {
    console.log(`  VERDICT: ${total} row(s) across ${tenantCount} tenant(s) — looks like`);
    console.log('           dev/demo data. Confirm before treating it as disposable.');
  } else {
    console.log(`  VERDICT: ${total} row(s) across ${tenantCount} tenants — TREAT AS LIVE`);
    console.log('           CUSTOMER DATA. The baseline must be stamped, never executed.');
  }

  heading('WHAT TO DO WITH THIS');
  console.log('  Paste this whole output back. It determines two things:');
  console.log('   - whether FORCE RLS can be turned on, and what has to change first');
  console.log('   - whether the migration baseline is stamped or executed (ADR-0008)');
  console.log('');
  console.log('  Nothing was written. This ran in a READ ONLY transaction.');

  await client.query('ROLLBACK');
  client.release();
  await pool.end();
}

main().catch(async (err: unknown) => {
  console.error('\ndiagnostic failed:', err instanceof Error ? err.message : String(err));
  console.error('Nothing was written.');
  process.exit(1);
});
