# Migration chain: current state and required repair

**Status: the migration chain cannot build the schema from an empty database.**

Verified empirically against PostgreSQL 16, not inferred. Reproduce with:

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/scratch npm run db:verify-chain
```

## Why nobody noticed

CI provisions its database with `npm run db:sync` (`drizzle-kit push`) directly
from the schema files — see `.github/workflows/ci.yml`, the "Sync database schema"
step. The migrations are therefore never executed by any automated process. The
3000+ passing tests say nothing about whether they work.

Production was almost certainly built the same way, which is why the application
runs fine on a schema its own migrations cannot reproduce.

Disaster recovery depends on rebuilding a schema. Right now that path is untested
and broken.

## Two overlapping lineages

`0037_flat_sir_ram` is not an incremental migration. It is a complete
`drizzle-kit` snapshot:

| Statement                        | Count |
| -------------------------------- | ----- |
| `CREATE TABLE`                   | 213   |
| `ALTER TABLE ... ADD CONSTRAINT` | 418   |
| `CREATE INDEX`                   | 544   |
| `CREATE UNIQUE INDEX`            | 33    |
| `CREATE VIEW`                    | 1     |

167 of those tables are also created by `0000_init`. The two files are separate
descriptions of the same schema at different points in time, and they were never
meant to be applied to the same database.

### What the journal does about it

`_journal.json` places `0037` at array position 2 — third, immediately after
`0001` and _before_ `0002`. That is not random: later migrations such as
`0023_ai_key_type_personal_system` reference tables (`ai_provider_secrets`) that
only `0037` creates, so it has to run early.

But running it early collides with `0000_init`:

```
  0 0000_init                    ok
  1 0001_perpetual_the_stranger  ok
  2 0037_flat_sir_ram            FAILED
      ERROR: relation "api_key_usage" already exists
Stopped at position 2; 31 of 34 migrations never ran.
```

### Why guards are not enough

Making `0037` idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD CONSTRAINT` wrapped
to tolerate `duplicate_object`) was attempted and moves the failure but does not
fix it:

```
  2 0037_flat_sir_ram  FAILED
      ERROR: column "invited_by" referenced in foreign key constraint does not exist
```

`0000_init` creates `invitations` with a different column set than `0037` expects.
`CREATE TABLE IF NOT EXISTS` skips the table, so the column never appears, and the
snapshot's foreign key has nothing to attach to. Column-level divergence between
the two lineages cannot be reconciled with statement guards — the attempt was
reverted rather than shipped, because it produces a chain that _looks_ fixed while
silently building an incomplete schema.

## The required repair: squash to a baseline

The only correct fix is to collapse the history:

1. Generate `0000_baseline.sql` from the schema files with `drizzle-kit generate`
   against an empty snapshot directory. The schema files are the authoritative
   definition, since `db:push` is what actually built the running databases.
2. Re-apply, in order after the baseline, the content `drizzle-kit` cannot
   generate. 14 migrations contain such content — functions, triggers, RLS
   policies and data backfills:
   `0005`, `0012`, `0015`, `0016`, `0020`, `0023`, `0033`, `0034`, `0035`,
   `0038`, `0039`, `0041_add_tenant_short_code`, `0043`, `0044`.
3. Archive `0000`–`0040` under `drizzle/migrations/_archive/`.
4. For every existing database, insert the baseline tag into
   `drizzle.__drizzle_migrations` so it is treated as already applied and is never
   replayed against live data.

**Step 4 is why this has not been done yet.** It requires knowing how each
environment was provisioned. Getting it wrong on a database that was built by
`push` — and therefore has no migration history at all — risks replaying
`0000_init` over live data. That needs confirmation of the production state before
proceeding, not a guess.

## Second defect: two runners, one of them orphaned

There are two migration runners with incompatible file formats.

| Runner                                     | Wired to                                     | Understands                                       |
| ------------------------------------------ | -------------------------------------------- | ------------------------------------------------- |
| `scripts/migrate.ts` (drizzle `migrate()`) | `db:migrate`, `db:auto`, `db:reset`, `setup` | `_journal.json`, `--> statement-breakpoint`       |
| `scripts/migration-runner.ts`              | **nothing — orphaned**                       | `-- Migration ID:`, `-- Dependencies:`, `-- DOWN` |

Consequences:

- **Journalled files must not contain `-- DOWN` sections.** Drizzle treats `-- DOWN`
  as an ordinary comment and executes everything after it as part of the forward
  migration. `0044`'s DOWN section drops `record_links` and every column the file
  just added, so journalling it as-is would create and immediately destroy its own
  work. Rollback SQL now lives in sibling `*.down.sql` files, which drizzle does
  not read.
- **Drizzle applies only tags listed in the journal.** `0041_add_form_views_count`,
  `0041_add_tenant_short_code`, `0043` and `0044` were absent from it, so they were
  never applied by any wired command. They have now been appended.
- `-- Dependencies:` headers are only meaningful to the orphaned runner. Several
  are already wrong: `0041_add_form_views_count` names
  `0040_add_migration_template`, which does not exist as a file.

**Decision needed: keep drizzle and delete `migration-runner.ts`, or wire the
custom runner up and stop using drizzle's.** Maintaining both guarantees further
drift.

## Third defect: numbering collision

`0041_add_form_views_count.sql` and `0041_add_tenant_short_code.sql` share a
prefix. Any tooling that sorts by prefix has undefined ordering between them.
Harmless today because they touch different tables.

## What this change does and does not do

Done:

- `scripts/verify-migration-chain.ts` + `npm run db:verify-chain`, so the breakage
  is measurable and regressions are catchable.
- Rollback SQL extracted to `*.down.sql`, so drizzle cannot misexecute it.
- The four unjournalled migrations appended to the journal, so they actually run.
- `idx` and `when` normalised to a coherent sequence. **Apply order is unchanged** —
  `0037` deliberately stays early, because later migrations depend on its tables.

Not done:

- The squash. Blocked on confirming production provisioning (above).
- Choosing a single migration runner.
- Adding `db:verify-chain` to CI, because it fails today and would make CI red for
  a pre-existing condition. It should be added in the same change that lands the
  baseline.
