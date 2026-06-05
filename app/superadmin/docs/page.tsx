'use client';
import { useState } from 'react';
import { Book, Shield, Database, RefreshCw, AlertTriangle, ChevronDown, ChevronRight, FileText, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

const SECTIONS = [
  {
    id: 'persistence',
    label: '1. Data Persistence (Container Safety)',
    icon: Database,
    content: `PostgreSQL data lives in a Docker named volume — it survives docker compose down and docker compose restart.

## Safe Commands (data preserved)
- docker compose down → Stops containers, data safe
- docker compose restart → Restarts containers, data safe
- docker compose up -d → Starts/updates containers, data safe

## DANGEROUS Commands (will WIPE data)
- docker compose down -v → Removes volumes — DELETES ALL DATA
- docker volume rm pgdata → DELETES ALL DATA
- docker system prune -a --volumes → Prunes everything including volumes

> Never use -v or --volumes flags on production.`,
  },
  {
    id: 'backups',
    label: '2. Backups',
    icon: RefreshCw,
    content: `## Automated Backup
DATABASE_URL="postgresql://nucrm:YOUR_PASSWORD@localhost:5433/nucrm" npx tsx scripts/backup-db.ts

The script: runs pg_dump → uploads to S3 → cleans old backups (>30 days).

## Quick Manual Backup (no S3)
pg_dump "postgresql://nucrm:YOUR_PASSWORD@localhost:5433/nucrm" > backup-$(date +%Y-%m-%d).sql

## Cron (Automatic Daily)
0 2 * * * cd /path/to/nucrm && DATABASE_URL="..." npx tsx scripts/backup-db.ts`,
  },
  {
    id: 'restore',
    label: '3. Restore',
    icon: FileText,
    content: `## Full Restore
psql "postgresql://nucrm:YOUR_PASSWORD@localhost:5433/nucrm" < backup.sql

## Selective Restore (Table-Level)
The app has a selective restore UI at /superadmin/selective-restore backed by:
- lib/restore/backup-parser.ts — Parses SQL dump into individual statements
- lib/restore/backup-verifier.ts — Checks backup integrity before restore
- lib/restore/restore-executor.ts — Executes targeted restore operations`,
  },
  {
    id: 'migrations',
    label: '4. Migration Safety',
    icon: Shield,
    content: `## Safe Workflow
1. BACKUP FIRST: pg_dump "..." > pre-migration-backup.sql
2. npx tsx scripts/generate-migration.ts
3. npx tsx scripts/migration-status.ts
4. npx tsx scripts/migrate.ts
5. Rollback: npx tsx scripts/rollback-migration.ts

## Key Principles
- Drizzle generates additive migrations by default
- Dropping columns/tables requires explicit drop statements
- Always review generated SQL before applying
- Test on staging first`,
  },
  {
    id: 'pool',
    label: '5. Connection Pool Safety',
    icon: Database,
    content: `The app uses a connection pool (default: 5 connections).

DATABASE_POOL_SIZE=10   # Increase for higher traffic
DATABASE_SSL=false       # Set true for cloud PostgreSQL

Pool exhaustion causes "Connection terminated due to connection timeout".
Increase pool size if you see this error.`,
  },
  {
    id: 'recovery',
    label: '6. Disaster Recovery',
    icon: AlertTriangle,
    content: `## Container crash, data intact
docker compose down && docker compose up -d

## Data volume lost
1. docker compose down -v (removes volume)
2. docker compose up -d (fresh empty DB)
3. psql "postgresql://nucrm:..." < latest-backup.sql
4. npx tsx scripts/migrate.ts

## Failed migration
1. npx tsx scripts/rollback-migration.ts
2. If rollback fails, restore from pre-migration backup`,
  },
];

export default function DocsPage() {
  const [open, setOpen] = useState<string>('persistence');

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white flex items-center gap-2">
            <Book className="w-5 h-5 text-violet-400" />
            Database Security Guide
          </h1>
          <p className="text-xs text-white/30 mt-1">
            Backup/restore, migration safety, container persistence, disaster recovery
          </p>
        </div>
        <a
          href="/docs/database-security.md"
          target="_blank"
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/10 text-xs text-white/50 hover:text-white transition-colors"
        >
          <ExternalLink className="w-3 h-3" />
          Raw Markdown
        </a>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.02] divide-y divide-white/5">
        {SECTIONS.map((sec) => {
          const isOpen = open === sec.id;
          const Icon = sec.icon;
          return (
            <div key={sec.id}>
              <button
                onClick={() => setOpen(isOpen ? '' : sec.id)}
                className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-white/[0.02] transition-colors"
              >
                <Icon className="w-4 h-4 text-violet-400 shrink-0" />
                <span className="text-sm font-medium text-white/80 flex-1">{sec.label}</span>
                {isOpen ? (
                  <ChevronDown className="w-4 h-4 text-white/30" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-white/30" />
                )}
              </button>
              {isOpen && (
                <div className="px-5 pb-5">
                  <pre className="text-xs text-white/60 leading-relaxed whitespace-pre-wrap font-sans">
                    {sec.content}
                  </pre>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-400">Before any migration or schema change</p>
            <p className="text-xs text-white/40 mt-1">
              Always run <code className="text-amber-300">pg_dump</code> first. One command, two seconds, full insurance.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
