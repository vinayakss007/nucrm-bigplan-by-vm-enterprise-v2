/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Metadata shapes produced by the document-level readers (backup-parser/
 * metadata.ts), split out of lib/restore/backup-parser.ts under #422.
 * The statement-level types live with the parser that produces them
 * (`./sql-grammar`).
 */

export interface TenantInfo {
  tenant_id: string;
  tenant_name?: string;
  record_counts: Record<string, number>;
  total_records: number;
  tables: string[];
}

export interface BackupMetadata {
  file_size: number;
  file_hash: string;
  statement_count: number;
  /**
   * Lines that look like an INSERT but that parseInsertStatement could not
   * read. Every caller skips unparseable statements, so a non-zero value here
   * means rows in the backup will NOT be restored — it must never be ignored.
   */
  unparsed_statements: number;
  tables_found: string[];
  tenants_found: TenantInfo[];
  date_range?: { earliest: string | null; latest: string | null };
  parse_duration_ms: number;
}
