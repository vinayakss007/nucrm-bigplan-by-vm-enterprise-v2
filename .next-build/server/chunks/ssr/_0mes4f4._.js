module.exports=[104720,a=>{"use strict";let b=(0,a.i(883706).default)("file-text",[["path",{d:"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",key:"1rqfz7"}],["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}],["path",{d:"M10 9H8",key:"b1mrlr"}],["path",{d:"M16 13H8",key:"t4e002"}],["path",{d:"M16 17H8",key:"z1uh3a"}]]);a.s(["FileText",0,b],104720)},50522,a=>{"use strict";let b=(0,a.i(883706).default)("chevron-right",[["path",{d:"m9 18 6-6-6-6",key:"mthhwq"}]]);a.s(["ChevronRight",0,b],50522)},452495,a=>{"use strict";let b=(0,a.i(883706).default)("external-link",[["path",{d:"M15 3h6v6",key:"1q9fwt"}],["path",{d:"M10 14 21 3",key:"gplh6r"}],["path",{d:"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",key:"a6xqqp"}]]);a.s(["ExternalLink",0,b],452495)},916881,a=>{"use strict";var b=a.i(187924),c=a.i(572131),d=a.i(254115),e=a.i(603314),f=a.i(220494),g=a.i(669520),h=a.i(73570),i=a.i(405784),j=a.i(50522),k=a.i(104720),l=a.i(452495);let m=[{id:"persistence",label:"1. Data Persistence (Container Safety)",icon:f.Database,content:`PostgreSQL data lives in a Docker named volume — it survives docker compose down and docker compose restart.

## Safe Commands (data preserved)
- docker compose down → Stops containers, data safe
- docker compose restart → Restarts containers, data safe
- docker compose up -d → Starts/updates containers, data safe

## DANGEROUS Commands (will WIPE data)
- docker compose down -v → Removes volumes — DELETES ALL DATA
- docker volume rm pgdata → DELETES ALL DATA
- docker system prune -a --volumes → Prunes everything including volumes

> Never use -v or --volumes flags on production.`},{id:"backups",label:"2. Backups",icon:g.RefreshCw,content:`## Automated Backup
DATABASE_URL="postgresql://nucrm:YOUR_PASSWORD@localhost:5433/nucrm" npx tsx scripts/backup-db.ts

The script: runs pg_dump → uploads to S3 → cleans old backups (>30 days).

## Quick Manual Backup (no S3)
pg_dump "postgresql://nucrm:YOUR_PASSWORD@localhost:5433/nucrm" > backup-$(date +%Y-%m-%d).sql

## Cron (Automatic Daily)
0 2 * * * cd /path/to/nucrm && DATABASE_URL="..." npx tsx scripts/backup-db.ts`},{id:"restore",label:"3. Restore",icon:k.FileText,content:`## Full Restore
psql "postgresql://nucrm:YOUR_PASSWORD@localhost:5433/nucrm" < backup.sql

## Selective Restore (Table-Level)
The app has a selective restore UI at /superadmin/selective-restore backed by:
- lib/restore/backup-parser.ts — Parses SQL dump into individual statements
- lib/restore/backup-verifier.ts — Checks backup integrity before restore
- lib/restore/restore-executor.ts — Executes targeted restore operations`},{id:"migrations",label:"4. Migration Safety",icon:e.Shield,content:`## Safe Workflow
1. BACKUP FIRST: pg_dump "..." > pre-migration-backup.sql
2. npx tsx scripts/generate-migration.ts
3. npx tsx scripts/migration-status.ts
4. npx tsx scripts/migrate.ts
5. Rollback: npx tsx scripts/rollback-migration.ts

## Key Principles
- Drizzle generates additive migrations by default
- Dropping columns/tables requires explicit drop statements
- Always review generated SQL before applying
- Test on staging first`},{id:"pool",label:"5. Connection Pool Safety",icon:f.Database,content:`The app uses a connection pool (default: 5 connections).

DATABASE_POOL_SIZE=10   # Increase for higher traffic
DATABASE_SSL=false       # Set true for cloud PostgreSQL

Pool exhaustion causes "Connection terminated due to connection timeout".
Increase pool size if you see this error.`},{id:"recovery",label:"6. Disaster Recovery",icon:h.AlertTriangle,content:`## Container crash, data intact
docker compose down && docker compose up -d

## Data volume lost
1. docker compose down -v (removes volume)
2. docker compose up -d (fresh empty DB)
3. psql "postgresql://nucrm:..." < latest-backup.sql
4. npx tsx scripts/migrate.ts

## Failed migration
1. npx tsx scripts/rollback-migration.ts
2. If rollback fails, restore from pre-migration backup`}];a.s(["default",0,function(){let[a,e]=(0,c.useState)("persistence");return(0,b.jsxs)("div",{className:"space-y-5 max-w-4xl",children:[(0,b.jsxs)("div",{className:"flex items-center justify-between",children:[(0,b.jsxs)("div",{children:[(0,b.jsxs)("h1",{className:"text-lg font-bold text-white flex items-center gap-2",children:[(0,b.jsx)(d.Book,{className:"w-5 h-5 text-violet-400"}),"Database Security Guide"]}),(0,b.jsx)("p",{className:"text-xs text-white/30 mt-1",children:"Backup/restore, migration safety, container persistence, disaster recovery"})]}),(0,b.jsxs)("a",{href:"/docs/database-security.md",target:"_blank",className:"flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/10 text-xs text-white/50 hover:text-white transition-colors",children:[(0,b.jsx)(l.ExternalLink,{className:"w-3 h-3"}),"Raw Markdown"]})]}),(0,b.jsx)("div",{className:"rounded-xl border border-white/10 bg-white/[0.02] divide-y divide-white/5",children:m.map(c=>{let d=a===c.id,f=c.icon;return(0,b.jsxs)("div",{children:[(0,b.jsxs)("button",{onClick:()=>e(d?"":c.id),className:"w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-white/[0.02] transition-colors",children:[(0,b.jsx)(f,{className:"w-4 h-4 text-violet-400 shrink-0"}),(0,b.jsx)("span",{className:"text-sm font-medium text-white/80 flex-1",children:c.label}),d?(0,b.jsx)(i.ChevronDown,{className:"w-4 h-4 text-white/30"}):(0,b.jsx)(j.ChevronRight,{className:"w-4 h-4 text-white/30"})]}),d&&(0,b.jsx)("div",{className:"px-5 pb-5",children:(0,b.jsx)("pre",{className:"text-xs text-white/60 leading-relaxed whitespace-pre-wrap font-sans",children:c.content})})]},c.id)})}),(0,b.jsx)("div",{className:"rounded-xl border border-amber-500/20 bg-amber-500/5 p-4",children:(0,b.jsxs)("div",{className:"flex items-start gap-3",children:[(0,b.jsx)(h.AlertTriangle,{className:"w-4 h-4 text-amber-400 shrink-0 mt-0.5"}),(0,b.jsxs)("div",{children:[(0,b.jsx)("p",{className:"text-sm font-medium text-amber-400",children:"Before any migration or schema change"}),(0,b.jsxs)("p",{className:"text-xs text-white/40 mt-1",children:["Always run ",(0,b.jsx)("code",{className:"text-amber-300",children:"pg_dump"})," first. One command, two seconds, full insurance."]})]})]})})]})}])}];

//# sourceMappingURL=_0mes4f4._.js.map