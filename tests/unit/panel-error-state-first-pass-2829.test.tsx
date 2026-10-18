// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2829 (first pass) — five operational panels must not answer "you have none" when the
 * read failed, and the sweep that found them has to stay red for anything new.
 *
 * Each of these reads `{ data, isLoading }` from `useApiQuery`, never bound the failure, and
 * rendered a sentence ABOUT THE TENANT'S DATA when the array came back empty. A 500, an RLS
 * refusal (42501), a dead pool or a missing column therefore all read as "there are none",
 * which on these five is an operational all-clear, not a cosmetic glitch:
 *
 *   settings/backup    "No backups yet — run your first backup"  → a failed GET reports the
 *                                                                  tenant was never backed up
 *   settings/sessions  "No sessions found"                       → "who is logged in as me"
 *                                                                  answers nobody
 *   settings/api-keys  "No API keys yet"                         → live credentials vanish and
 *                                                                  the create button next to
 *                                                                  the sentence invites a
 *                                                                  duplicate
 *   webhooks/dlq       "No dead letter entries"                  → the backlog disappears
 *                                                                  exactly when the endpoint is
 *                                                                  unhealthy
 *   trash              "Trash is empty"                          → records past retention stay
 *                                                                  pending deletion while the
 *                                                                  panel says there is nothing
 *
 * The shape of the fix is not new design. #2231 shipped the compact `role="alert"` banner
 * (`components/shared/inline-error-state.tsx`) and its three call sites already distinguish
 * failure from emptiness; `app/tenant/settings/rbac/page.tsx:227`,
 * `app/superadmin/selective-restore/page.tsx:469` and `app/superadmin/token-control/page.tsx:293`
 * each spell out, in prose they typed by hand, that an empty list would mean something
 * different. This PR makes that written-once (`FAILED_IS_NOT_EMPTY`, an opt-in second line — the
 * #2231 sites show stale rows, not an empty state, so they keep their own wording) and applies
 * the distinction to the five panels that lacked it.
 *
 * The cases assert the DISTINCTION, not the wording: failed → `role="alert"` present and the
 * sentence absent; succeeded-and-empty → the sentence and no alert; rows → the row text and no
 * alert. #2829 calls a per-panel retry button out of scope, so no case clicks one: `onRetry` here
 * is the "Try again" the shipped component already renders when a reload is passed to it — the
 * same call #2231's three sites make, and what `guard:panel-errors` itself tells a new offender
 * to bind — so nothing new is designed.
 *
 * The last block runs the guard itself against a synthetic tree, because a sweep that quietly
 * matched nothing would be indistinguishable from a clean app — that is the failure mode every
 * ratchet in this repo has to be tested against, not just the code.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock('@/components/ui/confirm-dialog', () => ({
  confirmThen: (_message: string, fn: () => unknown) => fn(),
}));

import TrashPage from '@/app/tenant/trash/page';
import ApiKeysPage from '@/app/tenant/settings/api-keys/page';
import SessionsPage from '@/app/tenant/settings/sessions/page';
import DlqPage from '@/app/tenant/settings/webhooks/dlq/page';
import BackupPage from '@/app/tenant/settings/backup/page';

const URLS = {
  trash: '/api/tenant/trash',
  apiKeys: '/api/tenant/api-keys',
  sessions: '/api/user/sessions',
  dlq: '/api/tenant/webhooks/dlq?page=1&limit=20',
  backup: '/api/tenant/backup',
} as const;

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
const failed = (message: string): QueryResult => ({
  data: undefined,
  error: new Error(message),
  isLoading: false,
  refetch: vi.fn(),
});

function mount(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  registry.byUrl = {};
});

/** What each panel renders when the read genuinely came back with nothing. */
const CASES: {
  name: string;
  url: keyof typeof URLS;
  page: () => ReactNode;
  emptyCopy: RegExp;
  row: Record<string, unknown>;
  rowCopy: RegExp;
}[] = [
  {
    name: 'Trash',
    url: 'trash',
    page: () => <TrashPage />,
    emptyCopy: /Trash is empty/,
    row: { id: 'a1', name: 'Wiped Contact', resource_type: 'contact', deleted_at: new Date().toISOString(), days_remaining: 4 },
    rowCopy: /Wiped Contact/,
  },
  {
    name: 'API keys',
    url: 'apiKeys',
    page: () => <ApiKeysPage />,
    emptyCopy: /No API keys yet/,
    row: { id: 'k1', name: 'Integration key', key_prefix: 'nucrm_live_9f', created_at: new Date().toISOString() },
    rowCopy: /Integration key/,
  },
  {
    name: 'Active sessions',
    url: 'sessions',
    page: () => <SessionsPage />,
    emptyCopy: /No sessions found/,
    row: { id: 's1', user_agent: 'Mozilla/5.0 (X11) Chrome/126 Safari/537.36', ip_address: '203.0.113.9', is_current: false, created_at: new Date().toISOString() },
    rowCopy: /Chrome/,
  },
  {
    name: 'Webhook dead letter queue',
    url: 'dlq',
    page: () => <DlqPage />,
    emptyCopy: /No dead letter entries/,
    row: { id: 'd1', jobType: 'send_webhook', jobId: 'j1', queue: 'webhooks', payload: { url: 'https://example.test' }, errorMessage: 'upstream 502', attempts: 3, maxAttempts: 3, status: 'dead', createdAt: new Date().toISOString() },
    rowCopy: /send_webhook/,
  },
  {
    name: 'Backup history',
    url: 'backup',
    page: () => <BackupPage />,
    emptyCopy: /No backups yet/,
    row: { id: 'b1', backup_type: 'full', status: 'completed', size_bytes: 4_200_000, storage_path: '/srv/nucrm/backup', storage_type: 'local', duration_ms: 1500, error_message: null, initiated_auto: false, created_at: new Date().toISOString(), completed_at: new Date().toISOString() },
    rowCopy: /completed/,
  },
];

describe.each(CASES)('$name panel renders the failure instead of the absence (#2829)', ({ url, page, emptyCopy, row, rowCopy }) => {
  it('says the read failed when the fetch errors', () => {
    registry.byUrl[URLS[url]] = failed('Request failed (500)');
    mount(page());
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Failed to load');
    expect(alert.textContent).toContain('Request failed (500)');
    expect(screen.queryByText(emptyCopy)).toBeNull();
  });

  it('spells out that a failure is not an empty list', () => {
    // The sentence that #2823/#2825 retyped panel by panel is now the banner's default detail,
    // so no future panel can render a bare "Failed to load X" that an operator has to interpret.
    registry.byUrl[URLS[url]] = failed('Request failed (42501)');
    mount(page());
    expect(screen.getByRole('alert').textContent)
      .toContain('An empty list means the endpoint answered successfully with nothing');
  });

  it('still says the sentence when the read succeeded and there are none', () => {
    registry.byUrl[URLS[url]] = ok({ data: [], total: 0, backups: [] });
    mount(page());
    expect(screen.getByText(emptyCopy)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders the rows a successful read returns', () => {
    registry.byUrl[URLS[url]] = ok({ data: [row], total: 1, backups: [row] });
    mount(page());
    expect(screen.getByText(rowCopy)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(emptyCopy)).toBeNull();
  });
});

const PANEL_FALSE_EMPTY = `'use client';
import { useApiQuery } from '@/lib/query/client';
export default function WidgetPage() {
  const { data, isLoading } = useApiQuery<{ data?: { id: string }[] }>(['widgets'], '/api/tenant/widgets');
  const widgets = data?.data ?? [];
  return isLoading ? null : !widgets.length ? (
    <div className="text-center"><p>No widgets yet</p></div>
  ) : <ul>{widgets.map(w => <li key={w.id} />)}</ul>;
}
`;

/** The same panel after this pass's fix: the failure is bound, so the sentence is
 *  reachable only when the read actually came back with nothing. */
const PANEL_FIXURED = `'use client';
import { useApiQuery } from '@/lib/query/client';
import InlineErrorState from '@/components/shared/inline-error-state';
export default function WidgetPage() {
  const { data, isLoading, error, refetch } = useApiQuery<{ data?: { id: string }[] }>(['widgets'], '/api/tenant/widgets');
  const widgets = data?.data ?? [];
  return isLoading ? null : !widgets.length ? (
    error ? <InlineErrorState message="Failed to load widgets" onRetry={refetch} /> : <p>No widgets yet</p>
  ) : <ul>{widgets.map(w => <li key={w.id} />)}</ul>;
}
`;

describe('the false-empty ratchet itself (#2829)', () => {
  const ROOT = process.cwd();
  const SCRIPT = 'scripts/check-panel-error-state.mjs';
  const BASELINE = 'scripts/panel-error-state-baseline.json';
  const dir = mkdtempSync(join(tmpdir(), 'panel-errors-'));

  /** Run the guard against a one-panel tree and `allow` as its baseline, in the exact
   *  shape `--write` emits, so the synthetic run exercises the real reader. */
  const run = (allow: Record<string, unknown>, page = PANEL_FALSE_EMPTY) => {
    mkdirSync(join(dir, 'app/tenant/widget'), { recursive: true });
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    writeFileSync(join(dir, SCRIPT), readFileSync(join(ROOT, SCRIPT), 'utf8'));
    writeFileSync(join(dir, 'app/tenant/widget/page.tsx'), page);
    writeFileSync(join(dir, BASELINE), JSON.stringify({ count: Object.keys(allow).length, panels: allow }));
    return spawnSync('node', [SCRIPT], { cwd: dir, encoding: 'utf8' });
  };

  const WIDGET = { issue: '#2829', sentences: ['No widgets yet'] };

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('fails a panel that renders absence copy without reading the failure', () => {
    const res = run({});
    expect(res.status, res.stdout + res.stderr).toBe(1);
    expect(res.stderr).toContain('app/tenant/widget/page.tsx');
    expect(res.stderr).toContain('No widgets yet');
    // The advice has to name the existing component, not a new one to invent.
    expect(res.stderr).toContain('inline-error-state.tsx');
  });

  it('tolerates the same panel once it is allowlisted, so the ratchet is a ratchet', () => {
    const res = run({ 'app/tenant/widget/page.tsx': WIDGET });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout).toContain('1 allowlisted');
  });

  it('reports an allowlisted entry that no longer matches, so the list only shrinks', () => {
    const res = run({
      'app/tenant/widget/page.tsx': WIDGET,
      'app/gone/never-heard-of/page.tsx': WIDGET,
    });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout).toContain('no longer match the class');
    expect(res.stdout).toContain('app/gone/never-heard-of/page.tsx');
  });

  it('does not count a panel that binds the failure, even with the same sentence', () => {
    // A guard that only looked for the sentence would flag every fixed panel; reading the
    // failure is what takes a file out of the class, so the fixed shape must be green.
    const res = run({}, PANEL_FIXURED);
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout).toContain('0 panel(s) in the class');
  });

  it('is wired into CI and package.json, not just committed as a script', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['guard:panel-errors']).toContain(SCRIPT);
    const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
    expect(ci).toContain('npm run guard:raw-sql && npm run guard:panel-errors');
    // It rides in the adjacent guard step instead of getting its own two lines, because
    // PREPROD-ISSUE-REGISTER.md cites `ci.yml` BY LINE NUMBER (three entries do, and three
    // open PRs are editing that register right now). A new step shifts those citations and
    // fails `guard:coords` in CI — that is the tax #2539's step levied and #2566 had to
    // re-pin. So the assertion here is the guard that would catch the shift: anyone who
    // later gives this its own step must re-pin those three citations in the same PR, the
    // way #2566 did.
    const coords = spawnSync('node', ['scripts/check-register-coords.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(coords.status, coords.stdout + coords.stderr).toBe(0);
  });

  it('is green on this tree, and its baseline carries every finding', () => {
    const res = spawnSync('node', [SCRIPT], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    const doc = JSON.parse(readFileSync(join(ROOT, BASELINE), 'utf8')) as {
      count: number; panels: Record<string, { issue: string; sentences: string[] }>;
    };
    expect(doc.count).toBe(Object.keys(doc.panels).length);
    // #2829 listed 36 outstanding. Five left the class in this pass and #2828's merged
    // portal fixes took four more out, so the floor is 31 — below it, the sweep stopped
    // matching rather than the app getting cleaner, which is the failure mode a ratchet
    // has to be tested against.
    expect(doc.count).toBeGreaterThan(31);
    for (const [file, entry] of Object.entries(doc.panels)) {
      expect(entry.sentences.length, `${file} is allowlisted with no sentence to point at`).toBeGreaterThan(0);
      expect(entry.issue, `${file} must name the issue that carries it`).toMatch(/^#\d+$/);
    }
    // The five this pass fixed must NOT be tolerated by the baseline — they left the class.
    for (const fixed of [
      'app/tenant/trash/page.tsx',
      'app/tenant/settings/api-keys/page.tsx',
      'app/tenant/settings/sessions/page.tsx',
      'app/tenant/settings/webhooks/dlq/page.tsx',
      'app/tenant/settings/backup/page.tsx',
    ]) {
      expect(doc.panels[fixed], `${fixed} was fixed; it must not hide in the baseline`).toBeUndefined();
    }
  });
});
