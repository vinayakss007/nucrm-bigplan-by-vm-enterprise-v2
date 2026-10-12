# Migration chain: current state and required repair

> **Re-measured (2026-10-10, at main = 90955843) — the 2026-10-03 correction below is
> now itself partly historical, and it is worth being precise about which parts.** Both
> defects it names are repaired:
>
> - `0059_custom_entities` and `0091_usage_snapshots_superadmin_bypass` **are** journalled
>   (tags present in `drizzle/migrations/meta/_journal.json`, each with its `.sql` and
>   `.down.sql` on disk).
> - the "duplicated `idx`/`when` pair" is gone — all 126 entries carry a distinct `idx`
>   (a contiguous 0..125) and a distinct `when`, checked by reading the manifest rather
>   than by trusting a green guard.
> - `npm run guard:chain` agrees and its baseline is empty — verbatim:
>   `126 up-file(s) · 126 journal entries · 0 defect(s), 0 baselined`. "the current
>   defects are baselined until #74 repairs them" is therefore finished work: 0 baselined
>   means nothing is being excused.
>
> The journal count moved twice inside one day while this note was being written: #2518
> added `0125_declared_not_null_columns` (register PP-067), so 125 became 126. Read the
> numbers above as "at 90955843", not as "at the time this document was last touched".
>
> What is NOT repaired, and the part a reader must not take away from this block: the two
> runners still disagree. `db:verify-chain` remains red — its own header at
> `scripts/verify-migration-chain.ts:19-20` still says `KNOWN TO FAIL TODAY`. Two cautions
> about that reason, both measured at 90955843:
>
> - the comment names the wrong file. It says `0000_init` and `0037_flat_sir_ram` are the
>   two overlapping lineages; **no `0037_flat_sir_ram` exists in the tree** (`git ls-files`
>   finds sir_ram only at `0002_flat_sir_ram`, journalled at idx 2 with 74 `CREATE TABLE`,
>   while `0037` today is `0037_tenant_isolation_hardening`). The collision is real and the
>   fix recorded below still stands — the snapshot lineage is simply `0002`, not `0037`.
> - `KNOWN TO FAIL TODAY` is a comment, not a result. The last empirical fresh-DB run is
>   the 2026-08-29 pair in the table below. Re-running `db:verify-chain` needs a scratch
>   database, and this session does not point a migration runner at any live or shared
>   database to force an answer, so the verdict is **restated from the record, not
>   re-measured today**.
>
> Every count in this document that was measured against a manifest (105 migrations, 2668
> statements, 224 tables) is a **2026-08-29** reading of a 105-entry journal. The journal
> has 126 entries today, so those numbers describe a smaller schema, and the PASS/FAIL
> verdicts in the table below have not been re-run since. Treat the verdicts as
> unverified-for-current, not as today's measurement. The live database's own position is
> recorded in the register, not re-measured here: PP-067 states that adding `0125` left
> **27** entries outstanding on a 126-entry journal (PP-060 counted 24, #2444 counted 26),
> and reading it needs `DATABASE_URL`, which this note does not run.
>
> One gap the green guard does **not** cover, found while re-measuring: down-path coverage
> is unpoliced. `scripts/check-migration-chain.mjs:47` filters to `.sql` files that are
> _not_ `.down.sql`, so it compares up-files against the journal and never looks at the
> rollbacks. Measured by hand at 90955843: 126 up-files, **125** `.down.sql` —
> `0036_backup_records_checksum.sql` has no down path, which means a `db:migrate` forward
> is not reversible past 0036 on the statement runner. That is a separate finding from the
> chain repair and is recorded here rather than fixed, because adding a down migration is a
> new file an owner should see first.
>
> A second gap of the same family, merged into the journal while this note was open, is
> worth recording here because it changes what "the chain works" would even mean:
> `0071_schema_drift_backfill.sql` re-created four tables with NOT NULLs it needed, as
> `CREATE TABLE IF NOT EXISTS`. On any database that applies the chain in order `0059`
> already created those names, so the statement parses, discards itself and its column list
> **never executes** — `npm run db:bootstrap` therefore built six columns nullable that
> `drizzle/schema` declares NOT NULL. PP-067 and #2518 (migration `0125`) are that repair,
> and its register entry records that the first draft reproduced PP-058 by copying the
> `app.is_super_admin` GUC, which none of the three `tenant_isolation` policies on those
> tables branch on (measured there as `UPDATE 0` then `23502`). The lesson for this
> document: a fresh-DB run that _completes without error_ is not the same as a run that
> builds the declared schema, so re-cutting the two lineages is necessary but not
> sufficient, and `db:verify-chain`'s "does it apply" question should be paired with a
> schema-equality screen when it is re-run. That claim is the register's measurement, not
> this session's.
>
> Nothing in this correction block is deleted from the note below; the 2026-10-03 text is
> left exactly as it was written so the sequence of readings stays auditable.
> Cross-reference: `docs/planning/RELEASE-1.0-SCOPE-LAYERS.txt` item **2.8** carries the
> same re-measurement for the 1.0 release decision (its journal half is closed, its gate
> half is not); that item's 2026-10-10 pass ran at `152533ed`, when the journal held 125
> entries, and a follow-up line updates it to 126.

> **Correction (2026-10-03).** Every count below is measured against the
> _manifest_, not the directory: `scripts/migrate.ts` and drizzle's
> `readMigrationFiles()` both loop `journal.entries`, so a `.sql` file that is
> absent from `_journal.json` is invisible to both and can never be applied —
> not to a live database, not to a DR rebuild. As of today the journal is
> missing `0059_custom_entities` and `0091_usage_snapshots_superadmin_bypass`
> and carries a duplicated `idx`/`when` pair, so "PASS — applies all 105
> migrations" means _all 105 that the journal lists_ (107 up-migration files exist on disk; the
> difference is exactly the two unjournaled files above). `npm run guard:chain`
> (`scripts/check-migration-chain.mjs`) now fails CI on any new omission;
> the current defects are baselined until #74 repairs them.

**Status (updated 2026-08-29): the production runner `npm run db:migrate` DOES
build a full schema from an empty database. Drizzle's native `migrate()` path
(`npm run db:verify-chain`) still cannot — the two lineages collide there.**

There are two runners with different failure behaviour on a fresh database.
Both were re-verified empirically against PostgreSQL 15 on 2026-08-29 (preprod now runs 18.6; that verification predates the upgrade):

| Command                   | Runner                                                                    | Fresh-DB result                                                                     |
| ------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `npm run db:migrate`      | `scripts/migrate.ts` (statement-by-statement, tolerates `already exists`) | **PASS** — applies all 105 migrations, 2668 statements, 0 errors, 224 tables        |
| `npm run db:verify-chain` | drizzle `migrate()` (one tx per file, no tolerance)                       | **FAIL** — stops at `0003_billing_migration`: `relation "contracts" already exists` |

`db:migrate` is the path `.env.example`, `setup`, and disaster recovery use, so
**the DR "empty → current schema" path works today** (contrary to the earlier
version of this note). The squash below is still worth doing to make the chain
clean enough that drizzle's own verifier passes too, but it is no longer a DR
blocker.

Reproduce the drizzle-native failure with:

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/scratch npm run db:verify-chain
```

Reproduce the working path with:

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/scratch npm run db:migrate -- --yes
```

## Why nobody noticed

CI provisions its database with `npm run db:sync` (`drizzle-kit push`) directly
from the schema files — see `.github/workflows/ci.yml`, the "Sync database schema"
step. The migrations are therefore never executed by any automated process. The
3000+ passing tests say nothing about whether they work.

That last sentence is no longer true, and #2450 is why it stopped being true:
`db:sync` leaves 0 RLS policies and 0 journal-written functions, so a schema
built that way is not the product, and `db:migrate` now refuses to stamp it.
The `fresh-install` CI job runs `scripts/check-fresh-install-sequence.mts`, which
replays the whole journal into an empty database with `npm run db:bootstrap` and
fails if the catalog does not measure up (≥200 policies, ≥200 RLS-enabled tables,
ledger = journal, no promised object missing).

Production was almost certainly built the same way. The application also runs
fine on a schema rebuilt from scratch by `db:migrate` — that runner's
error-tolerant fresh path absorbs the lineage overlap that breaks drizzle's
native verifier (see the runner table at the top).

Disaster recovery depends on rebuilding a schema. Via `db:migrate` that path is
now verified working (2026-08-29); via drizzle's native `migrate()` it is not.
The squash below removes the discrepancy so both runners agree.

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
