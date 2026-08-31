/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Unit tests for resolveDealStage() (#658 / HIGH #8).
 *
 * The old inline resolution in the deals create/update routes had edge cases
 * that failed silently: unescaped ILIKE wildcards could resolve to the wrong
 * stage, an explicitly-supplied stage_id was never validated against the
 * tenant/pipeline, and `.limit(1)` hid ambiguous same-named stages. This locks
 * in the corrected behavior with a lightweight executor mock that records the
 * WHERE condition each select builds and serves rows from an ordered queue.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { dealStages } from '@/drizzle/schema';
import {
  resolveDealStage,
  stageFailureMessage,
  normalizeStageField,
  type StageResolverExecutor,
} from '@/lib/deals/resolve-stage';

const TENANT = '11111111-1111-4111-8111-111111111111';
const PIPELINE_A = '22222222-2222-4222-8222-222222222222';
const PIPELINE_B = '33333333-3333-4333-8333-333333333333';
const STAGE_A = '44444444-4444-4444-8444-444444444444';
const STAGE_B = '55555555-5555-4555-8555-555555555555';

type Row = { id: string; name: string; pipelineId: string };

const rows: Row[][] = [];
const captured: { where?: unknown; args?: unknown[] }[] = [];

/**
 * Column names referenced by a Drizzle condition. Walks queryChunks and stops
 * at column nodes so we can assert tenant/pipeline scoping is present.
 */
function referencedColumns(node: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 14 || node === null || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const n of node) referencedColumns(n, out, depth + 1);
    return out;
  }
  const rec = node as Record<string, unknown>;
  if (typeof rec['columnType'] === 'string' && typeof rec['name'] === 'string') {
    out.push(rec['name'] as string);
    return out;
  }
  if (Array.isArray(rec['queryChunks'])) referencedColumns(rec['queryChunks'], out, depth + 1);
  if (rec['encoder']) referencedColumns(rec['encoder'], out, depth + 1);
  return out;
}

/** Minimal executor mirroring the Drizzle select chain the resolver uses. */
const exec: StageResolverExecutor = {
  select: () => {
    const rec: { where?: unknown } = {};
    captured.push(rec);
    const self: any = {
      from: () => self,
      innerJoin: () => self,
      where: (c: unknown) => {
        rec.where = c;
        return self;
      },
      limit: async () => rows.shift() ?? [],
    };
    return self;
  },
} as unknown as StageResolverExecutor;

beforeEach(() => {
  rows.length = 0;
  captured.length = 0;
});

describe('resolveDealStage — explicit stage_id path', () => {
  it('accepts a stage_id that exists for the tenant and returns its name + pipeline', async () => {
    rows.push([{ id: STAGE_A, name: 'Negotiation', pipelineId: PIPELINE_A }]);

    const res = await resolveDealStage(exec, { stageId: STAGE_A, tenantId: TENANT });

    expect(res).toEqual({ ok: true, stageId: STAGE_A, stageName: 'Negotiation', pipelineId: PIPELINE_A });
  });

  it('rejects a stage_id that does not exist for the tenant (not_found)', async () => {
    rows.push([]); // tenant-scoped lookup misses, as it would for another tenant's stage

    const res = await resolveDealStage(exec, { stageId: STAGE_A, tenantId: TENANT });

    expect(res).toEqual({ ok: false, reason: 'not_found' });
  });

  it('rejects a stage_id from a different pipeline than the one requested (pipeline_mismatch)', async () => {
    rows.push([{ id: STAGE_A, name: 'Negotiation', pipelineId: PIPELINE_A }]);

    const res = await resolveDealStage(exec, {
      stageId: STAGE_A,
      pipelineId: PIPELINE_B,
      tenantId: TENANT,
    });

    expect(res).toEqual({ ok: false, reason: 'pipeline_mismatch' });
  });

  it('prefers stage_id over a supplied name', async () => {
    rows.push([{ id: STAGE_A, name: 'Negotiation', pipelineId: PIPELINE_A }]);

    const res = await resolveDealStage(exec, {
      stageId: STAGE_A,
      stageName: 'Some Other Name',
      tenantId: TENANT,
    });

    expect(res).toMatchObject({ ok: true, stageId: STAGE_A });
  });

  it('scopes the lookup to the tenant in SQL', async () => {
    rows.push([{ id: STAGE_A, name: 'Negotiation', pipelineId: PIPELINE_A }]);

    await resolveDealStage(exec, { stageId: STAGE_A, tenantId: TENANT });

    expect(referencedColumns(captured[0]!.where)).toContain('tenant_id');
  });
});

describe('resolveDealStage — resolve-by-name path', () => {
  it('resolves a unique stage name', async () => {
    rows.push([{ id: STAGE_A, name: 'Won', pipelineId: PIPELINE_A }]);

    const res = await resolveDealStage(exec, { stageName: 'Won', tenantId: TENANT });

    expect(res).toEqual({ ok: true, stageId: STAGE_A, stageName: 'Won', pipelineId: PIPELINE_A });
  });

  it('reports ambiguity when a name matches multiple stages across pipelines', async () => {
    rows.push([
      { id: STAGE_A, name: 'Won', pipelineId: PIPELINE_A },
      { id: STAGE_B, name: 'Won', pipelineId: PIPELINE_B },
    ]);

    const res = await resolveDealStage(exec, { stageName: 'Won', tenantId: TENANT });

    expect(res).toEqual({ ok: false, reason: 'ambiguous', attemptedName: 'Won' });
  });

  it('disambiguates by pipeline_id — narrowing the SQL so only one row matches', async () => {
    rows.push([{ id: STAGE_A, name: 'Won', pipelineId: PIPELINE_A }]);

    const res = await resolveDealStage(exec, {
      stageName: 'Won',
      pipelineId: PIPELINE_A,
      tenantId: TENANT,
    });

    expect(res).toMatchObject({ ok: true, stageId: STAGE_A });
    // pipeline scoping is expressed in SQL, not just checked after the fact
    expect(referencedColumns(captured[0]!.where)).toContain('pipeline_id');
  });

  it('returns not_found (with the attempted name) when nothing matches', async () => {
    rows.push([]);

    const res = await resolveDealStage(exec, { stageName: 'Nope', tenantId: TENANT });

    expect(res).toEqual({ ok: false, reason: 'not_found', attemptedName: 'Nope' });
  });

  it('does not treat LIKE metacharacters in the name as wildcards (escaped, so it misses)', async () => {
    // The mock does not evaluate SQL, but we assert the resolver passed an
    // escaped pattern to ILIKE rather than the raw wildcard string.
    rows.push([]);

    await resolveDealStage(exec, { stageName: 'a_b', tenantId: TENANT });

    const cols = referencedColumns(captured[0]!.where);
    expect(cols).toContain('name');
    // Recover the bound ILIKE parameter and confirm the underscore was escaped.
    const params = collectStrings(captured[0]!.where);
    expect(params.some((p) => p.includes('a\\_b'))).toBe(true);
  });
});

describe('resolveDealStage — empty / missing input', () => {
  it('returns missing when neither id nor name is supplied', async () => {
    const res = await resolveDealStage(exec, { tenantId: TENANT });
    expect(res).toEqual({ ok: false, reason: 'missing' });
  });

  it('treats empty-string and whitespace stage_id/stage_name as not supplied', async () => {
    const res = await resolveDealStage(exec, { stageId: '', stageName: '   ', tenantId: TENANT });
    expect(res).toEqual({ ok: false, reason: 'missing' });
  });
});

describe('stageFailureMessage', () => {
  it('produces actionable copy per failure reason', () => {
    expect(stageFailureMessage({ ok: false, reason: 'missing' })).toMatch(/stage_id is required/);
    expect(stageFailureMessage({ ok: false, reason: 'not_found', attemptedName: 'Won' })).toContain('"Won"');
    expect(stageFailureMessage({ ok: false, reason: 'ambiguous', attemptedName: 'Won' })).toMatch(/multiple stages/);
    expect(stageFailureMessage({ ok: false, reason: 'pipeline_mismatch' })).toMatch(/different pipeline/);
  });
});

describe('normalizeStageField', () => {
  it('collapses empty-ish values to undefined and trims real ones', () => {
    expect(normalizeStageField(undefined)).toBeUndefined();
    expect(normalizeStageField(null)).toBeUndefined();
    expect(normalizeStageField('')).toBeUndefined();
    expect(normalizeStageField('   ')).toBeUndefined();
    expect(normalizeStageField('  Won  ')).toBe('Won');
  });
});

/** Collect all bound string params from a Drizzle condition tree. */
function collectStrings(node: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 14 || node === null || typeof node !== 'object') {
    if (typeof node === 'string') out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    for (const n of node) collectStrings(n, out, depth + 1);
    return out;
  }
  for (const v of Object.values(node as Record<string, unknown>)) {
    collectStrings(v, out, depth + 1);
  }
  return out;
}

// Silence "dealStages imported but only used for typing" in some ts configs.
void dealStages;
