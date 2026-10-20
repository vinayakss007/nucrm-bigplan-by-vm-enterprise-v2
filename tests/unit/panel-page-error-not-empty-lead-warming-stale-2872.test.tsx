// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `app/tenant/ai/lead-warming/page.tsx`, which has three reads and used to judge
 * each of them by one error flag: `/stats` (six cards), `/campaigns` (the tab counter and
 * the list with the pause/archive buttons), `/replies?limit=50` (its tab counter, the
 * intent pills, and the list).
 *
 * Pause or archive a campaign and both mutations call `loadData()`, which invalidates
 * `['tenant','lead-warming']` — a prefix, so all three reads reload. If that reload is
 * refused, TanStack Query hands the page back the payload it already had, and the page
 * behaved as though it had nothing: "Campaigns (—)" over the two campaigns whose rows were
 * still on screen, "Replies (—)" over the replies the pills were counting, the pills
 * themselves gone, and three outage cards telling the operator the warming data could not
 * be loaded at all. #2829 fixed the read-that-never-answered half of that and this slice
 * keeps it: the outage copy, the dashes and the hidden lists are exactly right when there
 * is nothing to keep.
 *
 * `filter` here is client-side — it is not part of any query key the way the SMS status
 * chips are — so no view on this page can be "never answered" while another one is fine.
 * That is what the pills case below is checking: under a kept read the pills stay, and
 * picking one still filters the replies on screen.
 *
 * `scripts/check-panel-error-state.mjs` reports this file clean both before and after the
 * split is rewound, which is the point of the anti-vacuity case: the sweep asks whether a
 * panel binds an error and renders a banner, and all three reads did that already.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import type { ReactNode } from 'react';

type QueryResult = {
  data?: unknown;
  error: Error | null;
  isLoading: boolean;
  refetch: ReturnType<typeof vi.fn>;
};

/** url → the result the page should see for that read. */
const registry = vi.hoisted(() => ({ byUrl: {} as Record<string, QueryResult> }));

vi.mock('@/lib/query/client', () => ({
  useApiQuery: (_key: unknown, url: string) =>
    registry.byUrl[url] ?? { data: undefined, error: null, isLoading: false, refetch: vi.fn() },
}));
vi.mock('@/components/lead-warming/campaign-builder', () => ({ CampaignBuilder: () => null }));
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import LeadWarmingPage from '@/app/tenant/ai/lead-warming/page';

const STATS = '/api/tenant/lead-warming/stats';
const REPLIES = '/api/tenant/lead-warming/replies?limit=50';
const CAMPAIGNS = '/api/tenant/lead-warming/campaigns';

const NOW = '2026-03-04T10:00:00.000Z';
const warmingStats = {
  campaigns: { total: 2, active: 1 },
  messages: { total: 40, sent: 40, queued: 0, failed: 0, emailCount: 30, whatsappCount: 10 },
  replies: {
    total: 6, interested: 3, notInterested: 1, askLater: 1, question: 1,
    positiveSocial: 0, unsubscribe: 0, replyRate: 15, positiveRate: 50,
  },
};
const replyRows = {
  data: [
    { id: 'r1', channel: 'email', replyContent: 'Sounds good, tell me more.', receivedAt: NOW, intent: 'interested', intentConfidence: 0.9, sentiment: 'positive', sentimentScore: 0.7, aiSummary: 'Wants the deck', aiSuggestedAction: 'Send pricing', requiresFollowUp: true, contactName: 'Priya Nair' },
    { id: 'r2', channel: 'whatsapp', replyContent: 'One question about timing.', receivedAt: NOW, intent: 'question', intentConfidence: 0.6, sentiment: 'neutral', sentimentScore: 0.1, aiSummary: 'Asked when', aiSuggestedAction: 'Answer the date', requiresFollowUp: false, contactName: 'Sam Iyer' },
    { id: 'r3', channel: 'email', replyContent: 'Yes, count us in.', receivedAt: NOW, intent: 'interested', intentConfidence: 0.8, sentiment: 'positive', sentimentScore: 0.6, aiSummary: 'Confirmed', aiSuggestedAction: 'Book a call', requiresFollowUp: false, contactName: 'Dana Reyes' },
  ],
};
const campaignRows = {
  data: [
    { id: 'c1', name: 'Diwali warm-up', description: null, status: 'active', enableEmail: true, enableWhatsapp: false, enableSms: false, aiGenerateMessages: true, aiTone: 'friendly', totalSent: 40, totalReplies: 6, totalPositiveIntent: 3, createdAt: NOW },
    { id: 'c2', name: 'New year note', description: null, status: 'paused', enableEmail: true, enableWhatsapp: true, enableSms: false, aiGenerateMessages: false, aiTone: 'warm', totalSent: 12, totalReplies: 2, totalPositiveIntent: 1, createdAt: NOW },
  ],
};

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(),
});
/** Answered before, this refresh did not. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');
/** Six StatCards share this shape: `<span class="truncate">label</span>` + `p.text-2xl`. */
const statValue = (label: string): string => {
  const spans = [...document.querySelectorAll('span.truncate')].filter((el) => el.textContent === label);
  expect(spans.length, `expected one "${label}" stat label, saw ${spans.length}`).toBe(1);
  const value = spans[0].parentElement?.parentElement?.querySelector('p[class*="text-2xl"]');
  expect(value, `the "${label}" card lost its number`).not.toBeNull();
  return value!.textContent ?? '';
};
const tabCount = (which: 'Campaigns' | 'Replies') =>
  screen.getByText(new RegExp(`^${which} \\(`)).textContent ?? '';

const allThreeOk = () => ({
  [STATS]: ok(warmingStats),
  [REPLIES]: ok(replyRows),
  [CAMPAIGNS]: ok(campaignRows),
});

const tree = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
    {node}
  </QueryClientProvider>
);
const wrapped = (node: ReactNode) => {
  cleanup();
  return render(tree(node));
};
const openReplies = () => {
  wrapped(<LeadWarmingPage />);
  fireEvent.click(screen.getByRole('button', { name: /^Replies \(/ }));
};
const openCampaigns = () => wrapped(<LeadWarmingPage />);

describe('lead-warming: a refused reload after a write keeps the six figures (#2872)', () => {
  beforeEach(() => { registry.byUrl = { ...allThreeOk(), [STATS]: staleRead(warmingStats) }; vi.clearAllMocks(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('keeps all six stat cards counting and says they are the last read', () => {
    openCampaigns();
    expect(statValue('Messages (30d)')).toBe('40');
    expect(statValue('Replies')).toBe('6');
    expect(statValue('Interested')).toBe('3');
    expect(statValue('Ask Later')).toBe('1');
    expect(statValue('Reply Rate')).toBe('15%');
    expect(statValue('Positive Rate')).toBe('50%');
    expect(alerts()).toMatch(/last read/i);
    expect(alerts()).toMatch(/Request failed \(504\)/);
  });

  it('does not tell the operator the stats could not be loaded when they are on screen', () => {
    openCampaigns();
    expect(alerts()).not.toMatch(/Failed to load your warming stats/);
  });

  it('names the server when the refusal arrives without a message', () => {
    registry.byUrl = { ...allThreeOk(), [STATS]: staleRead(warmingStats, '') };
    wrapped(<LeadWarmingPage />);
    expect(alerts()).toMatch(/no response from the server/);
    expect(statValue('Messages (30d)')).toBe('40');
  });

  it('re-runs the stats read from the caveat, not the two reads beside it', () => {
    wrapped(<LeadWarmingPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[STATS].refetch).toHaveBeenCalledTimes(1);
    expect(registry.byUrl[CAMPAIGNS].refetch).not.toHaveBeenCalled();
    expect(registry.byUrl[REPLIES].refetch).not.toHaveBeenCalled();
  });

  it('still shows the outage for a stats read that never answered', () => {
    registry.byUrl = { ...allThreeOk(), [STATS]: failed('Request failed (503)') };
    wrapped(<LeadWarmingPage />);
    expect(screen.queryByText('Messages (30d)')).toBeNull();
    expect(alerts()).toMatch(/Failed to load your warming stats: Request failed \(503\)/);
    expect(alerts()).not.toMatch(/last read/);
  });
});

describe('lead-warming: campaigns keep their rows and their counter (#2872)', () => {
  beforeEach(() => { registry.byUrl = { ...allThreeOk(), [CAMPAIGNS]: staleRead(campaignRows) }; vi.clearAllMocks(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('keeps "Campaigns (2)" and both campaigns after a refused reload', () => {
    wrapped(<LeadWarmingPage />);
    expect(tabCount('Campaigns')).toBe('Campaigns (2)');
    expect(screen.getByText('Diwali warm-up')).toBeTruthy();
    expect(screen.getByText('New year note')).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
  });

  it('keeps the pause and archive buttons of the rows it is still showing', () => {
    wrapped(<LeadWarmingPage />);
    expect(screen.getAllByTitle(/Pause|Activate/).length).toBe(2);
    expect(screen.getAllByTitle('Archive').length).toBe(2);
  });

  it('dashes the counter and shows the outage for a read that never answered', () => {
    registry.byUrl = { ...allThreeOk(), [CAMPAIGNS]: failed('Request failed (503)') };
    wrapped(<LeadWarmingPage />);
    expect(tabCount('Campaigns')).toBe('Campaigns (—)');
    expect(screen.queryByText('Diwali warm-up')).toBeNull();
    expect(alerts()).toMatch(/Failed to load your warming campaigns: Request failed \(503\)/);
    expect(screen.queryByText(/No campaigns yet/)).toBeNull();
  });

  it('says none exist, with a real zero and no alert, when that is what came back', () => {
    registry.byUrl = { ...allThreeOk(), [CAMPAIGNS]: ok({ data: [] }) };
    wrapped(<LeadWarmingPage />);
    expect(tabCount('Campaigns')).toBe('Campaigns (0)');
    expect(screen.getByText(/No campaigns yet/)).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('still says none exist when the empty list is all the last read has', () => {
    registry.byUrl = { ...allThreeOk(), [CAMPAIGNS]: staleRead({ data: [] }) };
    wrapped(<LeadWarmingPage />);
    expect(tabCount('Campaigns')).toBe('Campaigns (0)');
    expect(screen.getByText(/No campaigns yet/)).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
  });
});

describe('lead-warming: replies keep their pills and their rows (#2872)', () => {
  beforeEach(() => { registry.byUrl = { ...allThreeOk(), [REPLIES]: staleRead(replyRows) }; vi.clearAllMocks(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('keeps the counter, the rows and the pills that count them', () => {
    openReplies();
    expect(tabCount('Replies')).toBe('Replies (3)');
    expect(screen.getByText('Sounds good, tell me more.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^All/ }).textContent).toContain('3');
    expect(screen.getByRole('button', { name: /^Interested/ }).textContent).toContain('2');
    expect(alerts()).toMatch(/last read/i);
  });

  it('still filters the replies it kept when the refresh was refused', () => {
    openReplies();
    fireEvent.click(screen.getByRole('button', { name: /^Interested/ }));
    expect(screen.getByText('Sounds good, tell me more.')).toBeTruthy();
    expect(screen.getByText('Yes, count us in.')).toBeTruthy();
    expect(screen.queryByText('One question about timing.')).toBeNull();
  });

  it('hides the pills and dashes the counter for a read that never answered', () => {
    registry.byUrl = { ...allThreeOk(), [REPLIES]: failed('Request failed (503)') };
    openReplies();
    expect(tabCount('Replies')).toBe('Replies (—)');
    expect(screen.queryByRole('button', { name: /^Interested/ })).toBeNull();
    expect(alerts()).toMatch(/Failed to load warming replies: Request failed \(503\)/);
    expect(screen.queryByText(/No replies found/)).toBeNull();
  });

  it('says none have arrived, with a real zero and no alert, when that is what came back', () => {
    registry.byUrl = { ...allThreeOk(), [REPLIES]: ok({ data: [] }) };
    openReplies();
    expect(tabCount('Replies')).toBe('Replies (0)');
    expect(screen.getByText(/No replies found/)).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('still says none have arrived when the empty list is all the last read has', () => {
    registry.byUrl = { ...allThreeOk(), [REPLIES]: staleRead({ data: [] }) };
    openReplies();
    expect(tabCount('Replies')).toBe('Replies (0)');
    expect(screen.getByText(/No replies found/)).toBeTruthy();
    // The caveat is what separates "none have arrived" from "I could not check".
    expect(alerts()).toMatch(/last read/i);
  });
});

describe('the guard cannot see this class, so these assertions do (#2872)', () => {
  const ROOT = process.cwd();
  const FILE = 'app/tenant/ai/lead-warming/page.tsx';
  const src = () => readFileSync(join(ROOT, FILE), 'utf8');

  it('splits all three reads instead of branching on one flag each', () => {
    const s = src();
    for (const name of ['stats', 'campaigns', 'replies']) {
      expect(s, `${name} never learned the difference`).toMatch(new RegExp(`Boolean\\(${name}Error\\) && !${name}Data`));
      expect(s).toMatch(new RegExp(`Boolean\\(${name}Error\\) && Boolean\\(${name}Data\\)`));
      expect(s).toMatch(new RegExp(`${name}Error\\?\\.message \\|\\| 'no response from the server'`));
    }
  });

  it('never dashes a counter or hides a list on the bare flag', () => {
    const s = src();
    expect(s, 'the tab counters still punish a kept read').not.toMatch(/\w*[Ee]rror \? '—'/);
    expect(s, 'a list still replaces kept rows with the outage card').not.toMatch(/\)\s*:\s*\w*[Ee]rror \? \(/);
    expect(s, 'the intent pills still vanish over a kept read').not.toMatch(/\{!repliesError && \(/);
    for (const name of ['stats', 'campaigns', 'replies']) {
      expect(s).toMatch(new RegExp(`\\{${name}Stale && \\(`));
    }
  });

  it('reports the page clean before and after the split is taken back out', async () => {
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    const rewinds: [string, string][] = [
      [/const statsFailed = Boolean\(statsError\) && !statsData;\s*\n\s*const statsStale = Boolean\(statsError\) && Boolean\(statsData\);/,
       'const statsFailed = Boolean(statsError);'],
      [/\{!repliesFailed && \(/, '{!repliesError && ('],
    ];
    for (const [pattern, replacement] of rewinds) {
      const s = src();
      expect(s, `the shape this slice depends on moved: ${pattern}`).toMatch(pattern);
      expect(inspect(FILE, s).offends, `${FILE} was already on the guard's list`).toBe(false);
      expect(
        inspect(FILE, s.replace(pattern, replacement)).offends,
        `the guard would catch this rewind after all: ${replacement}`,
      ).toBe(false);
    }
  });

  it('keeps the baseline shrink-only and the sweep green', () => {
    const files = Object.keys(JSON.parse(readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8')).files);
    expect(files.length, 'a ceiling, not a count').toBeLessThanOrEqual(3);
    expect(files, 'lead-warming went back on the list it was never on').not.toContain(FILE);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });

  it('keeps the file inside the size ceiling', () => {
    expect(src().split('\n').length, 'past the 500-line ceiling').toBeLessThanOrEqual(500);
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
