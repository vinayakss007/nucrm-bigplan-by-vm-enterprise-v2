// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #2757 — the deal forecast panel reads keys the route never sends, and its Edit
 * round-trip then overwrites what is stored.
 *
 * `GET /api/tenant/deals/[id]/forecast` answers `db.select().from(dealForecasts)`
 * (app/api/tenant/deals/[id]/forecast/route.ts:58-60,70) — a raw table select, so
 * the JSON carries Drizzle's column properties: `winProbability`,
 * `predictedCloseDate`, `predictedValue`, `confidenceLevel`
 * (drizzle/schema/crm.ts:757-766).
 *
 * `components/tenant/deal-forecast.tsx:13-21` declares the row in the vocabulary of
 * the *request* schema (`forecastSchema` at route.ts:18-23 really is snake_case —
 * `probability`, `expected_close_date`, …) and reads `f.expected_close_date`,
 * `f.probability`, `f.forecast_amount`, `f.confidence_level` at :44-47 and again at
 * :149-169. None of those keys exist on the response.
 *
 * So the panel shows `0%` / `Not set` / `Not set` / `medium` for a stored 75%
 * high-confidence $12,000 forecast, `setForm` (:43-48) fills the editor with its
 * defaults instead of the row, and **Save posts those defaults back** (:70-75): the
 * route's update branch takes `probability !== undefined` and
 * `confidence_level !== undefined` and writes `win_probability = 50`,
 * `confidence_level = 'medium'` over the real forecast
 * (route.ts:112-117). The close date and amount survive only because the client
 * omits `undefined` fields.
 *
 * `deal-detail-client.tsx:647` mounts this on every deal page.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import DealForecast from '@/components/tenant/deal-forecast';

const DEAL_ID = '77777777-7777-4777-8777-777777777777';

/** Exactly what route.ts:70 answers: the raw drizzle row, camelCase, decimals as strings. */
function apiRow(over: Record<string, unknown> = {}) {
  return {
    id: '88888888-8888-4888-8888-888888888888',
    tenantId: '11111111-1111-4111-8111-111111111111',
    dealId: DEAL_ID,
    winProbability: '75.00',
    predictedCloseDate: '2026-12-01',
    predictedValue: '12000.00',
    positiveFactors: [],
    negativeFactors: [],
    originalValue: '10000.00',
    valueChange: '2000.00',
    originalCloseDate: '2026-11-01',
    dateChangeDays: 30,
    confidenceLevel: 'high',
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-10T10:00:00.000Z',
    deletedAt: null,
    ...over,
  };
}

let posts: Record<string, unknown>[] = [];

function stubGet(row: Record<string, unknown> | null) {
  posts = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return { ok: true, status: 200, json: async () => ({ data: row }) } as Response;
    }
    return { ok: true, status: 200, json: async () => ({ data: row }) } as Response;
  }));
}

async function mount(row: Record<string, unknown> | null) {
  stubGet(row);
  render(<DealForecast dealId={DEAL_ID} />);
  // The loading state is a pulsing skeleton with no text in it, so wait for one of
  // the two settled branches to appear.
  await waitFor(() => expect(
    screen.queryByText('Forecast') ?? screen.queryByText(/No forecast for this deal/),
  ).toBeTruthy());
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the forecast panel reads the row the route answers with (#2757)', () => {
  it('shows the stored probability', async () => {
    await mount(apiRow());
    expect(screen.getByText('75%')).toBeTruthy();
  });

  it('shows the stored close date', async () => {
    await mount(apiRow());
    const expected = new Date('2026-12-01').toLocaleDateString();
    expect(screen.getByText(expected)).toBeTruthy();
  });

  it('shows the stored forecast amount', async () => {
    await mount(apiRow());
    expect(screen.getByText('$12,000')).toBeTruthy();
  });

  it('shows the stored confidence level', async () => {
    await mount(apiRow());
    expect(screen.getByText('high')).toBeTruthy();
  });

  it('opens the editor with the stored values, not its defaults', async () => {
    await mount(apiRow());
    fireEvent.click(screen.getByText('Edit'));
    expect(screen.getByDisplayValue('2026-12-01')).toBeTruthy();
    expect(screen.getByDisplayValue('75')).toBeTruthy();
    expect(screen.getByDisplayValue('12000')).toBeTruthy();
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('high');
  });

  it('saving without editing re-posts what is stored instead of the defaults', async () => {
    await mount(apiRow());
    fireEvent.click(screen.getByText('Edit'));
    fireEvent.click(screen.getByText('Save Forecast'));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({
      expected_close_date: '2026-12-01',
      probability: 75,
      forecast_amount: 12000,
      confidence_level: 'high',
    });
  });

  // Control — the branch that does not depend on the row's keys.
  it('a deal with no forecast still offers to create one', async () => {
    await mount(null);
    expect(screen.getByText('No forecast for this deal yet')).toBeTruthy();
    expect(screen.getByText('Create Forecast')).toBeTruthy();
  });
});
