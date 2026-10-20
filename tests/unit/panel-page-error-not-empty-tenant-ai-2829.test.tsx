// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2829, next slice — the five `app/tenant/ai/*` panels that are in the baseline.
 *
 * These are a worse case than the list pages, not a different one. A list page that fails
 * says "there are none". An AI panel that fails says **"nothing needs your attention"** —
 * which is the sentence the page exists to earn, and the one nobody reads as a bug:
 *
 *   - `at-risk` prints a green tick, a headline **"Pipeline Healthy"** and "No deals
 *     currently match your at-risk criteria. Great job keeping the momentum!" — because the
 *     risk scan is a server-side pass over the pipeline and the read of its result was
 *     refused. `error` was never even bound here. The three cards above it (`Total At-Risk`,
 *     `High Severity`, `Risk Value`) reported `0`, `0` and `$0` of stalled money.
 *   - `lead-scoring` prints "No leads found to score." with a **"Run scoring now"** button
 *     underneath, so the page answers a refused read by inviting the tenant to re-run the
 *     thing that just refused; its three stats are a reduction over the same array.
 *   - `lead-warming` binds no error on any of its three reads: `stats` failing *hides* the
 *     six-number grid, and `campaigns` failing prints "No campaigns yet. Create your first
 *     warming campaign…" — the same instruction-to-duplicate-existing-work shape `offers`
 *     had, on a page whose tabs announce `Campaigns (0)` and `Replies (0)`.
 *   - `activity` and `draft` did bind their failure and did show a red box — a `div` with no
 *     `role`, no retry, gone from a screen reader's attention in the time it takes to read
 *     the sentence next to it. `activity`'s empty row is gated on `data?.rows.length`, which
 *     is honest; its five cost cards were not: `Cost (30d) $0.00` for an unread month.
 *
 * `draft` carries the one judgement call, and it is tested from both sides. Its templates
 * read is admin-only and **404s for everyone else**, and #1328 turned that into `[]` on
 * purpose — for a non-admin "No templates configured" is the truth. So the carve-out is by
 * status, not by "any error": 404 keeps the sentence, anything else becomes a banner. A fix
 * that swept the 404 into the banner would tell every ordinary user their templates are
 * unreachable, which is a different lie.
 *
 * Per page: failed read → `role="alert"` naming that failure and the reason, a "Try again"
 * wired to that query's `refetch`, and no absence copy; succeeded-and-empty → the sentence,
 * no alert; rows → the row, no alert.
 *
 * Two directions of the same dishonesty are asserted separately, because each is a distinct
 * edit and each is easy to get backwards:
 *   - a *derived number* must show `—` for an unread list and its **real, true zero** for a
 *     successful one. Suppressing the zero too would lose an answer the endpoint gave.
 *   - a *client-side filter* that matches nothing must stay a filter miss. `at-risk` used to
 *     print "Pipeline Healthy" whenever the filtered array was empty — so typing three
 *     letters in the box told the owner their pipeline was fine. It now says which deals the
 *     filter excluded. `lead-warming`'s intent pills are counts of the replies array, so an
 *     unread inbox hides the pills rather than offering six filters that all answer "none".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { ComponentType, ReactNode } from 'react';

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
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock('@/lib/errors-client', () => ({ logError: vi.fn() }));
vi.mock('@/components/lead-warming/campaign-builder', () => ({
  CampaignBuilder: () => null,
}));

import AtRiskPage from '@/app/tenant/ai/at-risk/page';
import ActivityPage from '@/app/tenant/ai/activity/page';
import DraftPage from '@/app/tenant/ai/draft/page';
import LeadScoringPage from '@/app/tenant/ai/lead-scoring/page';
import LeadWarmingPage from '@/app/tenant/ai/lead-warming/page';

/** The URL each page builds, verbatim — a drift here fails the test for the right reason. */
const URLS = {
  atRisk: '/api/tenant/ai/at-risk',
  activity: '/api/tenant/ai/activity?page=1&pageSize=25',
  templates: '/api/tenant/admin/ai-templates',
  leads: '/api/tenant/leads?sort_by=score&sort_order=DESC&limit=100',
  stats: '/api/tenant/lead-warming/stats',
  replies: '/api/tenant/lead-warming/replies?limit=50',
  campaigns: '/api/tenant/lead-warming/campaigns',
} as const;

const NOW = new Date().toISOString();

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message = 'Request failed (500) — RLS refused the read', status = 500): QueryResult & {
  error: Error & { status?: number };
} => {
  const error = Object.assign(new Error(message), { name: 'ApiQueryError', status });
  return { data: undefined, error, isLoading: false, refetch: vi.fn() };
};

const DEALS = [
  {
    id: 'deal-1',
    title: 'Acme renewal',
    amount: '18000',
    stageName: 'Negotiation',
    contactName: 'Dana Reyes',
    companyName: 'Acme',
    atRisk: { reasons: ['No activity in 34 days'], severity: 'high', idleDays: 34, stageDays: 21, currentSentiment: 22 },
  },
  {
    id: 'deal-2',
    title: 'Bolt expansion',
    amount: '7000',
    stageName: 'Proposal',
    contactName: 'Sam Iyer',
    companyName: 'Bolt',
    atRisk: { reasons: ['Sentiment dropping'], severity: 'medium', idleDays: 9, stageDays: 12, currentSentiment: 48 },
  },
];

const ACTIVITY_ROW = {
  id: 'call-1', action: 'summarize', provider: 'openai', model: 'gpt-4o', status: 'success',
  tokens_in: 900, tokens_out: 210, tokens_used: 1110, cost_cents: 42, latency_ms: 880,
  entity_type: 'deal', entity_id: 'deal-1', error_message: null, accepted: true,
  created_at: NOW, user_id: 'u-1', user_name: 'Dana Reyes', user_email: 'dana@acme.test',
};
const ACTIVITY_SUMMARY = {
  total_calls: 37, total_tokens: 12345, total_cost_cents: 812,
  success_calls: 35, accepted_calls: 9, rated_calls: 12,
};

const TEMPLATE = {
  id: 'tpl-1', slug: 'quarterly-checkin', name: 'Quarterly check-in',
  description: 'A short note to a customer', kind: 'email' as const, seed: false,
};

const LEAD = {
  id: 'lead-1', firstName: 'Priya', lastName: 'Nair', email: 'priya@bolt.test',
  companyName: 'Bolt', score: 91, leadStatus: 'new', lastScoredAt: NOW,
};

const WARMING_STATS = {
  campaigns: { total: 1, active: 1 },
  messages: { total: 40, sent: 40, queued: 0, failed: 0, emailCount: 30, whatsappCount: 10 },
  replies: {
    total: 6, interested: 3, notInterested: 1, askLater: 1, question: 1,
    positiveSocial: 0, unsubscribe: 0, replyRate: 15, positiveRate: 50,
  },
};
const WARMING_REPLY = {
  id: 'rep-1', channel: 'email', replyContent: 'Sounds good, tell me more.', receivedAt: NOW,
  intent: 'interested', intentConfidence: 0.9, sentiment: 'positive', sentimentScore: 0.7,
  aiSummary: 'Wants details', aiSuggestedAction: 'Send the deck', requiresFollowUp: true,
  contactName: 'Priya Nair',
};
const WARMING_CAMPAIGN = {
  id: 'camp-1', name: 'Diwali warm-up', description: null, status: 'active',
  enableEmail: true, enableWhatsapp: false, enableSms: false, aiGenerateMessages: true,
  aiTone: 'friendly', totalSent: 40, totalReplies: 6, totalPositiveIntent: 3, createdAt: NOW,
};

/** The payload each page sees when the read answered and the answer was "none". */
const EMPTY: Record<string, unknown> = {
  atRisk: { data: [] },
  activity: { rows: [], pagination: { page: 1, pageSize: 25, total: 0, pageCount: 0 }, summary_30d: {
    total_calls: 0, total_tokens: 0, total_cost_cents: 0, success_calls: 0, accepted_calls: 0, rated_calls: 0,
  } },
  templates: { templates: [], seeds: [] },
  leads: { data: [] },
  stats: WARMING_STATS,
  replies: { data: [] },
  campaigns: { data: [] },
};
const ROWS: Record<string, unknown> = {
  atRisk: { data: [DEALS[0]] },
  activity: { rows: [ACTIVITY_ROW], pagination: { page: 1, pageSize: 25, total: 1, pageCount: 1 }, summary_30d: ACTIVITY_SUMMARY },
  templates: { templates: [TEMPLATE], seeds: [] },
  leads: { data: [LEAD] },
  stats: WARMING_STATS,
  replies: { data: [WARMING_REPLY] },
  campaigns: { data: [WARMING_CAMPAIGN] },
};

/** Load every read the page makes with `payloads`, failing `failUrl` if given. */
function withFailure(pages: string[], failUrl?: string, payloads: Record<string, unknown> = {}) {
  for (const p of pages) {
    const url = URLS[p as keyof typeof URLS];
    registry.byUrl[url] = failUrl && url === failUrl
      ? failed()
      : ok(payloads[p] ?? EMPTY[p]);
  }
}

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

type Panel = {
  key: string;
  Page: ComponentType;
  pages: string[];
  failUrl: string;
  /** the words the alert has to contain, naming this specific read */
  phrase: string;
  /** the sentence the page prints when there genuinely are none */
  sentence: string;
  /** something only a real row puts on screen */
  rowText: string;
};

const PANELS: Panel[] = [
  {
    key: 'at-risk', Page: AtRiskPage, pages: ['atRisk'], failUrl: URLS.atRisk,
    phrase: 'Failed to check your pipeline for at-risk deals',
    sentence: 'No deals currently match your at-risk criteria',
    rowText: 'Acme renewal',
  },
  {
    key: 'activity', Page: ActivityPage, pages: ['activity'], failUrl: URLS.activity,
    phrase: 'Failed to load AI activity',
    sentence: 'No AI activity yet',
    rowText: 'summarize',
  },
  {
    key: 'draft', Page: DraftPage, pages: ['templates'], failUrl: URLS.templates,
    phrase: 'Failed to load your AI templates',
    sentence: 'No templates configured',
    rowText: 'Quarterly check-in',
  },
  {
    key: 'lead-scoring', Page: LeadScoringPage, pages: ['leads'], failUrl: URLS.leads,
    phrase: 'Failed to load your scored leads',
    sentence: 'No leads found to score',
    rowText: 'Priya',
  },
  {
    key: 'lead-warming', Page: LeadWarmingPage,
    pages: ['stats', 'replies', 'campaigns'], failUrl: URLS.campaigns,
    phrase: 'Failed to load your warming campaigns',
    sentence: 'No campaigns yet',
    rowText: 'Diwali warm-up',
  },
];

beforeEach(() => {
  registry.byUrl = {};
});

describe.each(PANELS)('$key: a refused read is not an answer about the data', ({ Page, pages, failUrl, phrase, sentence, rowText }) => {
  it('names the failure, and does not print the absence sentence', () => {
    withFailure(pages, failUrl);
    wrap(<Page />);

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain(phrase);
    // the reason the read failed, not just that it did
    expect(alert.textContent).toContain('Request failed (500)');
    expect(document.body.textContent).not.toContain(sentence);
  });

  it('gives a "Try again" bound to that query', () => {
    withFailure(pages, failUrl);
    wrap(<Page />);

    const state = registry.byUrl[failUrl];
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(state!.refetch).toHaveBeenCalled();
  });

  it('prints the sentence when the read answered and there genuinely are none', () => {
    withFailure(pages);
    wrap(<Page />);

    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.body.textContent).toContain(sentence);
  });

  it('prints the row and no alert when the read answered with rows', () => {
    for (const p of pages) registry.byUrl[URLS[p as keyof typeof URLS]] = ok(ROWS[p]);
    wrap(<Page />);

    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.body.textContent).toContain(rowText);
    expect(document.body.textContent).not.toContain(sentence);
  });
});

describe('the numbers a failed read used to compute', () => {
  it('at-risk: three cards read "—" when the scan is unread, and real values when it is not', () => {
    withFailure(['atRisk'], URLS.atRisk);
    const { unmount } = wrap(<AtRiskPage />);
    expect(screen.getByRole('alert')).toBeTruthy();
    // `$0 of stalled pipeline` is the version of "everyone paid" that ends a quarter.
    expect(screen.getAllByText('—')).toHaveLength(3);
    expect(document.body.textContent).not.toContain('$0');
    expect(document.body.textContent).not.toContain('Pipeline Healthy');
    unmount();

    registry.byUrl = {};
    withFailure(['atRisk'], undefined, { atRisk: { data: DEALS } });
    wrap(<AtRiskPage />);
    expect(screen.getByText('2')).toBeTruthy();            // Total At-Risk
    expect(screen.getByText('1')).toBeTruthy();            // High Severity
    expect(document.body.textContent).toContain('25,000'); // Risk Value, both deals
  });

  it('lead-scoring: the three stat cards do not average an unread queue to zero', () => {
    withFailure(['leads'], URLS.leads);
    const { unmount } = wrap(<LeadScoringPage />);
    expect(screen.getAllByText('—')).toHaveLength(3);
    expect(document.body.textContent).not.toContain('No leads found to score');
    unmount();

    registry.byUrl = {};
    withFailure(['leads'], undefined, { leads: { data: [LEAD] } });
    wrap(<LeadScoringPage />);
    // the card and the card's own ring both print it
    expect(screen.getAllByText('91').length).toBeGreaterThan(0);
  });

  it('lead-scoring: a lead whose score is genuinely null still counts as a zero, not a dash', () => {
    withFailure(['leads'], undefined, {
      leads: { data: [{ ...LEAD, score: null }] },
    });
    wrap(<LeadScoringPage />);
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('activity: cost, tokens and calls report unread rather than free', () => {
    withFailure(['activity'], URLS.activity);
    const { unmount } = wrap(<ActivityPage />);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
    expect(document.body.textContent).not.toContain('$0.00');
    unmount();

    registry.byUrl = {};
    withFailure(['activity'], undefined, { activity: ROWS.activity });
    wrap(<ActivityPage />);
    expect(screen.getByText('37')).toBeTruthy();
    expect(screen.getByText('12,345')).toBeTruthy();
  });

  it('lead-warming: the tab counts say "—" for the read that failed and a number for the one that did not', () => {
    withFailure(['stats', 'replies', 'campaigns'], URLS.campaigns, {
      stats: WARMING_STATS, replies: { data: [WARMING_REPLY] },
    });
    const { unmount } = wrap(<LeadWarmingPage />);
    expect(document.body.textContent).toContain('Campaigns (—)');
    expect(document.body.textContent).toContain('Replies (1)');
    expect(screen.getByRole('alert').textContent).toContain('Failed to load your warming campaigns');
    unmount();

    registry.byUrl = {};
    withFailure(['stats', 'replies', 'campaigns'], undefined, {
      stats: WARMING_STATS, replies: { data: [WARMING_REPLY] }, campaigns: { data: [WARMING_CAMPAIGN] },
    });
    wrap(<LeadWarmingPage />);
    expect(document.body.textContent).toContain('Campaigns (1)');
    expect(document.body.textContent).toContain('Replies (1)');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('lead-warming: a failed stats read replaces the grid instead of hiding it', () => {
    withFailure(['stats', 'replies', 'campaigns'], URLS.stats, {
      replies: { data: [WARMING_REPLY] }, campaigns: { data: [WARMING_CAMPAIGN] },
    });
    wrap(<LeadWarmingPage />);
    expect(screen.getByRole('alert').textContent).toContain('Failed to load your warming stats');
    // the six numbers are gone, and "gone" is announced, not silent
    expect(document.body.textContent).not.toContain('Reply Rate');
  });

  it('lead-warming: an unread inbox hides the intent pills instead of offering six filters that all answer "none"', () => {
    withFailure(['stats', 'replies', 'campaigns'], URLS.replies, {
      stats: WARMING_STATS, campaigns: { data: [WARMING_CAMPAIGN] },
    });
    wrap(<LeadWarmingPage />);
    fireEvent.click(screen.getByRole('button', { name: /replies/i }));

    expect(screen.getByRole('alert').textContent).toContain('Failed to load warming replies');
    expect(document.body.textContent).not.toContain('No replies found');
    expect(screen.queryByRole('button', { name: /^all/i })).toBeNull();
  });
});

describe('the two filter cases that must not become an outage', () => {
  it('at-risk: a filter that matches nothing is a filter miss, not "Pipeline Healthy"', () => {
    withFailure(['atRisk'], undefined, { atRisk: { data: DEALS } });
    wrap(<AtRiskPage />);

    fireEvent.change(screen.getByPlaceholderText(/filter by deal/i), { target: { value: 'zzzz' } });

    expect(document.body.textContent).not.toContain('Pipeline Healthy');
    expect(document.body.textContent).toMatch(/No deals match/);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('at-risk: an empty pipeline with no filter typed still says the pipeline is healthy', () => {
    withFailure(['atRisk']);
    wrap(<AtRiskPage />);
    expect(document.body.textContent).toContain('Pipeline Healthy');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('lead-warming: an intent filter with no rows keeps the replies list, and the failure is not involved', () => {
    withFailure(['stats', 'replies', 'campaigns'], undefined, {
      stats: WARMING_STATS,
      replies: { data: [{ ...WARMING_REPLY, intent: 'question' }] },
      campaigns: { data: [WARMING_CAMPAIGN] },
    });
    wrap(<LeadWarmingPage />);
    fireEvent.click(screen.getByRole('button', { name: /replies/i }));
    fireEvent.click(screen.getByRole('button', { name: /question/i }));

    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.body.textContent).not.toContain('No replies found');
  });

  it('activity: filters ride in the query string, so a no-match page is a real page, not a lie', () => {
    // The row set here is what the server answered for `status=error`: nothing. The page is
    // allowed to say so, and that is the branch the settings slice kept honest too.
    withFailure(['activity']);
    wrap(<ActivityPage />);
    expect(document.body.textContent).toContain('No AI activity yet');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('draft: the 404 that is a real answer, and the 500 that is not', () => {
  it('an admin-only 404 keeps the "no templates configured" copy (the #1328 carve-out)', () => {
    registry.byUrl[URLS.templates] = failed('Request failed (404)', 404);
    wrap(<DraftPage />);

    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.body.textContent).toContain('No templates configured');
  });

  it('any other refusal becomes an alert and stops telling the tenant to add a template they have', () => {
    registry.byUrl[URLS.templates] = failed('Request failed (500) — pool down', 500);
    wrap(<DraftPage />);

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Failed to load your AI templates');
    expect(alert.textContent).toContain('pool down');
    expect(document.body.textContent).not.toContain('No templates configured');

    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[URLS.templates]!.refetch).toHaveBeenCalled();
  });

  it('lists the tenant\'s templates when the read answers', () => {
    registry.byUrl[URLS.templates] = ok({ templates: [TEMPLATE], seeds: [] });
    wrap(<DraftPage />);

    expect(screen.getByText('Quarterly check-in')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('the baseline decays, and the guards still pass', () => {
  const root = process.cwd();

  it('the panel guard exits clean with these five paths removed', () => {
    const r = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: root, encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).not.toContain('no longer offends');
  });

  it('drops exactly the five AI panels and leaves the ones still outstanding', () => {
    const doc = JSON.parse(readFileSync(`${root}/scripts/panel-error-state-baseline.json`, 'utf8'));
    const files = doc.files ?? doc;
    for (const p of ['activity', 'at-risk', 'draft', 'lead-scoring', 'lead-warming']) {
      expect(files[`app/tenant/ai/${p}/page.tsx`]).toBeUndefined();
    }
    expect(Object.keys(files).filter(k => k.startsWith('app/tenant/ai/'))).toEqual([]);
    // The anti-vacuity screen that actually holds is the guard case above — exit 0 *and* no
    // "no longer offends" notes, which a sweep that silently found nothing cannot do: its whole
    // allowlist would be reported as stale. The names below are belt-and-braces, so they are
    // only ever paths no slice in flight is removing: `superadmin/modules` is claimed by #2856
    // and `reports/custom` by the reports slice, and a path that gets fixed before this merges
    // would fail a test about the AI panels for no reason.
    for (const stillOwed of [
      'app/tenant/chat/page.tsx', 'app/tenant/emails/page.tsx',
    ]) {
      expect(Object.keys(files)).toContain(stillOwed);
    }
    // 44 on `e89f86e8`, 24 on the main this slice merges into, 19 with these five gone.
    // A ceiling, never an equality: #2856 and the reports slice each drop the number further.
    expect(Object.keys(files).length).toBeLessThanOrEqual(19);
  });

  it('every page in this slice renders a role="alert" the guard can see', () => {
    for (const p of ['activity', 'at-risk', 'draft', 'lead-scoring', 'lead-warming']) {
      const src = readFileSync(`${root}/app/tenant/ai/${p}/page.tsx`, 'utf8');
      expect(src).toMatch(/InlineErrorState/);
    }
  });

  it('keeps the file-size guard green', () => {
    const r = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: root, encoding: 'utf8' });
    expect(r.status).toBe(0);
  });
});
