/**
 * Migration Safety Layer
 *
 * Provides safe migration execution with:
 * - Pre-flight checks (connectivity, schema version, advisory lock)
 * - Post-flight verification (expected tables/columns exist)
 * - Advisory lock to prevent concurrent migrations
 * - Automatic backup trigger before migration
 */

import { getPool } from '@/lib/db/pool';
import type { Pool, PoolClient } from 'pg';

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------

export interface MigrationPreflightResult {
  databaseReachable: boolean;
  currentVersion: string | null;
  migrationLockFree: boolean;
  errors: string[];
}

export interface MigrationPostflightResult {
  success: boolean;
  missingTables: string[];
  missingColumns: { table: string; column: string }[];
  newVersion: string | null;
}

export interface MigrationLockOptions {
  /** Advisory lock key (default: 999999) */
  lockKey?: number;
  /** Timeout to acquire the lock in ms (default: 10000) */
  lockTimeoutMs?: number;
}

export interface ExpectedSchema {
  tables?: string[];
  columns?: { table: string; column: string }[];
}

export interface BackupTrigger {
  /** Call to trigger a backup before migration */
  triggerBackup: () => Promise<boolean>;
}

// -------------------------------------------------------------------
// Advisory lock key
// -------------------------------------------------------------------

const DEFAULT_ADVISORY_LOCK_KEY = 999999;

// -------------------------------------------------------------------
// Pre-flight checks
// -------------------------------------------------------------------

/**
 * Run pre-flight checks before executing a migration.
 */
export async function preflightChecks(
  options: MigrationLockOptions = {}
): Promise<MigrationPreflightResult> {
  const { lockKey = DEFAULT_ADVISORY_LOCK_KEY } = options;
  const result: MigrationPreflightResult = {
    databaseReachable: false,
    currentVersion: null,
    migrationLockFree: false,
    errors: [],
  };

  let pool: Pool;
  try {
    pool = getPool();
  } catch (err) {
    result.errors.push(`Failed to get pool: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  // 1. Check connectivity
  try {
    await pool.query('SELECT 1');
    result.databaseReachable = true;
  } catch (err) {
    result.errors.push(
      `Database unreachable: ${err instanceof Error ? err.message : String(err)}`
    );
    return result;
  }

  // 2. Check current schema version (drizzle uses __drizzle_migrations table)
  try {
    const versionResult = await pool.query(
      `SELECT MAX(id) as version FROM "__drizzle_migrations"`
    );
    result.currentVersion = versionResult.rows[0]?.version
      ? String(versionResult.rows[0].version)
      : '0';
  } catch {
    // Table may not exist on fresh databases
    result.currentVersion = null;
  }

  // 3. Check that no other migration is running (advisory lock check)
  try {
    const lockCheck = await pool.query(
      `SELECT pg_try_advisory_lock($1) AS acquired`,
      [lockKey]
    );
    const acquired = lockCheck.rows[0]?.acquired === true;
    if (acquired) {
      // Release immediately, we just wanted to check
      await pool.query(`SELECT pg_advisory_unlock($1)`, [lockKey]);
      result.migrationLockFree = true;
    } else {
      result.migrationLockFree = false;
      result.errors.push('Another migration is currently running (advisory lock held)');
    }
  } catch (err) {
    result.errors.push(
      `Failed to check migration lock: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  return result;
}

// -------------------------------------------------------------------
// Post-flight verification
// -------------------------------------------------------------------

/**
 * Verify expected tables and columns exist after a migration.
 */
export async function postflightVerification(
  expected: ExpectedSchema
): Promise<MigrationPostflightResult> {
  const result: MigrationPostflightResult = {
    success: true,
    missingTables: [],
    missingColumns: [],
    newVersion: null,
  };

  const pool: Pool = getPool();

  // Check tables
  if (expected.tables && expected.tables.length > 0) {
    const tableResult = await pool.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1)`,
      [expected.tables]
    );
    const existingTables = new Set(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tableResult.rows.map((r: any) => r.tablename as string)
    );
    for (const t of expected.tables) {
      if (!existingTables.has(t)) {
        result.missingTables.push(t);
        result.success = false;
      }
    }
  }

  // Check columns
  if (expected.columns && expected.columns.length > 0) {
    for (const col of expected.columns) {
      const colResult = await pool.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
        [col.table, col.column]
      );
      if (colResult.rowCount === 0) {
        result.missingColumns.push(col);
        result.success = false;
      }
    }
  }

  // Get new version
  try {
    const versionResult = await pool.query(
      `SELECT MAX(id) as version FROM "__drizzle_migrations"`
    );
    result.newVersion = versionResult.rows[0]?.version
      ? String(versionResult.rows[0].version)
      : null;
  } catch {
    result.newVersion = null;
  }

  return result;
}

// -------------------------------------------------------------------
// Advisory lock wrapper
// -------------------------------------------------------------------

/**
 * Execute a function while holding a PostgreSQL advisory lock.
 * Prevents concurrent migration execution.
 */
export async function withMigrationLock<T>(
  fn: (client: PoolClient) => Promise<T>,
  options: MigrationLockOptions = {}
): Promise<T> {
  const { lockKey = DEFAULT_ADVISORY_LOCK_KEY, lockTimeoutMs = 10_000 } = options;

  const pool: Pool = getPool();
  const client = await pool.connect();

  try {
    // Set a lock timeout to avoid indefinite blocking
    await client.query(`SET lock_timeout = '${lockTimeoutMs}ms'`);

    // Acquire session-level advisory lock (blocks until acquired or timeout)
    const lockResult = await client.query(`SELECT pg_advisory_lock($1)`, [lockKey]);
    if (!lockResult) {
      throw new Error('Failed to acquire migration advisory lock');
    }

    console.log('[MigrationSafety] Advisory lock acquired. Running migration...');

    const result = await fn(client);

    // Release the advisory lock
    await client.query(`SELECT pg_advisory_unlock($1)`, [lockKey]);
    console.log('[MigrationSafety] Advisory lock released. Migration complete.');

    return result;
  } catch (err) {
    // Best-effort release
    try {
      await client.query(`SELECT pg_advisory_unlock($1)`, [lockKey]);
    } catch {
      /* lock may not have been acquired */
    }
    throw err;
  } finally {
    client.release();
  }
}

// -------------------------------------------------------------------
// Safe migration runner
// -------------------------------------------------------------------

/**
 * Run a migration with full safety:
 * 1. Optional backup trigger
 * 2. Pre-flight checks
 * 3. Acquire advisory lock
 * 4. Execute migration
 * 5. Post-flight verification
 */
export async function runSafeMigration(
  migrationFn: (client: PoolClient) => Promise<void>,
  expected: ExpectedSchema = {},
  backup?: BackupTrigger,
  lockOptions: MigrationLockOptions = {}
): Promise<{ preflight: MigrationPreflightResult; postflight: MigrationPostflightResult }> {
  // Pre-flight
  const preflight = await preflightChecks(lockOptions);
  if (preflight.errors.length > 0) {
    throw new Error(`Migration pre-flight failed: ${preflight.errors.join('; ')}`);
  }

  // Trigger backup if configured
  if (backup) {
    console.log('[MigrationSafety] Triggering pre-migration backup...');
    const backupSuccess = await backup.triggerBackup();
    if (!backupSuccess) {
      throw new Error('Pre-migration backup failed. Aborting migration.');
    }
    console.log('[MigrationSafety] Pre-migration backup completed.');
  }

  // Run migration under advisory lock
  await withMigrationLock(async (client) => {
    await migrationFn(client);
  }, lockOptions);

  // Post-flight
  const postflight = await postflightVerification(expected);
  if (!postflight.success) {
    console.error('[MigrationSafety] Post-flight verification FAILED:', {
      missingTables: postflight.missingTables,
      missingColumns: postflight.missingColumns,
    });
  }

  return { preflight, postflight };
}
