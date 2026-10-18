/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2806 (the decision-free half) — `createWorkflowSchema.trigger_type` is the set
 * `chk_workflows_trigger_type` admits, not a hand-copy of it that quietly lost a member.
 *
 * `workflows.trigger_type` is a plain `text` column (`drizzle/schema/automation.ts:76`), so the
 * CHECK in `drizzle/migrations/0050_data_validation_checks.sql` is the only real gate — and the
 * zod enum that sits in front of it declared `('event','schedule','manual')`. `'webhook'`
 * satisfied the database and was refused by `POST /api/tenant/workflows`, so the one kind the
 * column documents as legal could be created only by writing SQL. Nothing in the suite noticed:
 * `guard:schemas` compares `z.object` *keys* against column names and never looks at enum
 * *values*, and `scripts/constraint-vocab.json` had no entry for this constraint at all.
 *
 * The comparison is static — a migration file against a schema — because both sides are text.
 * It reads the admitted set out of `0050` instead of restating it here, since a third copy of the
 * same list is precisely the defect this file exists to catch.
 *
 * WHAT IT DOES NOT DECIDE
 * -----------------------
 * `components/tenant/workflow-builder.tsx` offers nine dotted event names (`contact.created`,
 * `deal.won`, …) and posts them as `trigger_type`; none of them is in the CHECK, so creating a
 * workflow from the builder still answers 400 and this change does not touch that. #2806 asks the
 * owner to choose between (a) `trigger_type` is the kind and the event moves to `trigger_config`,
 * (b) the CHECK is widened to the event names — a migration on a live table — or (c) both columns
 * exist, properly typed. The last block pins that open half so a green suite cannot be read as
 * "#2806 is done", and it goes red the day the decision lands, which is the point. (PATCH's
 * trigger-editing gap is already documented in
 * `tests/unit/workflow-patch-write-vocabulary-2805.test.ts`.)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createWorkflowSchema } from '@/lib/api/schemas';
import * as automation from '@/lib/api/schemas/automation';
import { validateBody } from '@/lib/api/validate';

const ROOT = new URL('../..', import.meta.url).pathname;
const MIGRATIONS = `${ROOT}drizzle/migrations`;
const CONSTRAINT = 'chk_workflows_trigger_type';
const SCHEMA_FILE = 'lib/api/schemas/automation.ts';

/** The admitted set, read out of the migration that owns it. */
function checkAdmittedSet(): { values: string[]; file: string } {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'));
  const defining = files.filter((f) =>
    readFileSync(`${MIGRATIONS}/${f}`, 'utf8').includes(`CONSTRAINT ${CONSTRAINT}`));
  expect(
    defining,
    `${CONSTRAINT} is defined in ${defining.length} migration files (${defining.join(', ')}) — one list cannot be copied twice`,
  ).toHaveLength(1);

  const raw = readFileSync(`${MIGRATIONS}/${defining[0]!}`, 'utf8');
  const stmt = raw.split(/;\s*(?:\n|$)/).find((s) => s.includes(`CONSTRAINT ${CONSTRAINT}`));
  expect(stmt, `${CONSTRAINT} has no readable CHECK clause in ${defining[0]}`).toBeDefined();

  const match = /\bCHECK\s*\(\s*trigger_type\s+IN\s*\(([^)]*)\)\s*\)/i.exec(stmt!);
  expect(
    match,
    `${CONSTRAINT} is no longer a plain "trigger_type IN (...)" list — this screen cannot read it: ${stmt?.trim().slice(0, 120)}`,
  ).not.toBeNull();
  const values = match![1]!.split(',').map((v) => v.trim().replace(/^'|'$/g, ''));
  expect(values.every((v) => v.length > 0), `unparseable member in ${match![1]}`).toBe(true);
  return { values, file: defining[0]! };
}

/** `z.enum([...])`, through whichever wrapper the field has. Throws rather than
 *  returning `[]`, so a field reshaped into something unreadable is a red test, not a vacuous one. */
function enumValues(node: unknown): string[] {
  const n = node as { options?: unknown; unwrap?: () => unknown };
  if (Array.isArray(n.options)) return n.options as string[];
  if (typeof n.unwrap === 'function') return enumValues(n.unwrap());
  throw new Error('trigger_type is no longer a zod enum — this screen cannot compare it to the CHECK');
}

/** Every `.ts` file under `dir`, so a new declaration of the schema cannot hide in a subfolder. */
function tsFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const full = `${dir}/${d.name}`;
    if (d.isDirectory()) return tsFilesUnder(full);
    return d.isFile() && d.name.endsWith('.ts') ? [full] : [];
  });
}

const db = checkAdmittedSet();
const schemaValues = enumValues(createWorkflowSchema.shape.trigger_type);

describe('#2806 the zod enum is the database CHECK, not a copy of it', () => {
  it('the CHECK still admits exactly four trigger kinds', () => {
    // Read out of 0050 and asserted here, so a widened or narrowed CHECK is noticed rather than
    // silently followed. The list is a set; order is not part of the contract.
    expect([...db.values].sort()).toEqual(['event', 'manual', 'schedule', 'webhook']);
  });

  it('createWorkflowSchema admits exactly the set the CHECK admits', () => {
    expect(
      [...schemaValues].sort(),
      `schema vs ${db.file}: ${JSON.stringify([...schemaValues].sort())} vs ${JSON.stringify([...db.values].sort())}`,
    ).toEqual([...db.values].sort());
  });

  it('there is exactly one createWorkflowSchema, and the barrel re-exports it', () => {
    // #2819 removed the duplicated copy from lib/api/schemas.ts, so the sentence in the old
    // comment — "kept identical to lib/api/schemas.ts" — was describing two files that no longer
    // exist as two files. Asserting one declaration is what stops this fix being made twice, in
    // two places, and drifted apart again.
    expect(automation.createWorkflowSchema).toBe(createWorkflowSchema);
    const declarations = tsFilesUnder(`${ROOT}lib`)
      .filter((f) => /export const createWorkflowSchema\s*=/.test(readFileSync(f, 'utf8')));
    expect(
      declarations.map((f) => f.slice(ROOT.length)),
      `createWorkflowSchema is declared ${declarations.length} times — the schema drifts again if that is true`,
    ).toEqual([SCHEMA_FILE]);
  });

  it('the column comment still enumerates the same kinds', () => {
    // drizzle/schema/automation.ts:76 documents the vocabulary in prose. Prose that disagrees with
    // the CHECK is how this drifted in the first place.
    const src = readFileSync(`${ROOT}drizzle/schema/automation.ts`, 'utf8');
    // Scoped to `workflows`: `automations.trigger_type` is a different, CHECK-less column on a
    // different vocabulary, and #2806 is about `workflows`.
    const lines = src.slice(src.indexOf('export const workflows = pgTable')).split('\n');
    const line = lines.find((l) => l.includes("text('trigger_type')"));
    expect(line, 'workflows.trigger_type is no longer a plain text column — re-read #2806').toBeDefined();
    const kinds = /\/\/\s*'?([a-z_]+)'?,\s*'?([a-z_]+)'?,\s*'?([a-z_]+)'?,\s*'?([a-z_]+)'?/.exec(line!);
    expect(kinds, `${line} does not enumerate four kinds`).not.toBeNull();
    expect([1, 2, 3, 4].map((i) => kinds![i]!).sort()).toEqual([...db.values].sort());
  });

  it('the vocabulary is registered in the constraint-vocab guard', () => {
    // `guard:vocab` (live DB) and tests/unit/constraint-vocab-registry.test.ts (source) both read
    // this file. Without an entry the drift that #2806 reported is free to happen again.
    const registry = JSON.parse(
      readFileSync(`${ROOT}scripts/constraint-vocab.json`, 'utf8'),
    ) as { constraints: { id: string; constraint: string; required: string[]; declaredIn: string[] }[] };
    const entry = registry.constraints.find((c) => c.id === 'workflows.trigger_type');
    expect(entry, 'scripts/constraint-vocab.json lost its workflows.trigger_type entry').toBeDefined();
    expect(entry!.constraint).toBe(CONSTRAINT);
    expect([...entry!.required].sort()).toEqual([...db.values].sort());
    expect([...entry!.required].sort()).toEqual([...schemaValues].sort());
    expect(entry!.declaredIn).toContain(SCHEMA_FILE);
    expect(existsSync(`${ROOT}${SCHEMA_FILE}`), `${SCHEMA_FILE} moved — update the registry`).toBe(true);
  });
});

describe('#2806 what POST /api/tenant/workflows answers for trigger_type', () => {
  it.each([...db.values])('%s reaches the insert instead of a 400', (kind) => {
    const out = validateBody(createWorkflowSchema, { name: 'Probe', trigger_type: kind });
    expect(out, `${kind} was refused by the schema before the route could see it`).toHaveProperty('data');
  });

  it('webhook is no longer uncreatable', () => {
    const out = validateBody(createWorkflowSchema, { name: 'Probe', trigger_type: 'webhook' });
    expect(out, 'the one kind the CHECK admits and the API refused').toHaveProperty('data');
  });

  it('anything else is a 400 from the schema, never a 23514 from the database', () => {
    // Acceptance criterion 4 of #2806 for this column: the enum in front of the CHECK has to be
    // the CHECK, so an out-of-set value is answered with the allowed list instead of reaching
    // Postgres and failing at insert.
    for (const bad of ['contact.created', 'webhooks', 'WEBHOOK', '', 'cron']) {
      const out = validateBody(createWorkflowSchema, { name: 'Probe', trigger_type: bad });
      expect('data' in out, `${JSON.stringify(bad)} should not parse`).toBe(false);
      expect((out as { status: number }).status, `${JSON.stringify(bad)} must be a 400`).toBe(400);
    }
  });

  it('omitting it is still the route to reject, not a silent default', () => {
    // The absent `.default()` is deliberate (#2805): the schema passes it through as undefined and
    // the route answers its own 400 (`app/api/tenant/workflows/route.ts`). A re-added default
    // would regress into an 'event' workflow the caller never asked for.
    const out = validateBody(createWorkflowSchema, { name: 'Probe' });
    expect('data' in out).toBe(true);
    expect((out as { data: { trigger_type?: string } }).data.trigger_type).toBeUndefined();
  });
});

describe('#2806 the half that is still open', () => {
  const builder = readFileSync(`${ROOT}components/tenant/workflow-builder.tsx`, 'utf8');
  const optionsBlock = /const TRIGGER_OPTIONS = \[([\s\S]*?)\n\]/.exec(builder);
  expect(optionsBlock, 'TRIGGER_OPTIONS is no longer a literal array — re-read #2806').not.toBeNull();
  const offered = [...optionsBlock![1]!.matchAll(/value:\s*'([^']+)'/g)].map((m) => m[1]!);

  it('the builder still offers nine dotted event names', () => {
    expect(offered).toHaveLength(9);
    expect(offered).toContain('contact.created');
  });

  it('none of them is legal in the CHECK, so saving from the builder still 400s', () => {
    const illegal = offered.filter((v) => !db.values.includes(v));
    expect(
      illegal,
      `#2806's (a)/(b)/(c) decision looks like it was taken: ${illegal.join(', ')} now parse. `
      + 'Update this file to assert the chosen vocabulary across all three sites, and say so on #2806.',
    ).toEqual(offered);
  });

  it('the builder posts that value as trigger_type on every create', () => {
    expect(builder).toMatch(/trigger_type:\s*triggerType/);
  });
});
