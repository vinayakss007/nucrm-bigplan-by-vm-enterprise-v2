// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All rights reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3118 — two client pages answer "how many deals did this tenant win" with a
 * comparison of their own, and the server's rule (#658, `isWonStageName`) is not
 * either of them.
 *
 *  - `kanban-client.tsx` filters `d.stageId === 'won'`. `stageId` is
 *    `deals.stage_id`, a uuid; the literal `'won'` is only ever the *id* of the
 *    component's built-in `DEFAULT_STAGES` placeholder. On a real board the two
 *    can never be equal, so the `Won Deals` / `Won Value` header cards report 0
 *    for every tenant — the sibling of the comparison #1457 already fixed once in
 *    this file.
 *  - `analytics-client.tsx` compares the stage NAME, but exactly:
 *    `stageName?.toLowerCase() === 'won'`. A tenant that renamed its winning stage
 *    to `Closed Won` — the name #658 was filed about — is then neither won nor
 *    lost, so it lands in `openStages`: Won Revenue ₹0, Win Rate 0%, and the won
 *    money counted as still-live pipeline.
 *
 * Each case is written as a pair, because either half alone can be faked:
 *  - a **renamed** stage (`Closed Won`, uuid ids) must be counted as won — this is
 *    the assertion that fails at base;
 *  - the **placeholder / exact-name** path must keep counting too, and a negated
 *    or unrelated stage (`Not Won`, `Unwon`, `Wonderful Prospect`, `Closed Lost`)
 *    must NOT be swept in by a matcher that got lazier than #658's.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

type SwrStub = {
  data?: unknown;
  error: Error | null;
  isLoading: boolean;
  mutate: ReturnType<typeof vi.fn>;
};

const registry = vi.hoisted(() => ({ byUrl: {} as Record<string, SwrStub> }));

vi.mock('swr', () => ({
  default: (key: string) =>
    registry.byUrl[key] ?? { data: undefined, error: null, isLoading: false, mutate: vi.fn() },
}));
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock('recharts', () => {
  const Stub = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    BarChart: Stub, Bar: Stub, XAxis: Stub, YAxis: Stub, CartesianGrid: Stub,
    Tooltip: Stub, ResponsiveContainer: Stub, PieChart: Stub, Pie: Stub,
    Cell: Stub, Legend: Stub, AreaChart: Stub, Area: Stub,
  };
});

import DealsKanban from '@/app/tenant/deals/kanban/kanban-client';
import AnalyticsPage from '@/app/tenant/analytics/analytics-client';

const DEALS = '/api/tenant/deals';
const PIPELINES = '/api/tenant/pipelines';
const OVERVIEW = '/api/tenant/analytics/overview';

const ok = (data: unknown): SwrStub => ({ data, error: null, isLoading: false, mutate: vi.fn() });

const uuid = (n: string) => `11111111-1111-4111-8111-00000000${n}`;
const deal = (id: string, stageId: string, amount: string, title = `Deal ${id}`) => ({
  id, title, amount, stageId, closeDate: null, assignedTo: null, contactId: null,
  probability: 50, createdAt: '2026-10-01T00:00:00Z',
});

/** A tenant pipeline: real uuid ids, names that are NOT the component defaults. */
const RENAMED_PIPELINE = {
  data: [{
    id: 'p1', isDefault: true, stages: [
      { id: uuid('01'), name: 'Discovery' },
      { id: uuid('02'), name: 'Closed Won' },
      { id: uuid('03'), name: 'Closed Lost' },
    ],
  }],
};

/** The same board with the negations #658 deliberately refuses. */
const REFUSED_PIPELINE = {
  data: [{
    id: 'p1', isDefault: true, stages: [
      { id: uuid('11'), name: 'Not Won' },
      { id: uuid('12'), name: 'Unwon' },
      { id: uuid('13'), name: 'Wonderful Prospect' },
      { id: uuid('14'), name: 'Closed Lost' },
    ],
  }],
};

/**
 * A KPI card on either page is `<p>label</p>` … `<p class="… font-bold">value</p>`
 * (+ `p.mt-1` sub-line on the analytics cards). Reading the sibling by index
 * breaks the moment a card gains a line, so the class the value carries is the
 * contract these tests share with the pages.
 */
function statValue(label: string): { value: string; sub: string } {
  const el = screen.getByText(label);
  const card = el.closest('.admin-card');
  if (!card) throw new Error(`no card for "${label}"`);
  return {
    value: (card.querySelector('p.font-bold')?.textContent ?? '').trim(),
    sub: (card.querySelector('p.mt-1')?.textContent ?? '').trim(),
  };
}

describe('kanban header stats select won deals by the stages the board loaded (#3118)', () => {
  beforeEach(() => { registry.byUrl = {}; });

  it('counts the deals sitting in a renamed won stage', () => {
    registry.byUrl[PIPELINES] = ok(RENAMED_PIPELINE);
    registry.byUrl[DEALS] = ok({ data: [
      deal('d1', uuid('02'), '100000'),
      deal('d2', uuid('02'), '50000'),
      deal('d3', uuid('01'), '75000'),
      deal('d4', uuid('03'), '9000'),
    ] });
    render(<DealsKanban />);
    // 2 of 4 deals are won, worth 150000 — not 0 of 4, worth $0.
    expect(statValue('Won Deals').value).toBe('2');
    expect(statValue('Won Value').value).toMatch(/150,000/);
  });

  it('counts a deal whose row names its own stage, even outside the pipeline on screen', () => {
    // The board draws the DEFAULT pipeline's columns but /deals is not filtered by
    // pipeline, so a second pipeline's won deal has an id that is not in `stages`.
    // The deals API joins the stage name onto every row — the row is its own best
    // evidence of which stage it sits in.
    registry.byUrl[PIPELINES] = ok({
      data: [{ id: 'p1', isDefault: true, stages: [{ id: uuid('30'), name: 'Discovery' }] }],
    });
    registry.byUrl[DEALS] = ok({ data: [
      { ...deal('d1', uuid('31'), '30000'), stageName: 'Closed Won' },
      deal('d2', uuid('30'), '1000'),
    ] });
    render(<DealsKanban />);
    expect(statValue('Won Deals').value).toBe('1');
    expect(statValue('Won Value').value).toMatch(/30,000/);
  });

  it('keeps counting the built-in placeholder stage whose id really is "won"', () => {
    registry.byUrl[PIPELINES] = ok({ data: [] });
    registry.byUrl[DEALS] = ok({ data: [deal('d1', 'won', '20000'), deal('d2', 'lead', '4000')] });
    render(<DealsKanban />);
    expect(statValue('Won Deals').value).toBe('1');
    expect(statValue('Won Value').value).toMatch(/20,000/);
  });

  it('does not sweep in the stages #658 refuses', () => {
    registry.byUrl[PIPELINES] = ok(REFUSED_PIPELINE);
    registry.byUrl[DEALS] = ok({ data: [
      deal('d1', uuid('11'), '1000'),
      deal('d2', uuid('12'), '2000'),
      deal('d3', uuid('13'), '3000'),
      deal('d4', uuid('14'), '4000'),
    ] });
    render(<DealsKanban />);
    expect(statValue('Won Deals').value).toBe('0');
    expect(statValue('Won Value').value).toMatch(/\$0$/);
  });
});

describe('analytics KPIs use the shared won/lost classification (#3118)', () => {
  beforeEach(() => { registry.byUrl = {}; });

  const byStage = (rows: { stageName: string; count: number; revenue: number }[]) => ({
    data: {
      deals: { byStage: rows.map((r, i) => ({ stageId: uuid(`2${i}`), ...r })) },
      contacts: { bySource: [], byStatus: [] },
      tasks: { total: 0, completed: 0, open: 0, overdue: 0 },
      timeseries: { weekly: [] },
    },
  });

  it('a Closed Won / Closed Lost tenant gets won revenue, win rate, and pipeline without the won money', () => {
    registry.byUrl[OVERVIEW] = ok(byStage([
      { stageName: 'Closed Won', count: 8, revenue: 4200000 },
      { stageName: 'Closed Lost', count: 2, revenue: 0 },
      { stageName: 'Proposal', count: 5, revenue: 900000 },
    ]));
    render(<AnalyticsPage />);
    const won = statValue('Won Revenue');
    expect(won.value).toMatch(/4,200,000/);
    expect(won.sub).toBe('8 deals won');
    expect(statValue('Win Rate').value).toBe('80%');
    expect(statValue('Win Rate').sub).toBe('Avg deal $525,000');
    // 8 × 4.2M is closed: only the 900000 in Proposal is still pipeline.
    expect(statValue('Open Pipeline').value).toMatch(/900,000/);
    expect(statValue('Open Pipeline').sub).toBe('5 deals');
  });

  it('the plain "Won"/"Lost" names still classify, so nothing already correct regresses', () => {
    registry.byUrl[OVERVIEW] = ok(byStage([
      { stageName: 'Won', count: 3, revenue: 300000 },
      { stageName: 'Lost', count: 1, revenue: 0 },
      { stageName: 'Qualified', count: 4, revenue: 100000 },
    ]));
    render(<AnalyticsPage />);
    expect(statValue('Won Revenue').sub).toBe('3 deals won');
    expect(statValue('Win Rate').value).toBe('75%');
    expect(statValue('Open Pipeline').sub).toBe('4 deals');
  });

  it('a refused stage is neither won nor lost — it stays open, and the win rate is not deflated', () => {
    registry.byUrl[OVERVIEW] = ok(byStage([
      { stageName: 'Not Won', count: 4, revenue: 400000 },
      { stageName: 'Wonderful Prospect', count: 1, revenue: 1000 },
      { stageName: 'Closed Won', count: 1, revenue: 100000 },
    ]));
    render(<AnalyticsPage />);
    // Only the one Closed Won deal counts as won; win rate is 1/1, not 1/6.
    expect(statValue('Won Revenue').sub).toBe('1 deals won');
    expect(statValue('Win Rate').value).toBe('100%');
    expect(statValue('Open Pipeline').sub).toBe('5 deals');
  });
});

describe('isLostStageName — the mirror the analytics client needs (#3118)', () => {
  // Dynamic so the missing export fails this case alone rather than the file.
  const mod = async () => (await import('@/lib/deals/won-stage')) as unknown as
    Record<string, (name: string | null | undefined) => boolean>;

  it('accepts the same qualifier vocabulary as the won side', async () => {
    const { isLostStageName } = await mod();
    expect(typeof isLostStageName).toBe('function');
    for (const name of ['Lost', 'LOST', 'Closed Lost', 'Deal Lost', 'Marked Lost', 'closed - lost']) {
      expect(isLostStageName(name), name).toBe(true);
    }
  });

  it('rejects a stage that merely mentions losing something else, and the won side', async () => {
    const { isLostStageName } = await mod();
    for (const name of ['Post-Loss Review', 'Churn Risk', 'Won', 'Closed Won', 'Not Lost', null, '']) {
      expect(isLostStageName(name), String(name)).toBe(false);
    }
  });
});
