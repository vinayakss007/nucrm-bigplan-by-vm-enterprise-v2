// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — the two platform-level panels that read their state and then judged it by nothing:
 * `app/superadmin/settings/page.tsx` and `app/superadmin/monitoring/page.tsx`.
 *
 * Neither page bound the failure at all — not even the toast shape #2872 opens with. Settings
 * destructured `{ data, isLoading }`; monitoring kept both result objects and read only
 * `.data`, `.isLoading`, `.isFetching` and `.dataUpdatedAt`. So both pages had exactly one
 * rendering for "the read never answered", and it was the rendering for success.
 *
 * The write-safety half is the #2922 rate-limits precedent, and it is worse here because this is
 * the platform's own configuration. Settings posts `{...s}` — the entire form — to
 * POST /api/superadmin/settings (app/api/superadmin/settings/route.ts:124-192), which upserts
 * EVERY allowed key it is handed (:141-165) with no precondition: `platformSettingsSchema`
 * (lib/api/schemas/superadmin.ts:127-130) is a free-form record with no `expectedUpdatedAt`
 * field, and the route never calls `concurrencyGuard` (lib/api/concurrency.ts:39-70), which
 * passes whenever the timestamp is absent anyway. Nothing on the server can refuse the
 * collision. Over a read that never answered, `seeded` is still false and `s` is the component's
 * own `useState` literals, so the save would write `support_email`/`app_url`/`smtp_host`/
 * `smtp_user`/`smtp_from`/`backup_bucket` as '' and `maintenance_mode` 'false', `allow_signups`
 * 'true', `max_free_tenants` '1000' over whatever the platform actually runs on. That save is
 * now blocked on `failed`, and the banner says why.
 *
 * Monitoring is the other shape: a page that refreshes ITSELF. Both reads carry
 * `refetchInterval: 30_000`, the page issues no mutation and invalidates nothing, so the refused
 * revalidation is a tick, not an operator action, and what stays on screen is the previous tick's
 * figures. The copy says exactly that ("the previous tick — the last read"), and every derived
 * figure — MRR/ARR, active tenants, total users, open errors, the ten backup and restore
 * counters, the probe version cell, the two charts, the "Last updated" stamp and the
 * "All Systems Operational" badge — now keys off `…Failed` per read, so a real `0` from a read
 * that answered still prints `0` while an unread one prints `—`. Before this, an unread health
 * probe answered "Issues Detected" (a false alarm) while its Schema badge answered green (a
 * false all-clear), and an unread monitoring feed answered with ten confident zeros — including
 * "0 failed backups".
 *
 * Fixtures are documentation-only (`corp.test`, `Ada Operator`, synthetic ids).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import type { ReactNode } from 'react';

type QueryResult = {
  data?: unknown;
  error: Error | null;
  isLoading: boolean;
  refetch: ReturnType<typeof vi.fn>;
  isFetching?: boolean;
  dataUpdatedAt?: number;
};

/** url → the result the page should see for that read. */
const queryState = vi.hoisted(() => ({
  byUrl: {} as Record<string, QueryResult>,
  options: {} as Record<string, unknown>,
}));

vi.mock('@/lib/query/client', () => ({
  useApiQuery: (key: unknown, url: string, options?: unknown) => {
    queryState.options[url] = options;
    return queryState.byUrl[url] ?? {
      data: undefined, error: null, isLoading: false, refetch: vi.fn(),
    };
  },
}));
// Settings still toasts for its own actions; the assertions below run on the panel,
// so no page STATE can be carried by a fading toast.
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn(), loading: vi.fn() },
}));
vi.mock('@/components/ui/confirm-dialog', () => ({
  confirmThen: (_message: string, fn: () => unknown) => Promise.resolve(fn()),
  ConfirmDialog: () => null,
}));
// jsdom has no ResizeObserver, which recharts' ResponsiveContainer needs.
vi.mock('recharts', () => {
  const Stub = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    AreaChart: Stub, Area: Stub, BarChart: Stub, Bar: Stub, XAxis: Stub, YAxis: Stub,
    Tooltip: Stub, ResponsiveContainer: Stub, CartesianGrid: Stub,
  };
});

import toast from 'react-hot-toast';
import SettingsPage from '@/app/superadmin/settings/page';
import MonitoringPage from '@/app/superadmin/monitoring/page';

const SETTINGS_URL = '/api/superadmin/settings';
const MONITORING_URL = '/api/superadmin/monitoring';
const HEALTH_URL = '/api/health';

/** What GET /api/superadmin/settings serves (route.ts:115): one wrapped `data` map. */
const SERVER_SETTINGS = {
  data: {
    platform_name: 'Acme Platform', support_email: 'ops@corp.test', app_url: 'https://crm.corp.test',
    allow_signups: 'false', require_email_verify: 'true', maintenance_mode: 'true',
    default_trial_days: '7', default_plan: 'pro', max_free_tenants: '0',
    stripe_publishable_key: 'publishable-from-server', smtp_host: 'mail.corp.test',
    smtp_port: '587', smtp_user: 'ops@corp.test', smtp_from: 'Acme CRM <no-reply@corp.test>',
    default_timezone: 'Asia/Kolkata', contact_score_enabled: 'false',
    session_duration_days: '14', max_sessions_per_user: '3',
    backup_retention_days: '45', backup_bucket: 'corp-backups', ai_features_enabled: 'true',
  },
};

const MONITORING = {
  stats: { mrr: 1234, active_tenants: 7, total_users: 42, unresolved_errors: 3 },
  planDist: [{ name: 'pro', tenant_count: 5, price_monthly: 100 }],
  tenantGrowth: [{ day: '2026-02-03', count: 2 }],
  backupStatus: { total: 10, completed: 8, failed: 0, running: 2 },
  restoreStatus: { total: 4, pending: 1, running: 0, completed: 2, failed: 1 },
  recentBackups: [{ id: 'b1', status: 'completed', backup_name: 'nightly', size_bytes: 2097152, created_at: '2026-02-03T02:00:00.000Z' }],
  recentErrors: [{ id: 'e1', level: 'fatal', message: 'pool exhausted', created_at: '2026-02-03T03:00:00.000Z' }],
};
// #3071: the producer's real shape (`app/api/health/route.ts:88-98`). The old fixture carried
// db_latency_ms/uptime_s, which this endpoint has never emitted as JSON.
const HEALTH = { status: 'ok', db: 'connected', schema_ready: true, service: 'nucrm-app', version: '1.2.0', sentry: 'configured', timestamp: '2026-02-03T03:00:00.000Z' };

const ok = (data: unknown): QueryResult => ({ data, error: null, isLoading: false, refetch: vi.fn() });
/** A read that never answered. */
const failed = (message = 'Request failed (500)'): QueryResult => ({
  data: undefined, error: new Error(message), isLoading: false, refetch: vi.fn(), dataUpdatedAt: 0,
});
/** Answered before; this refresh was refused, and the payload came back with it. */
const staleRead = (data: unknown, message = 'Request failed (504)'): QueryResult => ({
  data, error: new Error(message), isLoading: false, refetch: vi.fn(),
  dataUpdatedAt: Date.now() - 5 * 60_000,
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');

/** The alert banner whose copy matches `re`, so a retry can be attributed to one read. */
const bannerFor = (re: RegExp) =>
  screen.queryAllByRole('alert').find((el) => re.test(el.textContent ?? '')) ?? null;
const retryIn = (re: RegExp) =>
  (bannerFor(re)?.querySelector('button') ?? null) as HTMLButtonElement | null;

/** A `Metric` card's whole text (label, value, sub) — its two parents are the card. */
const cardText = (label: string) => {
  const el = screen.getByText(label);
  return el.parentElement?.parentElement?.textContent ?? '';
};
/** A backup/restore counter cell, addressed by its caption. */
const counterText = (caption: RegExp, nth = 0) => {
  const els = screen.getAllByText(caption);
  return els[nth]?.closest('div')?.textContent ?? '';
};
const chartCard = (title: string) => screen.getByText(title).parentElement?.textContent ?? '';
const versionText = () => screen.getByText(/^Version:/).textContent ?? '';

const button = (name: RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
const offered = (name: RegExp) => button(name).disabled === false;

let client: QueryClient;
const wrapped = (node: ReactNode) => {
  cleanup();
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
};

/** Records what POST /api/superadmin/settings actually carries. */
let posted: Record<string, unknown>[] = [];
function stubSettingsPost() {
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: { body?: string }) => {
    posted.push(JSON.parse(init?.body ?? '{}'));
    return { ok: true, status: 200, json: async () => ({ ok: true }) } as unknown as Response;
  }));
}

const mountSettings = (result: QueryResult) => {
  queryState.byUrl = { [SETTINGS_URL]: result };
  return wrapped(<SettingsPage />);
};
const mountMonitoring = (monitoring: QueryResult, health: QueryResult) => {
  queryState.byUrl = { [MONITORING_URL]: monitoring, [HEALTH_URL]: health };
  return wrapped(<MonitoringPage />);
};
const submitSettings = async () => {
  const form = button(/save all settings/i).closest('form');
  await act(async () => { fireEvent.submit(form as HTMLFormElement); });
};

beforeEach(() => {
  queryState.byUrl = {};
  queryState.options = {};
  posted = [];
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  stubSettingsPost();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ──────────────────────────────────────────────────────────────────────────────────
// app/superadmin/settings/page.tsx — the platform's own configuration form
// ──────────────────────────────────────────────────────────────────────────────────

describe('settings: a read that answered shows the live configuration (#2872)', () => {
  it('seeds the form from the server and raises nothing', () => {
    mountSettings(ok(SERVER_SETTINGS));
    expect(screen.getByDisplayValue('Acme Platform')).toBeTruthy();
    expect(screen.getByDisplayValue('45')).toBeTruthy();
    expect(screen.getByText('Maintenance Mode Active')).toBeTruthy();
    expect(alerts()).toBe('');
    expect(offered(/save all settings/i)).toBe(true);
  });

  it('treats an answered-but-empty settings map as an answer, not an outage', () => {
    // The GET always merges its own defaults, so this is the closest thing the page has to a
    // genuine empty: the read spoke, and said there is nothing extra to show. No banner.
    mountSettings(ok({ data: {} }));
    expect(alerts()).toBe('');
    expect(offered(/save all settings/i)).toBe(true);
  });
});

describe('settings: a read that never answered is an outage, and not a saveable form (#2872)', () => {
  it('says the read failed, quotes the reason, and does not say "last read"', () => {
    mountSettings(failed());
    expect(alerts()).toContain('Failed to load the platform settings: Request failed (500)');
    expect(alerts()).toContain("Every value in this form is the page's own default");
    expect(alerts()).not.toMatch(/last read/);
    expect(screen.getByText('Platform Settings')).toBeTruthy();
  });

  it('routes the failure to the banner and not to a toast that fades', () => {
    mountSettings(failed());
    expect(toast.error).not.toHaveBeenCalled();
    expect(alerts()).toContain('Failed to load the platform settings');
  });

  it('prints a reason when the refusal carries no message', () => {
    mountSettings(failed(''));
    expect(alerts()).toContain('no response from the server');
  });

  it('holds the write that would post page defaults over the platform (#2922 precedent)', async () => {
    mountSettings(failed());
    // Nothing seeded: `s` is the useState literals, and POST upserts every key it is given
    // (route.ts:141-165) with no `expectedUpdatedAt` to refuse the collision.
    expect(offered(/save all settings/i), 'Save is clickable over a read that never answered').toBe(false);
    expect(screen.queryByText('Maintenance Mode Active'), 'a probe that never ran may not report maintenance mode').toBeNull();
    await submitSettings();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(posted).toHaveLength(0);
  });

  it('re-runs the settings read through the banner\'s own button', () => {
    const result = failed();
    mountSettings(result);
    fireEvent.click(button(/try again/i));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });
});

describe('settings: a refused refresh keeps the last read and says what the next save costs (#2872)', () => {
  it('leaves the configuration in the form and names this page\'s loss', () => {
    mountSettings(staleRead(SERVER_SETTINGS));
    expect(screen.getByDisplayValue('Acme Platform')).toBeTruthy();
    expect(screen.getByDisplayValue('corp-backups')).toBeTruthy();
    expect(alerts()).toContain(
      'Could not refresh the platform settings, so this form is the last read: Request failed (504).',
    );
    expect(alerts()).toContain('Another admin\'s change since then is not in it');
    expect(alerts()).toContain('saving now writes every field below over whatever the server holds');
    expect(alerts()).not.toContain('Failed to load the platform settings');
  });

  it('keeps the form editable and the save live, because the banner pays for it', async () => {
    mountSettings(staleRead(SERVER_SETTINGS));
    expect(offered(/save all settings/i), 'a refused refresh blocked the operator\'s own save').toBe(true);
    fireEvent.change(screen.getByDisplayValue('Acme Platform'), { target: { value: 'Renamed Platform' } });
    await submitSettings();
    // Measured, not assumed: the body is the whole map — the last read plus this edit —
    // which is exactly why the caveat is about the next save and not about vague drift.
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      platform_name: 'Renamed Platform',
      maintenance_mode: 'true',
      max_free_tenants: '0',
      smtp_host: 'mail.corp.test',
      backup_retention_days: '45',
      ai_features_enabled: 'true',
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Settings saved'));
  });

  it('says "last read" over an answered-empty map instead of claiming an outage', () => {
    mountSettings(staleRead({ data: {} }));
    expect(alerts()).toContain('this form is the last read');
    expect(alerts()).not.toContain('Failed to load the platform settings');
  });

  it('retries the settings read only', () => {
    const result = staleRead(SERVER_SETTINGS);
    mountSettings(result);
    fireEvent.click(button(/try again/i));
    expect(result.refetch).toHaveBeenCalledTimes(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────────────
// app/superadmin/monitoring/page.tsx — the panel that refreshes itself
// ──────────────────────────────────────────────────────────────────────────────────

describe('monitoring: both ticks answered shows the platform (#2872)', () => {
  it('prints the real figures, the real probe version and no failure affordance', () => {
    mountMonitoring(ok(MONITORING), ok(HEALTH));
    expect(cardText('Monthly Revenue')).toContain('$1,234');
    expect(cardText('Active Tenants')).toContain('7');
    expect(cardText('Total Users')).toContain('42');
    expect(versionText()).toBe('Version: 1.2.0');
    expect(screen.getByText('All Systems Operational')).toBeTruthy();
    expect(counterText(/^Failed$/)).toContain('0');   // a real zero, from a read that answered
    expect(alerts()).toBe('');
    expect(screen.queryByText('No plan data')).toBeNull();
  });

  it('is polled by a timer, which is what makes a refusal the ordinary state', () => {
    mountMonitoring(ok(MONITORING), ok(HEALTH));
    for (const url of [MONITORING_URL, HEALTH_URL]) {
      expect((queryState.options[url] as { refetchInterval?: number }).refetchInterval)
        .toBe(30_000);
    }
  });
});

describe('monitoring: a tick that never answered is an outage, and not a set of zeros (#2872)', () => {
  it('dashes every derived figure and stops calling them counts', () => {
    mountMonitoring(failed(), ok(HEALTH));
    expect(alerts()).toContain('Failed to load platform monitoring: Request failed (500)');
    expect(alerts()).toContain("this page's own zeros");
    expect(alerts()).not.toMatch(/last read/);
    expect(cardText('Monthly Revenue')).toContain('—');
    expect(cardText('Monthly Revenue')).not.toContain('$0');
    expect(cardText('Active Tenants')).toContain('—');
    expect(cardText('Total Users')).toContain('—');
    expect(cardText('Open Errors (24h)')).toContain('—');
    expect(counterText(/^Total$/, 0)).toContain('—');
    expect(counterText(/^Failed$/, 0), 'an unread read may not report zero failed backups').toContain('—');
    expect(chartCard('New Tenants — Last 30 Days')).toContain('—');
    expect(chartCard('Tenants by Plan')).toContain('—');
  });

  it('makes the plan absence sentence unreachable', () => {
    // `planDist` is `data?.planDist||[]`, so an unread read produced the same empty array an
    // install with no plans does.
    mountMonitoring(failed(), ok(HEALTH));
    expect(screen.queryByText('No plan data')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('Failed to load platform monitoring');
  });

  it('leaves the health read alone: a monitoring outage is not a platform outage', () => {
    mountMonitoring(failed(), ok(HEALTH));
    expect(alerts()).not.toMatch(/health probe/i);
    expect(screen.getByText('All Systems Operational')).toBeTruthy();
    expect(screen.queryByText('not read')).toBeNull();
    expect(versionText()).toBe('Version: 1.2.0');
  });

  it('still prints a real value the answered read produced', () => {
    // The dash belongs to `failed`, never to the bare flag: an absent probe version is
    // reported as such, but a read that answered is never dashed.
    mountMonitoring(failed(), ok({ ...HEALTH, version: '0.9.0' }));
    expect(versionText()).toBe('Version: 0.9.0');
  });

  it('dashes the "Last updated" stamp instead of inventing one', () => {
    mountMonitoring(failed(), failed());
    expect(screen.getByText(/Last updated/).textContent).toContain('Last updated —');
    expect(screen.getByText(/Last updated/).textContent).not.toMatch(/just now/);
  });
});

describe('monitoring: a refused tick keeps the previous tick and says so (#2872)', () => {
  it('keeps every figure on screen and names the loss as one interval of counting', () => {
    mountMonitoring(staleRead(MONITORING), ok(HEALTH));
    expect(cardText('Active Tenants')).toContain('7');
    expect(counterText(/^Total$/, 0)).toContain('10');
    expect(versionText()).toBe('Version: 1.2.0');
    expect(alerts()).toContain(
      'Could not refresh platform monitoring, so the figures below are the previous tick — the last read: Request failed (504).',
    );
    expect(alerts()).toContain('A tenant that signed up, a backup that finished or an error logged since then is not counted here');
    expect(alerts()).not.toContain('Failed to load platform monitoring');
    expect(screen.getByText(/Last updated/).textContent).toContain('5m ago');
  });

  it('keeps a real 0 reading as 0 through a refused refresh', () => {
    mountMonitoring(staleRead(MONITORING), ok(HEALTH));
    expect(counterText(/^Failed$/, 0)).toContain('0');
    expect(counterText(/^Failed$/, 0)).not.toContain('—');
    expect(cardText('Monthly Revenue')).toContain('$1,234');
  });

  it('says "No plan data" for an empty plan mix the previous tick did read', () => {
    mountMonitoring(staleRead({ ...MONITORING, planDist: [] }), ok(HEALTH));
    expect(screen.getByText('No plan data')).toBeTruthy();
    expect(alerts()).toContain('the previous tick');
    expect(alerts()).not.toContain('Failed to load platform monitoring');
  });

  it('re-runs the monitoring tick from its own banner and not the probe\'s', () => {
    const monitoring = staleRead(MONITORING);
    const health = staleRead(HEALTH);
    mountMonitoring(monitoring, health);
    expect(screen.getAllByRole('alert')).toHaveLength(2);
    fireEvent.click(retryIn(/platform monitoring/)!);
    expect(monitoring.refetch).toHaveBeenCalledTimes(1);
    expect(health.refetch).not.toHaveBeenCalled();
    fireEvent.click(retryIn(/health probe/)!);
    expect(health.refetch).toHaveBeenCalledTimes(1);
    expect(monitoring.refetch).toHaveBeenCalledTimes(1);
  });

  it('prints a reason when the refused tick has no message', () => {
    mountMonitoring(staleRead(MONITORING, ''), ok(HEALTH));
    expect(alerts()).toContain('no response from the server');
  });
});

describe('health probe: the same split on the other read (#2872)', () => {
  it('refuses to raise an alarm the probe never produced, or a green light either', () => {
    mountMonitoring(ok(MONITORING), failed('Request failed (503)'));
    expect(alerts()).toContain('Failed to load the health probe: Request failed (503)');
    expect(screen.queryByText('Issues Detected')).toBeNull();
    expect(screen.getByText('Status not read')).toBeTruthy();
    expect(screen.getAllByText('not read')).toHaveLength(3);   // Database, App Server and Schema, all unread
    expect(versionText()).toBe('Version: —');
    // …and the monitoring read is untouched: it answered, so its figures stand.
    expect(cardText('Active Tenants')).toContain('7');
    expect(alerts()).not.toMatch(/platform monitoring/);
  });

  it('keeps the badges the previous tick produced when this tick was refused', () => {
    mountMonitoring(ok(MONITORING), staleRead(HEALTH));
    expect(screen.getByText('All Systems Operational')).toBeTruthy();
    expect(screen.queryByText('not read')).toBeNull();
    expect(versionText()).toBe('Version: 1.2.0');
    expect(alerts()).toContain('the service badges below are the previous tick — the last read');
    expect(alerts()).not.toContain('Failed to load the health probe');
    expect(alerts()).not.toMatch(/this probe never ran/);
  });

  it('shows a down service as down when the probe answered and said so', () => {
    mountMonitoring(ok(MONITORING), ok({ ...HEALTH, status: 'error', db: 'error', schema_ready: false }));
    expect(screen.getByText('Issues Detected')).toBeTruthy();
    expect(screen.getByText('Database')).toBeTruthy();
    expect(alerts()).toBe('');
  });
});

// ──────────────────────────────────────────────────────────────────────────────────
// app/superadmin/monitoring/page.tsx — field fidelity (#3071)
// ──────────────────────────────────────────────────────────────────────────────────

describe('monitoring: only fields /api/health actually emits (#3071)', () => {
  it('renders no uptime clock and no invented latency on a healthy read', () => {
    mountMonitoring(ok(MONITORING), ok(HEALTH));
    expect(document.body.textContent).not.toMatch(/Uptime:/);
    expect(document.body.textContent).not.toMatch(/undefinedms/);
    expect(document.body.textContent).not.toMatch(/\b12ms\b/); // the old fixture's invented latency
  });

  it('backs the App Server badge with the probe status, so it can go red', () => {
    mountMonitoring(ok(MONITORING), ok({ status: 'error', db: 'connected', schema_ready: true }));
    expect(screen.getByText('App Server')).toBeTruthy();
    expect(screen.getByText('Issues Detected')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Uptime:/);
  });

  it('renders the Schema badge as unread when the probe answered without the field', () => {
    // `schema_ready !== false` used to turn an absent field into a green light.
    mountMonitoring(ok(MONITORING), ok({ status: 'ok', db: 'connected' }));
    const schema = screen.getByText('Schema').closest('div');
    expect(schema?.textContent).toContain('not read');
  });
});

// ──────────────────────────────────────────────────────────────────────────────────
// the ratchet these two pages are measured by
// ──────────────────────────────────────────────────────────────────────────────────

describe('the ratchet (#2872)', () => {
  const ROOT = process.cwd();
  const SETTINGS = 'app/superadmin/settings/page.tsx';
  const MONITORING_FILE = 'app/superadmin/monitoring/page.tsx';
  const src = (file: string) => readFileSync(join(ROOT, file), 'utf8');

  it('binds the two-state split on every read, and no branch off the bare flag', () => {
    const settings = src(SETTINGS);
    expect(settings).toMatch(/const failed = Boolean\(settingsError\) && !data;/);
    expect(settings).toMatch(/const stale = Boolean\(settingsError\) && Boolean\(data\);/);
    expect(settings).toMatch(/const reason = settingsError\?\.message \|\| 'no response from the server';/);
    expect(settings, 'the save is back on the unseeded form').toMatch(/disabled=\{saving \|\| failed\}/);
    expect(settings, 'the outage arm is not gated on `failed`').toMatch(/\{failed && \(\n[\s\S]*?Failed to load the platform settings/);
    expect(settings, 'the caveat lost the last read').toMatch(/\{stale && \(\n[\s\S]*?this form is the last read: \$\{reason\}/);

    const monitoring = src(MONITORING_FILE);
    expect(monitoring).toMatch(/const monitoringFailed = Boolean\(monitoringQuery\.error\) && !data;/);
    expect(monitoring).toMatch(/const monitoringStale = Boolean\(monitoringQuery\.error\) && Boolean\(data\);/);
    expect(monitoring).toMatch(/const healthFailed = Boolean\(healthQuery\.error\) && !health;/);
    expect(monitoring).toMatch(/const healthStale = Boolean\(healthQuery\.error\) && Boolean\(health\);/);
    expect(monitoring).toMatch(/const monitoringReason = monitoringQuery\.error\?\.message \|\| 'no response from the server';/);
    expect(monitoring).toMatch(/const healthReason = healthQuery\.error\?\.message \|\| 'no response from the server';/);
    for (const gate of [/\{monitoringFailed && \(/, /\{monitoringStale && \(/, /\{healthFailed && \(/, /\{healthStale && \(/]) {
      expect(monitoring, `a banner arm lost its gate (${gate.source})`).toMatch(gate);
    }
  });

  it('keys every derived figure off `failed`, per read, and never off the flag', () => {
    const monitoring = src(MONITORING_FILE);
    // Each derived figure must name the read that feeds it.
    for (const figure of [
      /monitoringFailed \? '—' : formatCurrency\(s\.mrr \?\? 0\)/,
      /monitoringFailed \? '—' : \(s\.active_tenants \?\? 0\)\.toLocaleString\(\)/,
      /monitoringFailed \? '—' : \(s\.total_users \?\? 0\)\.toLocaleString\(\)/,
      /monitoringFailed \? '—' : \(s\.unresolved_errors \?\? 0\)\.toString\(\)/,
      /monitoringFailed \? '—' : data\?\.backupStatus\?\.total \?\? 0/,
      /monitoringFailed \? '—' : data\?\.backupStatus\?\.failed \?\? 0/,
      /monitoringFailed \? '—' : data\?\.restoreStatus\?\.failed \?\? 0/,
      /healthFailed \? '—' : hs\.version \?\? 'not reported'/,
      /healthFailed\?'Status not read':allUp/,
      /monitoringFailed \? \(\s*<p className="text-white\/30 text-sm text-center py-8">—<\/p>/,
    ]) {
      expect(monitoring, `a derived figure stopped keying off failed (${figure.source})`).toMatch(figure);
    }
    // `?? 0`, not `|| 0`: a real zero stays a zero instead of silently re-appearing as one.
    // #3071: the probe's invented fields may not come back either — no read of them survives.
    expect(monitoring, 'a count went back to `|| 0`, or a #3071 phantom field was re-read')
      .not.toMatch(/backupStatus\?\.total \|\| 0|restoreStatus\?\.failed \|\| 0|hs\.uptime_s\|\|0|hs\.db_latency_ms|hs\.uptime_s|hs\.node|hs\.missing_tables/);
    // The `|| Date.now()` fallback stamped an unread panel as read "just now".
    expect(monitoring, 'the header invented a timestamp again').not.toMatch(/const lastRefresh = [^\n]*Date\.now\(\)/);
    expect(monitoring).toMatch(/const lastRefresh = lastReadAt \? new Date\(lastReadAt\)\.toISOString\(\) : null;/);
    // The absence sentence may not fire for a read that never answered.
    expect(monitoring, 'the plan-mix sentence is back on the unread read').toMatch(
      /monitoringFailed \? \(\s*<p[^>]*>—<\/p>\s*\) : planDist\.length===0 \? \(/,
    );
  });

  it('keeps the render-body toast out of both pages', () => {
    for (const file of [SETTINGS, MONITORING_FILE]) {
      const s = src(file);
      expect(s, `${file} toasts the read's state from the render body`).not.toMatch(/^\s*if \(error\) toast\.error/m);
      expect(s, `${file} toasts the read's state at all`).not.toMatch(/if \((?:settings|monitoring|health)\w*\.(?:error|isError)\) toast/);
      expect(s).toMatch(/InlineErrorState/);
    }
    // Settings' action feedback stays transient — a save is an action, not a page state.
    expect(src(SETTINGS)).toMatch(/if\(res\.ok\) \{ toast\.success\('Settings saved'\)/);
  });

  it('says why, in each page\'s own words', () => {
    // WHY comments carry this slice, so the two halves are pinned separately: the settings
    // page names the write that has no precondition, the monitoring page names the timer.
    const settings = src(SETTINGS);
    expect(settings, 'the settings page lost its #2872 split comment').toMatch(/#2872: `settingsError` alone cannot tell/);
    expect(settings, 'the #2922 write-safety reasoning is gone from the source').toMatch(/#2872 \/ epic rule #1[\s\S]*?:124-192[\s\S]*?expectedUpdatedAt[\s\S]*?concurrencyGuard[\s\S]*?blocked on `failed`/);
    const monitoring = src(MONITORING_FILE);
    expect(monitoring, 'the monitoring page no longer names the timer as its trigger')
      .toMatch(/#2872 — this page's refused refresh is not the operator's action, it is the TIMER/);
    expect(monitoring, 'the tick copy went missing').toMatch(/refetchInterval: 30_000[\s\S]*?previous tick/);
    expect(monitoring, 'the falsely-green Schema badge is no longer on record')
      .toMatch(/hs\.schema_ready!==false[\s\S]{0,900}?falsely green|falsely green[\s\S]{0,900}?hs\.schema_ready!==false/);
  });

  it('keeps the guards green, with the baseline still empty', () => {
    const files = Object.keys(JSON.parse(
      readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8'),
    ).files);
    // A ceiling, never an equality: the baseline is `{}` now, and a page may only join it
    // through a reviewed PR.
    expect(files.length, 'a new page joined the panel-error baseline').toBeLessThanOrEqual(0);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
    expect(res.stdout, 'a fixed page must be deleted from the baseline, not left stale')
      .not.toContain('no longer offends');
    const size = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(size.status, size.stdout + size.stderr).toBe(0);
  });

  it('stays inside the line ceiling the guard allows', () => {
    for (const file of [SETTINGS, MONITORING_FILE]) {
      const lines = src(file).split('\n').length - 1;
      expect(lines, `${file} crossed MAX_LINES`).toBeLessThanOrEqual(500);
    }
  });

  it('is not something the guard could have caught anyway', async () => {
    // The guard asks one question — does a page that prints "there are none" also bind an
    // error and render some failure affordance. Settings prints no such sentence at all, and
    // monitoring's is "No plan data", which its regex does not know. So every shape below,
    // the fixed one and both rewinds, reports clean: these render tests are the only thing
    // carrying the rule.
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    const settings = src(SETTINGS);
    const monitoring = src(MONITORING_FILE);

    expect(inspect(SETTINGS, settings).offends, 'the fixed settings page offends').toBe(false);
    expect(inspect(MONITORING_FILE, monitoring).offends, 'the fixed monitoring page offends').toBe(false);

    const rewinds: Record<string, [string, string, string]> = {
      // The pre-fix page: the error flag never bound, the form filled with defaults and Save live.
      'settings: error never read': [SETTINGS, settings,
        settings
          .replace('const failed = Boolean(settingsError) && !data;', 'const failed = false;')
          .replace('const stale = Boolean(settingsError) && Boolean(data);', 'const stale = false;')
          .replace('disabled={saving || failed}', 'disabled={saving}')],
      // Both states back on one flag — the refused tick then blanks the dashboard #2872 keeps.
      'monitoring: one flag for both arms': [MONITORING_FILE, monitoring,
        monitoring
          .replace('{monitoringStale && (', '{monitoringFailed && (')
          .replace('const monitoringStale = Boolean(monitoringQuery.error) && Boolean(data);', '')],
      // The other wrong answer: dashing everything that a kept read actually measured.
      'monitoring: figures keyed off the flag': [MONITORING_FILE, monitoring,
        monitoring.replace(/monitoringFailed \? '—' : \(s\.active_tenants \?\? 0\)/g, '(s.active_tenants ?? 0)')
          .replace(/Boolean\(monitoringQuery\.error\) && !data/g, 'Boolean(monitoringQuery.error)')],
    };

    for (const [name, [file, before, after]] of Object.entries(rewinds)) {
      expect(after, `${name}: the rewind changed nothing`).not.toBe(before);
      expect(inspect(file, after).offends, `${name} would be visible to the guard`).toBe(false);
    }
  });

  it('leaves no older suite of this repo speaking about a kept read of these pages', () => {
    // Neither page was mounted by a #2829 suite, so nothing pre-existing can start claiming
    // the new states. If a slice later mounts them, this check has to be widened with it.
    const importers = readdirSync(join(ROOT, 'tests/unit'))
      .filter((f) => f.endsWith('.test.tsx'))
      .filter((f) => {
        const s = readFileSync(join(ROOT, 'tests/unit', f), 'utf8');
        return /@\/app\/superadmin\/(settings|monitoring)\/page/.test(s);
      });
    expect(importers.sort()).toEqual([
      'panel-page-error-not-empty-superadmin-settings-monitoring-stale-2872.test.tsx',
    ]);
  });
});
