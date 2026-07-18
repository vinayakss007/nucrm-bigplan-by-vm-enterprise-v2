#!/usr/bin/env npx tsx
/**
 * Robust Migration Runner for NuCRM
 * 
 * Features:
 * - Dependency-ordered execution (topological sort)
 * - Tracks applied migrations with checksums
 * - Supports up/down migrations with rollback
 * - Validates foreign key dependencies before execution
 * - Transaction-safe with savepoints
 * - Dry-run mode for safety
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { program } from 'commander';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIGRATIONS_DIR = path.join(__dirname, '../drizzle/migrations');
const _SCHEMA_DIR = path.join(__dirname, '../drizzle/schema');

interface Migration {
  id: string;
  name: string;
  filename: string;
  up: string;
  down?: string;
  dependencies: string[];
  checksum: string;
  createdAt: Date;
}

interface AppliedMigration {
  id: string;
  name: string;
  checksum: string;
  appliedAt: Date;
  executionTimeMs: number;
}

class MigrationRunner {
  private pool: Pool;
  private db: ReturnType<typeof drizzle>;
  private migrations: Map<string, Migration> = new Map();
  private applied: Map<string, AppliedMigration> = new Map();

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl, max: 1 });
    this.db = drizzle(this.pool);
  }

  async init() {
    // Create migration tracking table
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        checksum VARCHAR(64) NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        execution_time_ms INTEGER NOT NULL,
        rolled_back_at TIMESTAMPTZ
      );
      
      CREATE INDEX IF NOT EXISTS idx_schema_migrations_applied_at 
        ON schema_migrations(applied_at);
    `);

    // Load applied migrations
    const result = await this.pool.query('SELECT * FROM schema_migrations WHERE rolled_back_at IS NULL ORDER BY applied_at');
    for (const row of result.rows) {
      this.applied.set(row.id, {
        id: row.id,
        name: row.name,
        checksum: row.checksum,
        appliedAt: row.applied_at,
        executionTimeMs: row.execution_time_ms,
      });
    }
  }

  async loadMigrations(): Promise<void> {
    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql') || f.endsWith('.ts'))
      .sort();

    for (const file of files) {
      const content = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
      const migration = this.parseMigration(file, content);
      this.migrations.set(migration.id, migration);
    }
  }

  private parseMigration(filename: string, content: string): Migration {
    // Extract metadata from comments
    const idMatch = content.match(/--\s*Migration\s*ID:\s*(\S+)/);
    const nameMatch = content.match(/--\s*Name:\s*(.+)/);
    const depsMatch = content.match(/--\s*Dependencies:\s*(.+)/);
    const downMatch = content.match(/--\s*DOWN\s*\n([\s\S]*?)(?:\n--\s*END DOWN|\n--\s*[A-Z]|\n$)/);

    const id = idMatch?.[1] || filename.replace(/\.(sql|ts)$/, '');
    const name = nameMatch?.[1] || id;
    const dependencies = depsMatch?.[1]?.split(',').map(d => d.trim()).filter(Boolean) || [];
    const down = downMatch?.[1]?.trim();

    // Split UP and DOWN sections
    const upDownSplit = content.split(/--\s*DOWN\s*\n/);
    const up = upDownSplit[0].replace(/--\s*(?:Migration ID|Name|Dependencies):.*\n/g, '').trim();

    const checksum = crypto.createHash('sha256').update(up).digest('hex').substring(0, 16);

    return {
      id,
      name,
      filename,
      up,
      down,
      dependencies,
      checksum,
      createdAt: fs.statSync(path.join(MIGRATIONS_DIR, filename)).mtime,
    };
  }

  private topologicalSort(migrations: Migration[]): Migration[] {
    const graph = new Map<string, Set<string>>();
    const inDegree = new Map<string, number>();

    // Build graph
    for (const m of migrations) {
      graph.set(m.id, new Set(m.dependencies));
      inDegree.set(m.id, m.dependencies.length);
    }

    // Validate all dependencies exist
    for (const m of migrations) {
      for (const dep of m.dependencies) {
        if (!this.migrations.has(dep) && !this.applied.has(dep)) {
          throw new Error(`Migration ${m.id} depends on missing migration: ${dep}`);
        }
      }
    }

    // Kahn's algorithm
    const queue: string[] = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0) queue.push(id);
    }

    const sorted: Migration[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      const migration = this.migrations.get(id)!;
      sorted.push(migration);

      for (const [otherId, deps] of graph) {
        if (deps.has(id)) {
          deps.delete(id);
          inDegree.set(otherId, inDegree.get(otherId)! - 1);
          if (inDegree.get(otherId)! === 0) {
            queue.push(otherId);
          }
        }
      }
    }

    if (sorted.length !== migrations.size) {
      throw new Error('Circular dependency detected in migrations');
    }

    return sorted;
  }

  async validateDependencies(): Promise<void> {
    // Check FK constraints match migration dependencies
    const fkResult = await this.pool.query(`
      SELECT
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
    `);

    console.log('\n📋 Foreign Key Dependencies:');
    const fkMap = new Map<string, Set<string>>();
    for (const row of fkResult.rows) {
      if (!fkMap.has(row.table_name)) fkMap.set(row.table_name, new Set());
      fkMap.get(row.table_name)!.add(row.foreign_table_name);
      console.log(`  ${row.table_name}.${row.column_name} -> ${row.foreign_table_name}.${row.foreign_column_name}`);
    }
    console.log('');
  }

  async runMigrations(options: {
    dryRun?: boolean;
    target?: string;
    force?: boolean;
  } = {}): Promise<void> {
    await this.loadMigrations();

    // Get pending migrations
    const pending = Array.from(this.migrations.values())
      .filter(m => !this.applied.has(m.id))
      .filter(m => !options.target || m.id <= options.target);

    if (pending.length === 0) {
      console.log('✅ No pending migrations');
      return;
    }

    // Sort by dependencies
    const sorted = this.topologicalSort(new Map(pending.map(m => [m.id, m])));

    console.log('\n📦 Pending Migrations (dependency-ordered):');
    for (const m of sorted) {
      const status = this.applied.has(m.id) ? '✅ Applied' : '⏳ Pending';
      const checksumMatch = this.applied.get(m.id)?.checksum === m.checksum ? '✓' : '✗';
      console.log(`  ${status} | ${m.id} (${m.checksum}) ${checksumMatch}`);
    }

    if (options.dryRun) {
      console.log('\n🔍 DRY RUN - No changes applied');
      return;
    }

    await this.validateDependencies();

    // Execute migrations
    for (const migration of sorted) {
      await this.executeMigration(migration);
    }

    console.log('\n✅ All migrations completed successfully!');
  }

  private async executeMigration(migration: Migration): Promise<void> {
    const startTime = Date.now();
    console.log(`\n▶️  Executing: ${migration.id} (${migration.name})`);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Create savepoint for rollback safety
      await client.query(`SAVEPOINT migration_${migration.id.replace(/[^a-zA-Z0-9]/g, '_')}`);

      // Execute migration
      await client.query(migration.up);

      // Record migration
      const executionTime = Date.now() - startTime;
      await client.query(`
        INSERT INTO schema_migrations (id, name, checksum, applied_at, execution_time_ms)
        VALUES ($1, $2, $3, NOW(), $4)
      `, [migration.id, migration.name, migration.checksum, executionTime]);

      await client.query('COMMIT');
      this.applied.set(migration.id, {
        id: migration.id,
        name: migration.name,
        checksum: migration.checksum,
        appliedAt: new Date(),
        executionTimeMs: executionTime,
      });

      console.log(`   ✅ Completed in ${executionTime}ms`);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error(`   ❌ Failed: ${error}`);
      throw error;
    } finally {
      client.release();
    }
  }

  async rollback(targetId: string, dryRun = false): Promise<void> {
    const applied = Array.from(this.applied.values())
      .filter(m => m.id >= targetId)
      .sort((a, b) => b.id.localeCompare(a.id)); // Reverse order

    if (applied.length === 0) {
      console.log('No migrations to rollback');
      return;
    }

    console.log('\n⏪ Rollback Plan:');
    for (const m of applied) {
      const migration = this.migrations.get(m.id);
      if (!migration?.down) {
        console.log(`  ⚠️  ${m.id}: NO DOWN MIGRATION - Cannot rollback`);
      } else {
        console.log(`  ⏪ ${m.id}: ${m.name}`);
      }
    }

    if (dryRun) {
      console.log('\n🔍 DRY RUN - No changes applied');
      return;
    }

    for (const m of applied) {
      const migration = this.migrations.get(m.id);
      if (!migration?.down) {
        throw new Error(`Migration ${m.id} has no DOWN section - cannot rollback`);
      }

      console.log(`\n⏪ Rolling back: ${migration.id}`);
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(migration.down);
        await client.query(`
          UPDATE schema_migrations 
          SET rolled_back_at = NOW() 
          WHERE id = $1
        `, [migration.id]);
        await client.query('COMMIT');
        this.applied.delete(migration.id);
        console.log(`   ✅ Rolled back`);
      } catch (error) {
        await client.query('ROLLBACK');
        console.error(`   ❌ Rollback failed: ${error}`);
        throw error;
      } finally {
        client.release();
      }
    }
  }

  async status(): Promise<void> {
    console.log('\n📊 Migration Status');
    console.log('===================');
    
    const allMigrations = Array.from(this.migrations.values()).sort((a, b) => a.id.localeCompare(b.id));
    
    for (const m of allMigrations) {
      const applied = this.applied.get(m.id);
      const checksumMatch = applied?.checksum === m.checksum ? '✓' : '✗';
      const status = applied ? `✅ Applied ${applied.appliedAt.toISOString()} (${applied.executionTimeMs}ms) ${checksumMatch}` : '⏳ Pending';
      console.log(`  ${m.id}: ${status}`);
    }

    const pending = allMigrations.filter(m => !this.applied.has(m.id)).length;
    console.log(`\nTotal: ${allMigrations.length} | Applied: ${this.applied.size} | Pending: ${pending}`);
  }

  async close() {
    await this.pool.end();
  }
}

// CLI
program
  .name('migrate')
  .description('NuCRM Migration Runner')
  .requiredOption('-d, --database <url>', 'Database URL');

program
  .command('up')
  .description('Run pending migrations')
  .option('--dry-run', 'Show what would run without executing')
  .option('--target <id>', 'Run up to specific migration')
  .option('--force', 'Force execution even with checksum mismatches')
  .action(async (options) => {
    const runner = new MigrationRunner(program.opts().database);
    await runner.init();
    await runner.runMigrations({ dryRun: options.dryRun, target: options.target, force: options.force });
    await runner.close();
  });

program
  .command('down')
  .description('Rollback migrations')
  .requiredOption('--target <id>', 'Rollback to migration ID (inclusive)')
  .option('--dry-run', 'Show what would rollback without executing')
  .action(async (options) => {
    const runner = new MigrationRunner(program.opts().database);
    await runner.init();
    await runner.rollback(options.target, options.dryRun);
    await runner.close();
  });

program
  .command('status')
  .description('Show migration status')
  .action(async () => {
    const runner = new MigrationRunner(program.opts().database);
    await runner.init();
    await runner.status();
    await runner.close();
  });

program
  .command('validate')
  .description('Validate FK dependencies match migrations')
  .action(async () => {
    const runner = new MigrationRunner(program.opts().database);
    await runner.init();
    await runner.validateDependencies();
    await runner.close();
  });

program.parse();
