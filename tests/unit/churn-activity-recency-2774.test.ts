/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2774 — `calculate_churn_risk` was `RETURN 0.1;`: every contact in every
 * tenant scored the same constant. Migration 0149 replaces it with a
 * deterministic activity-recency score. This test pins that the migration's SQL
 * actually encodes distinct recency bands, so two contacts whose last activity
 * differs get different scores — the acceptance criterion of the decision that
 * closed #2774.
 *
 * No live Postgres is available in unit CI, so the band rules are read out of
 * the migration text itself and evaluated, rather than mirrored by hand in a
 * parallel implementation that could drift from the SQL.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const read = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url).pathname, 'utf8');
const UP = read('drizzle/migrations/0149_churn_risk_activity_recency.sql');
const DOWN = read('drizzle/migrations/0149_churn_risk_activity_recency.down.sql');
const JOURNAL = JSON.parse(read('drizzle/migrations/meta/_journal.json'));
const ROUTE = read('app/api/tenant/analytics/churn/route.ts');

/** The `WHEN idle_days >= threshold <op> <n> THEN <score>` arms, as written. */
const bands = [...UP.matchAll(/WHEN cs\.idle_days >= cs\.idle_threshold_days(?: \* (\d+)| \/ (\d+\.\d+))? THEN (0\.\d+)/g)]
  .map((m) => ({
    multiplier: m[1] ? Number(m[1]) : m[2] ? 1 / Number(m[2]) : 1,
    score: Number(m[3]),
  }))
  .sort((a, b) => b.multiplier - a.multiplier);

const elseScore = Number(/ELSE (0\.\d+)/.exec(UP)?.[1]);

function recencyScore(idleDays: number, threshold = 14): number {
  for (const band of bands) {
    if (idleDays >= threshold * band.multiplier) return band.score;
  }
  return elseScore;
}

describe('#2774 migration 0149 replaces the churn constant with a real model', () => {
  it('no longer contains the RETURN 0.1 placeholder in the forward migration', () => {
    // Strip `--` prose first: the header quotes the old constant to explain it.
    const executable = UP.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n');
    expect(executable).not.toMatch(/RETURN\s+0\.1/);
    expect(executable).toMatch(/CREATE OR REPLACE FUNCTION public\.calculate_churn_risk\(p_contact_id uuid\)/);
  });

  it('derives recency from the contact activity columns, not a constant', () => {
    expect(UP).toMatch(/GREATEST\(c\.last_activity_at, c\.last_contacted_at\)/);
    expect(UP).toMatch(/c\.created_at/);
    expect(UP).toMatch(/c\.id = p_contact_id/);
    expect(UP).toMatch(/c\.deleted_at IS NULL/);
  });

  it('uses the tenant global idle threshold with a 14-day default', () => {
    expect(UP).toMatch(/at_risk_rules r/);
    expect(UP).toMatch(/r\.max_days_idle/);
    expect(UP).toMatch(/r\.stage_id IS NULL/);
    expect(UP).toMatch(/r\.active = true/);
    expect(UP).toMatch(/\), 14\) AS idle_threshold_days/);
  });

  it('has four distinct recency bands, clamped and rounded to 2dp', () => {
    // Three WHEN arms plus the ELSE arm = four distinct scores.
    expect(bands).toHaveLength(3);
    expect(new Set([...bands.map((b) => b.score), elseScore]).size).toBe(4);
    expect(UP).toMatch(/LEAST\(1\.0::numeric, GREATEST\(0::numeric, ROUND\(/);
    expect(UP).toMatch(/::numeric, 2\)\)/);
  });

  it('scores two contacts with different last-activity dates differently', () => {
    // With the default 14-day threshold: fresh contact -> 0.05, idle contact -> 0.80.
    expect(recencyScore(1)).toBe(0.05);
    expect(recencyScore(30)).toBe(0.80);
    expect(recencyScore(30)).toBeGreaterThan(recencyScore(1));
    // A tenant that tunes max_days_idle moves the boundary, not the shape.
    expect(recencyScore(20, 30)).toBe(0.30);
  });

  it('adds engagement and disengagement terms', () => {
    expect(UP).toMatch(/c\.times_contacted/);
    expect(UP).toMatch(/c\.unsubscribed/);
    expect(UP).toMatch(/c\.do_not_contact/);
  });

  it('is idempotent, reverts cleanly, and is registered in the journal', () => {
    expect(UP).toContain('CREATE OR REPLACE FUNCTION public.calculate_churn_risk');
    expect(DOWN).toContain('CREATE OR REPLACE FUNCTION public.calculate_churn_risk');
    expect(DOWN).toMatch(/RETURN\s+0\.1/);
    expect(JOURNAL.entries.some((e: { tag: string }) => e.tag === '0149_churn_risk_activity_recency')).toBe(true);
  });

  it('the route reports the score as modelled, from this function', () => {
    expect(ROUTE).toContain("'activity_recency_model'");
    expect(ROUTE).toContain('isModelled: true');
    expect(ROUTE).toContain('public.calculate_churn_risk');
  });
});
