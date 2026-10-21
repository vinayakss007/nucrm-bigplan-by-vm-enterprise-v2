/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Selective Tenant Restore - Backup Parser Utility (public surface).
 *
 * Parses .sql and .sql.gz backup files to:
 * 1. Extract INSERT statements
 * 2. Identify tenant_id for each row
 * 3. Group records by tenant and table
 * 4. Generate tenant-specific SQL for selective restore
 *
 * #422: this file was 828 lines, over the 500-line ceiling enforced by
 * `scripts/check-file-size.mjs`. The implementation now lives in the
 * same-named directory (`lib/restore/backup-parser/`), split by concern:
 *
 *   - `types.ts`         — TenantInfo / BackupMetadata shapes
 *   - `tenant-tables.ts` — TENANT_SCOPED_TABLES, kept uncentralised on
 *                          purpose (pinned by tenant-junction-scoping)
 *   - `file-io.ts`       — hashing + gzip/plain read streams
 *   - `sql-grammar.ts`   — single-line INSERT parsing and value extraction
 *   - `metadata.ts`      — whole-file passes (parseBackupFile, the unparsed
 *                          counter, validateBackupFile)
 *   - `extract.ts`       — tenant SQL extraction, upsert conversion, size
 *                          formatting
 *
 * This module is a barrel: every importer (`lib/restore/backup-verifier.ts`,
 * `lib/restore/restore-executor.ts`, the restore API routes, the unit tests)
 * keeps importing from `@/lib/restore/backup-parser` with an unchanged
 * surface. TS/Node resolution picks the file over the same-named directory,
 * so `./backup-parser` keeps pointing here — the same precedent as
 * `lib/api/schemas.ts` + `lib/api/schemas/`.
 */
export type { TenantInfo, BackupMetadata } from './backup-parser/types';
export { TENANT_SCOPED_TABLES } from './backup-parser/tenant-tables';
export type { ParsedStatement, ParsedInsertRows } from './backup-parser/sql-grammar';
export {
  TABLE_REFERENCE_PATTERN,
  buildInsertIntoRegex,
  unquoteIdentifier,
  looksLikeInsertStatement,
  parseTableReference,
  parseInsertRows,
  parseInsertStatement,
} from './backup-parser/sql-grammar';
export { calculateFileHash } from './backup-parser/file-io';
export {
  parseBackupFile,
  countUnparsedInsertStatements,
  validateBackupFile,
} from './backup-parser/metadata';
export {
  extractTenantSQL,
  convertToUpsert,
  formatFileSize,
} from './backup-parser/extract';
