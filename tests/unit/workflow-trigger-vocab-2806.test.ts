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
 * `guard:schemas` (#2819) only enforces "there must never be two copies of a schema", the #2255
 * guard compares drizzle tables/columns/indexes against a committed DB inventory, and the one
 * guard that does read vocabularies — `guard:vocab` over `scripts/constraint-vocab.json` — had no
 * entry for this constraint at all. No screen anywhere compared a zod enum's *values* to the CHECK
 * the enum is supposed to be guarding.
 *
 * The comparison is static — a migration file against a schema — because both sides are text.
 * It reads the admitted set out of `0050` instead of restating it here, since a third copy of the
 * same list is precisely the defect this file exists to catch.
 *
 * WHAT THIS FILE PINs
 * -------------------
 * `components/tenant/workflow-builder.tsx` used to offer nine dotted event
 * names (`contact.created`, `deal.won`, …) and post them as `trigger_type`;
 * none of them is in the CHECK, so creating a workflow from the builder was
 * always a 400. The owner took the (a)/(b)/(c) decision on #2806: **(a)** —
 * `trigger_type` is the kind and the event moves to `trigger_config` as
 * `{ entity, event }`. The last block asserts that contract across all three
 * sites — migration, schema, builder — so a future edit cannot re-open the gap.
 * (PATCH's trigger-editing gap is fixed in the same change and pinned by
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

describe('#2806 option (a) — trigger_type is the kind, the event lives in trigger_config', () => {
  // The owner took the (a)/(b)/(c) decision on #2806: (a). `trigger_type` keeps
  // the four CHECK kinds; the dotted event moves to `trigger_config` as
  // `{ entity, event }`, so the builder's choice survives both the schema and
  // the CHECK, and no dotted value is ever posted as `trigger_type` again.

  const SHARED_FILE = 'lib/automation/workflow-trigger.ts';
  const builder = readFileSync(`${ROOT}components/tenant/workflow-builder.tsx`, 'utf8');
  const shared = readFileSync(`${ROOT}${SHARED_FILE}`, 'utf8');

  it('the shared trigger module is the builder-side copy of the CHECK set', async () => {
    const { WORKFLOW_TRIGGER_TYPES } = await import('@/lib/automation/workflow-trigger');
    expect(
      [...WORKFLOW_TRIGGER_TYPES].sort(),
      `the client-safe trigger vocabulary drifted from ${db.file}`,
    ).toEqual([...db.values].sort());
    expect([...WORKFLOW_TRIGGER_TYPES].sort()).toEqual([...schemaValues].sort());
  });

  it('the registry cites the shared module too, and it carries the literals', () => {
    const registry = JSON.parse(
      readFileSync(`${ROOT}scripts/constraint-vocab.json`, 'utf8'),
    ) as { constraints: { id: string; declaredIn: string[] }[] };
    const entry = registry.constraints.find((c) => c.id === 'workflows.trigger_type');
    expect(entry!.declaredIn).toContain(SHARED_FILE);
    for (const kind of db.values) {
      expect(shared, `${SHARED_FILE} must carry '${kind}' literally for guard:vocab`).toContain(`'${kind}'`);
    }
  });

  it('the builder offers kinds and events as two fields, not dotted values in trigger_type', () => {
    // The nine dotted names used to be the only picker and their value went
    // straight into trigger_type — every save was a 400. Now kind is the first
    // select and the event pair is posted inside trigger_config.
    expect(builder).toMatch(/WORKFLOW_TRIGGER_TYPES\.map/);
    expect(builder).toMatch(/WORKFLOW_TRIGGER_EVENTS\.map/);
    expect(builder).toMatch(/trigger_config:\s*\{\s*entity:\s*\w+,\s*event:\s*\w+\s*\}/);
    expect(builder).not.toMatch(/const TRIGGER_OPTIONS = \[/);
  });

  it('the events the builder offers all parse to an entity + event pair', async () => {
    const { WORKFLOW_TRIGGER_EVENTS } = await import('@/lib/automation/workflow-trigger');
    expect(WORKFLOW_TRIGGER_EVENTS.map((e) => `${e.entity}.${e.event}`).sort()).toEqual([
      'contact.created', 'contact.updated', 'deal.created', 'deal.lost',
      'deal.stage_changed', 'deal.won', 'form.submitted', 'task.completed', 'task.created',
    ]);
    for (const { entity, event } of WORKFLOW_TRIGGER_EVENTS) {
      expect(entity).toBeTruthy();
      expect(event).toBeTruthy();
    }
  });

  it('PATCH maps trigger_type through the same set instead of dropping it', () => {
    // Acceptance criterion 3 of #2806: editing the trigger updates the row.
    const patchRoute = readFileSync(`${ROOT}app/api/tenant/workflows/[id]/route.ts`, 'utf8');
    expect(patchRoute).toMatch(/updateData\.triggerType = trigger_type/);
    expect(patchRoute, 'an out-of-set value must be a 400 at the door, never a 23514')
      .toMatch(/isWorkflowTriggerType\(trigger_type\)/);
  });
});
