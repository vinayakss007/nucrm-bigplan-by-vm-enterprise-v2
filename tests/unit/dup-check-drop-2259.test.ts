import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * #2259 (second half) — the duplicate-CHECK finding that 0113 (FKs) did not
 * cover. Exactly three columns carried two enum CHECKs over the same value set
 * at head (measured on a fresh replay of 0001..0118 with
 * `pg_constraint`/`cardinality(conkey)=1` grouped by (table, column) for the
 * `CHECK (col = ANY (ARRAY[…]))` shape):
 *
 *   tasks.priority     chk_tasks_priority      (0050)  ||  chk_tasks_priority_valid (0045)
 *   tasks.status       chk_tasks_status        (0050)  ||  chk_tasks_status_valid   (0045)
 *   team_members.role  chk_team_members_role   (0050)  ||  team_members_role_valid  (0041)
 *
 * `0119_dedupe_check_constraints.sql` drops the 0050 restatement in each group,
 * keeps the first declaration, and renames the one survivor that predates the
 * `chk_<table>_<column>_valid` convention. Verified live: duplicate enum-CHECK
 * groups 3 -> 0 after migrate, back to 3 after `rollback-migration.ts
 * 0119_dedupe_check_constraints --yes`, and 0 again on re-apply.
 *
 * What these tests pin:
 *  1. the drop set is EXACTLY those three names, each `IF EXISTS` (live deploys
 *     lag migrations — #2299/#2233 — so a half-applied host is normal);
 *  2. for every dropped name the surviving constraint enforces the SAME value
 *     set, read out of the migrations that created them. That is the whole
 *     safety argument: identical sets ⇒ no write can newly fail or newly pass,
 *     so this is metadata-only. If someone widens one twin and not the other,
 *     this test fails instead of a production insert throwing 23514.
 *  3. the journal wiring (registered, idx = array position, `when` strictly
 *     increasing, up + down on disk) — an unregistered .sql file looks perfectly
 *     merged and never runs (#43/#46);
 *  4. the down file reverses precisely this change (rename back + re-add the
 *     same three names, each guarded);
 *  5. `scripts/constraint-vocab.json` names none of the six constraints, so
 *     `npm run guard:vocab` cannot start depending on a constraint this
 *     migration removes.
 */

const ROOT = join(import.meta.dirname!, "..", "..");
const TAG = "0119_dedupe_check_constraints";
const UP = join(ROOT, "drizzle/migrations", `${TAG}.sql`);
const DOWN = join(ROOT, "drizzle/migrations", `${TAG}.down.sql`);
const JOURNAL = join(ROOT, "drizzle/migrations/meta/_journal.json");

/** dropped -> { survivor, created by } */
const GROUPS: Array<{
  table: string;
  column: string;
  drop: string;
  keep: string;
  keepFile: string;
  dropFile: string;
}> = [
  {
    table: "tasks",
    column: "status",
    drop: "chk_tasks_status",
    keep: "chk_tasks_status_valid",
    keepFile: "0045_check_constraints.sql",
    dropFile: "0050_data_validation_checks.sql",
  },
  {
    table: "tasks",
    column: "priority",
    drop: "chk_tasks_priority",
    keep: "chk_tasks_priority_valid",
    keepFile: "0045_check_constraints.sql",
    dropFile: "0050_data_validation_checks.sql",
  },
  {
    table: "team_members",
    column: "role",
    drop: "chk_team_members_role",
    keep: "team_members_role_valid",
    keepFile: "0041_teams.sql",
    dropFile: "0050_data_validation_checks.sql",
  },
];
const DROPPED = GROUPS.map((g) => g.drop);
/** the name the survivor carries AFTER 0119 (team_members is renamed) */
const SURVIVOR_AFTER: Record<string, string> = {
  "tasks.status": "chk_tasks_status_valid",
  "tasks.priority": "chk_tasks_priority_valid",
  "team_members.role": "chk_team_members_role_valid",
};

const UP_SQL = readFileSync(UP, "utf8");
const DOWN_SQL = readFileSync(DOWN, "utf8");
const JOURNAL_DATA = JSON.parse(readFileSync(JOURNAL, "utf8")) as {
  entries: Array<{
    idx: number;
    when: number;
    tag: string;
    breakpoints?: boolean;
  }>;
};

/** statements as the drizzle migrator sees them (breakpoint-split, comments out) */
function statements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((s) =>
      s
        .split("\n")
        .filter(
          (l) =>
            l.trim() !== "" &&
            !(
              l.trim().startsWith("--") &&
              l.trim() !== "--> statement-breakpoint"
            ) &&
            !/^\s*(\/\*|\*\/|\*)/.test(l),
        )
        .join("\n")
        .trim(),
    )
    .filter((s) => s.length > 0);
}

function checkValuesOf(constraintName: string, file: string): string[] {
  const sql = readFileSync(join(ROOT, "drizzle/migrations", file), "utf8");
  const m = sql.match(
    new RegExp(
      `CONSTRAINT +"?${constraintName}"?\\s+CHECK\\s*\\(([^)]*)\\)`,
      "i",
    ),
  );
  if (!m)
    throw new Error(`${constraintName} CHECK definition not found in ${file}`);
  return valuesOf(m[1]);
}

function valuesOf(checkBody: string): string[] {
  return [...checkBody.matchAll(/'([^']+)'/g)].map((v) => v[1]).sort();
}

describe("Duplicate enum CHECK dedupe (Issue #2259, migration 0119)", () => {
  it("up file exists with its down partner and drops exactly the three restated checks", () => {
    expect(existsSync(UP)).toBe(true);
    expect(existsSync(DOWN)).toBe(true);
    const drops = [
      ...UP_SQL.matchAll(
        /ALTER TABLE "(\w+)" DROP CONSTRAINT IF EXISTS "(\w+)";/g,
      ),
    ];
    expect(drops.map((d) => d[2]).sort()).toEqual([...DROPPED].sort());
    for (const g of GROUPS) {
      expect(
        drops.find((d) => d[2] === g.drop)?.[1],
        `drop target table for ${g.drop}`,
      ).toBe(g.table);
    }
    // every DROP is IF EXISTS — a host where it already ran must not abort
    expect([...UP_SQL.matchAll(/DROP CONSTRAINT(?! IF EXISTS)/g)]).toEqual([]);
  });

  it("up file contains nothing but the three drops and one guarded rename", () => {
    const stmts = statements(UP_SQL);
    expect(stmts).toHaveLength(4);
    expect(
      stmts
        .slice(0, 3)
        .every((s) =>
          /^ALTER TABLE "\w+" DROP CONSTRAINT IF EXISTS "\w+";$/.test(s),
        ),
    ).toBe(true);
    const rename = stmts[3];
    expect(rename).toContain(
      "ALTER TABLE team_members RENAME CONSTRAINT team_members_role_valid TO chk_team_members_role_valid;",
    );
    expect(rename).toContain("DO $$ BEGIN");
    // guarded both ways so a rerun is a no-op, in either half-applied direction
    expect(rename).toMatch(
      /EXISTS \(SELECT 1 FROM pg_constraint WHERE conrelid = 'team_members'::regclass AND conname = 'team_members_role_valid'\)/,
    );
    expect(rename).toMatch(
      /NOT EXISTS \(SELECT 1 FROM pg_constraint WHERE conrelid = 'team_members'::regclass AND conname = 'chk_team_members_role_valid'\)/,
    );
    // no other object class is touched: this migration is constraints only
    expect(UP_SQL).not.toMatch(
      /\bCREATE\b|\bDROP TABLE\b|\bDROP INDEX\b|\bALTER COLUMN\b|\bTRUNCATE\b|\bDELETE FROM\b/i,
    );
  });

  it("each dropped check enforces the same value set as the survivor it duplicates", () => {
    for (const g of GROUPS) {
      const dropped = checkValuesOf(g.drop, g.dropFile);
      const kept = checkValuesOf(g.keep, g.keepFile);
      expect(dropped.length, `${g.drop} has no values`).toBeGreaterThan(0);
      expect(
        dropped,
        `${g.table}.${g.column}: ${g.drop} vs ${g.keep} value sets diverged`,
      ).toEqual(kept);
    }
  });

  it("survivor naming is the chk_<table>_<column>_valid convention after 0119", () => {
    // The kept member of every group carries the convention drizzle/schema uses
    // for its own checks (record_links_*_valid), so the next hand-written
    // validation migration has one obvious name to extend instead of two.
    for (const g of GROUPS) {
      expect(SURVIVOR_AFTER[`${g.table}.${g.column}`]).toBe(
        `chk_${g.table}_${g.column}_valid`,
      );
    }
    // ...and only team_members needed the rename; tasks already conformed.
    const renames = [...UP_SQL.matchAll(/RENAME CONSTRAINT (\w+) TO (\w+);/g)];
    expect(renames.map((r) => `${r[1]}->${r[2]}`)).toEqual([
      "team_members_role_valid->chk_team_members_role_valid",
    ]);
    for (const g of GROUPS.filter(
      (x) => x.keep !== SURVIVOR_AFTER[`${x.table}.${x.column}`],
    )) {
      expect(
        renames.some((r) => r[1] === g.keep),
        `${g.keep} must be renamed`,
      ).toBe(true);
    }
  });

  it("journal registers 0119 with a monotonic chain and a matching file name", () => {
    const i = JOURNAL_DATA.entries.findIndex((e) => e.tag === TAG);
    expect(
      i,
      `${TAG} missing from _journal.json — it would never be applied`,
    ).toBeGreaterThan(-1);
    const e = JOURNAL_DATA.entries[i];
    expect(e.idx).toBe(119);
    // Deliberately NOT `e.idx === entries.length - 1`: that asserts 0119 is the
    // head of the chain, which every subsequent migration falsifies. What the
    // #2259 fix actually needs is that 0119 is registered and the chain stays
    // strictly ordered from it onwards.
    for (let j = i + 1; j < JOURNAL_DATA.entries.length; j++) {
      expect(JOURNAL_DATA.entries[j].idx).toBeGreaterThan(
        JOURNAL_DATA.entries[j - 1].idx,
      );
      expect(JOURNAL_DATA.entries[j].when).toBeGreaterThan(
        JOURNAL_DATA.entries[j - 1].when,
      );
    }
    expect(e.breakpoints).toBe(true);
    expect(e.when).toBeGreaterThan(JOURNAL_DATA.entries[i - 1].when);
    expect(`${e.tag}.sql`).toBe("0119_dedupe_check_constraints.sql");
  });

  it("down file reverses exactly this change — rename back, then re-add the three names", () => {
    const stmts = statements(DOWN_SQL);
    expect(stmts).toHaveLength(4);
    expect(stmts[0]).toContain(
      "ALTER TABLE team_members RENAME CONSTRAINT chk_team_members_role_valid TO team_members_role_valid;",
    );
    const added = stmts
      .slice(1)
      .map((s) => (s.match(/ADD CONSTRAINT (\w+)/) ?? [])[1]);
    expect(added.sort()).toEqual([...DROPPED].sort());
    // every ADD is guarded, and each recreates the original value list
    for (const g of GROUPS) {
      const block = stmts.find((s) => s.includes(`ADD CONSTRAINT ${g.drop}`));
      expect(block, `down file re-adds ${g.drop}`).toBeTruthy();
      expect(block).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_constraint/);
      const body = (block as string).match(/CHECK\s*\(([^)]*)\)/i);
      expect(body, `down file keeps a CHECK body for ${g.drop}`).toBeTruthy();
      expect(valuesOf((body as RegExpMatchArray)[1])).toEqual(
        checkValuesOf(g.drop, g.dropFile),
      );
    }
  });

  it("constraint-vocab registry names none of the six constraints (guard:vocab unaffected)", () => {
    const vocab = JSON.parse(
      readFileSync(join(ROOT, "scripts/constraint-vocab.json"), "utf8"),
    ) as {
      constraints: Array<{ constraint: string }>;
    };
    const tracked = new Set(vocab.constraints.map((c) => c.constraint));
    for (const g of GROUPS) {
      expect(
        [...tracked].filter(
          (t) =>
            t === g.drop ||
            t === g.keep ||
            t === SURVIVOR_AFTER[`${g.table}.${g.column}`],
        ),
      ).toEqual([]);
    }
  });

  it("no migration after 0119 restates a dropped check (the duplicate cannot regrow silently)", () => {
    const dir = join(ROOT, "drizzle/migrations");
    const offenders: string[] = [];
    for (const f of readdirSync(dir) as string[]) {
      if (!f.endsWith(".sql") || f.endsWith(".down.sql")) continue;
      const idx = Number(f.slice(0, 4));
      if (idx <= 119 || f.startsWith("0119_")) continue;
      const sql = readFileSync(join(dir, f), "utf8");
      for (const name of DROPPED) {
        if (new RegExp(`ADD CONSTRAINT +"?${name}"?`).test(sql))
          offenders.push(`${f}: ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
