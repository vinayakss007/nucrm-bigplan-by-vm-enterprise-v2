#!/usr/bin/env npx tsx
/**
 * Data integrity verification (issue #674, #676)
 *
 * Answers three questions about live data that no unit test can:
 *   - are there orphaned rows pointing at records that no longer exist?
 *   - does any row reference data belonging to a DIFFERENT tenant?
 *   - is the audit_logs hash chain contiguous, or has it been tampered with?
 *
 * Exits non-zero on any violation OR on any check that could not be run, so it
 * is safe to wire into CI or a post-deploy gate. "Nothing found" and "nothing
 * looked at" are deliberately not the same answer here.
 *
 * Usage:
 *   npm run db:verify-integrity
 *   npm run db:verify-integrity -- --audit-table super_admin_audit_logs
 *   npm run db:verify-integrity -- --limit 500
 */
import {
  verifyReferentialIntegrity,
  verifyTenantBoundaries,
  verifyAuditChainIntegrity,
} from '../lib/data-integrity';

function argValue(name: string, fallback?: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : fallback;
}

function heading(text: string): void {
  console.log(`\n${text}`);
  console.log('-'.repeat(text.length));
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL is required');
    process.exit(1);
  }

  const limit = Number(argValue('limit', '100'));
  const auditTable = argValue('audit-table', 'audit_logs')!;
  let failed = false;

  heading('Referential integrity');
  const ri = await verifyReferentialIntegrity(undefined, { limit });
  console.log(`relationships checked : ${ri.checked}`);
  console.log(`violations            : ${ri.violations.length}`);
  for (const v of ri.violations) {
    console.log(
      `  ! ${v.sourceTable}.${v.sourceColumn} -> ${v.targetTable}.${v.targetColumn}: ` +
        `${v.count} orphan(s), e.g. ${v.orphanedIds.slice(0, 3).join(', ')}`
    );
  }
  for (const e of ri.errors) console.log(`  ? could not check: ${e}`);
  if (!ri.clean) failed = true;

  heading('Tenant boundaries');
  const tb = await verifyTenantBoundaries();
  console.log(`checks run            : ${tb.checked}`);
  console.log(`violations            : ${tb.violations.length}`);
  for (const v of tb.violations) {
    console.log(
      `  ! ${v.table}.${v.foreignColumn} -> ${v.foreignTable}: ` +
        `cross-tenant rows ${v.crossTenantIds.slice(0, 3).join(', ')}`
    );
  }
  for (const e of tb.errors) console.log(`  ? could not check: ${e}`);
  if (!tb.clean) failed = true;

  heading(`Audit chain (${auditTable})`);
  const ac = await verifyAuditChainIntegrity({ tableName: auditTable, limit: 100_000 });
  console.log(`records total         : ${ac.totalRecords}`);
  console.log(`records walked        : ${ac.checkedRecords}`);
  console.log(`tampering detected    : ${ac.tamperingDetected}`);
  for (const g of ac.gaps.slice(0, 10)) {
    console.log(`  ! break at record ${g.id} (previous_hash=${g.previousHash ?? 'NULL'})`);
  }
  if (ac.gaps.length > 10) console.log(`  ... and ${ac.gaps.length - 10} more`);
  for (const e of ac.errors) console.log(`  ? could not check: ${e}`);
  if (ac.totalRecords > ac.checkedRecords) {
    console.log(
      `  note: only the first ${ac.checkedRecords} records were walked; ` +
        'raise --limit to cover the whole chain'
    );
  }
  if (!ac.clean) failed = true;

  console.log('');
  if (failed) {
    console.error('RESULT: problems found (or checks that could not be completed)');
    process.exit(1);
  }
  console.log('RESULT: clean');
}

main().catch((err: unknown) => {
  console.error('verify-data-integrity failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
