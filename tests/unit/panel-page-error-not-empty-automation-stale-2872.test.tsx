// @vitest-environment jsdom
/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2872 — `app/tenant/automation/page.tsx` (two reads) and
 * `app/tenant/automation/sequences/page.tsx` (one read).
 *
 * Both branched on the error flag alone, so a revalidation that failed after the read had
 * already answered looked exactly like a read that never answered: the pre-built list,
 * the custom list and the sequence list were each replaced by an outage card over the rows
 * still in hand, and every mutation on these pages invalidates on success — toggling a
 * pre-built reloads the workflows read, creating/toggling/deleting an automation or a
 * sequence reloads that one. "The write worked, the reload did not" is the common case.
 *
 * `automation` also had the counter half, and it is worse here than a dash: `prebuilts`
 * maps the static PREBUILT config and reads `enabled` off the rows, so with nothing in
 * hand all five pre-builts report the shipped `false`. When the workflows read never
 * answered, the header said "0 active automations" and the tab said "Pre-built (0/5)" —
 * while the banner five feet away explained that the ON/OFF state was the shipped default.
 * The outage card quoted the lie; it did not stop it. Those two now print `—`, and the
 * header's number is `—` if either read is missing, because it is the sum of both.
 *
 * #2829's own suite for these pages (`panel-page-error-not-empty-tenant-lists-2829`) keeps
 * running unchanged: nothing it asserts is about a read that answered first. This file is
 * the other half, and the ratchet at the end checks the two suites still do not overlap.
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
vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import AutomationPage from '@/app/tenant/automation/page';
import SequencesPage from '@/app/tenant/automation/sequences/page';

const WORKFLOWS = '/api/tenant/automation/workflows';
const AUTOMATIONS = '/api/tenant/automations';
const SEQUENCES = '/api/tenant/sequences';

const NOW = '2026-03-04T10:00:00.000Z';
// One of the five pre-builts is ON in the tenant's rows; the other four are off.
const workflowRows = {
  data: [
    { workflow_id: 'welcome-email', enabled: true, run_count: 12, last_run_at: NOW },
    { workflow_id: 'task-due-reminder', enabled: false, run_count: 0, last_run_at: null },
  ],
};
const automationRows = {
  data: [
    { id: 'au-1', name: 'Night roundup', description: null, trigger_type: 'contact.created', actions: [{ type: 'send_notification' }], is_active: true, success_count: 4, last_run_at: NOW, last_error: null },
    { id: 'au-2', name: 'Weekend pause', description: null, trigger_type: 'deal.stage_changed', actions: [{ type: 'add_task' }], is_active: false, success_count: 0, last_run_at: null, last_error: null },
  ],
};
const sequenceRows = {
  data: [
    { id: 's1', name: 'New lead welcome', description: 'Three touches over a week', is_active: true, steps: [], enroll_count: 0, created_at: NOW },
    { id: 's2', name: 'Renewal drip', description: null, is_active: false, steps: [{}, {}, {}], enroll_count: 7, created_at: NOW },
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

const allOk = () => ({
  [WORKFLOWS]: ok(workflowRows),
  [AUTOMATIONS]: ok(automationRows),
  [SEQUENCES]: ok(sequenceRows),
});

const alerts = () =>
  screen.queryAllByRole('alert').map((el) => el.textContent ?? '').join(' | ');
const headerCount = () => screen.getByText(/active automation/).textContent ?? '';
const tabLabel = (which: 'Pre-built' | 'Custom') =>
  screen.getByRole('button', { name: new RegExp(`^${which} \\(`) }).textContent ?? '';

const tree = (node: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
    {node}
  </QueryClientProvider>
);
const wrapped = (node: ReactNode) => {
  cleanup();
  return render(tree(node));
};
const openCustom = () => {
  wrapped(<AutomationPage />);
  fireEvent.click(screen.getByRole('button', { name: /^Custom \(/ }));
};

describe('automation: the pre-built read keeps its switches and its counter (#2872)', () => {
  beforeEach(() => { registry.byUrl = { ...allOk(), [WORKFLOWS]: staleRead(workflowRows) }; vi.clearAllMocks(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('keeps all five pre-builts, their ON state and the tab count', () => {
    wrapped(<AutomationPage />);
    expect(tabLabel('Pre-built')).toBe('Pre-built (1/5)');
    expect(screen.getByText('Welcome Email')).toBeTruthy();
    expect(screen.getByText('Deal Won Celebration')).toBeTruthy();
    expect(screen.getAllByText('ON').length).toBeGreaterThan(0);
    expect(alerts()).toMatch(/last read/i);
    expect(alerts()).toMatch(/Request failed \(504\)/);
  });

  it('keeps the header total, which is a sum of both reads', () => {
    wrapped(<AutomationPage />);
    expect(headerCount()).toContain('2 active automations');
  });

  it('re-runs the workflows read from the caveat, not the automations read beside it', () => {
    wrapped(<AutomationPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(registry.byUrl[WORKFLOWS].refetch).toHaveBeenCalledTimes(1);
    expect(registry.byUrl[AUTOMATIONS].refetch).not.toHaveBeenCalled();
  });

  it('names the server when the refusal arrives without a message', () => {
    registry.byUrl = { ...allOk(), [WORKFLOWS]: staleRead(workflowRows, '') };
    wrapped(<AutomationPage />);
    expect(alerts()).toMatch(/no response from the server/);
    expect(screen.getByText('Welcome Email')).toBeTruthy();
  });

  it('dashes the pre-built count and the header total for a read that never answered', () => {
    registry.byUrl = { ...allOk(), [WORKFLOWS]: failed('Request failed (503)') };
    wrapped(<AutomationPage />);
    // The rows it would print are the static config with the shipped `false` for enabled:
    // "Pre-built (0/5)" and "0 active automations" both claim none are on, which is exactly
    // what the banner underneath says cannot be known.
    expect(tabLabel('Pre-built')).toBe('Pre-built (—)');
    expect(headerCount()).toContain('— active automations');
    expect(alerts()).toMatch(/Failed to load which automations are running: Request failed \(503\)/);
    expect(alerts()).toMatch(/the shipped default, not your tenant's/);
    expect(alerts()).not.toMatch(/last read/);
  });

  it('prints the real ON/OFF state and no alert when both reads answered', () => {
    registry.byUrl = allOk();
    wrapped(<AutomationPage />);
    expect(tabLabel('Pre-built')).toBe('Pre-built (1/5)');
    expect(tabLabel('Custom')).toBe('Custom (2)');
    expect(headerCount()).toContain('2 active automations');
    expect(alerts()).toBe('');
  });
});

describe('automation: the custom read keeps its automations (#2872)', () => {
  beforeEach(() => { registry.byUrl = { ...allOk(), [AUTOMATIONS]: staleRead(automationRows) }; vi.clearAllMocks(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('keeps "Custom (2)" and both automations after a refused reload', () => {
    openCustom();
    expect(tabLabel('Custom')).toBe('Custom (2)');
    expect(screen.getByText('Night roundup')).toBeTruthy();
    expect(screen.getByText('Weekend pause')).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
  });

  it('keeps the toggle and delete controls of the rows it is still showing', () => {
    openCustom();
    const row = screen.getByText('Night roundup').closest('div[class*="rounded-2xl"]');
    expect(row, 'the kept row lost its card').not.toBeNull();
    // A list the operator cannot act on is not really kept.
    expect(row!.querySelectorAll('button').length).toBe(2);
    expect(screen.getByText('ON').textContent).toBe('ON');
    expect(screen.getByText('OFF').textContent).toBe('OFF');
  });

  it('dashes the tab count and the header total for a read that never answered', () => {
    registry.byUrl = { ...allOk(), [AUTOMATIONS]: failed('Request failed (503)') };
    wrapped(<AutomationPage />);
    expect(tabLabel('Custom')).toBe('Custom (—)');
    expect(headerCount()).toContain('— active automations');
    fireEvent.click(screen.getByRole('button', { name: /^Custom \(/ }));
    expect(alerts()).toMatch(/Failed to load your automations: Request failed \(503\)/);
    expect(screen.queryByText(/No custom automations yet/)).toBeNull();
  });

  it('says none are built, with a real zero and no alert, when that is what came back', () => {
    registry.byUrl = { ...allOk(), [AUTOMATIONS]: ok({ data: [] }) };
    openCustom();
    expect(tabLabel('Custom')).toBe('Custom (0)');
    expect(screen.getByText(/No custom automations yet/)).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('still says none are built when the empty list is all the last read has', () => {
    registry.byUrl = { ...allOk(), [AUTOMATIONS]: staleRead({ data: [] }) };
    openCustom();
    expect(tabLabel('Custom')).toBe('Custom (0)');
    expect(screen.getByText(/No custom automations yet/)).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
  });
});

describe('sequences: a refused reload after a write keeps the list (#2872)', () => {
  beforeEach(() => { registry.byUrl = { [SEQUENCES]: staleRead(sequenceRows) }; vi.clearAllMocks(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('keeps both sequences and says they are the last read', () => {
    wrapped(<SequencesPage />);
    expect(screen.getByText('New lead welcome')).toBeTruthy();
    expect(screen.getByText('Renewal drip')).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
    expect(alerts()).toMatch(/Request failed \(504\)/);
    expect(alerts()).not.toMatch(/Failed to load your sequences/);
  });

  it('shows the outage for a read that never answered, and never the absence copy', () => {
    registry.byUrl = { [SEQUENCES]: failed('Request failed (503)') };
    wrapped(<SequencesPage />);
    expect(screen.queryByText('New lead welcome')).toBeNull();
    expect(alerts()).toMatch(/Failed to load your sequences: Request failed \(503\)/);
    expect(screen.queryByText(/No sequences yet/)).toBeNull();
    expect(alerts()).not.toMatch(/last read/);
  });

  it('names the server when the refusal arrives without a message', () => {
    registry.byUrl = { [SEQUENCES]: failed('') };
    wrapped(<SequencesPage />);
    expect(alerts()).toMatch(/Failed to load your sequences: no response from the server/);
  });

  it('says none exist, with no alert, when that is what came back', () => {
    registry.byUrl = { [SEQUENCES]: ok({ data: [] }) };
    wrapped(<SequencesPage />);
    expect(screen.getByText(/No sequences yet/)).toBeTruthy();
    expect(alerts()).toBe('');
  });

  it('still says none exist when the empty list is all the last read has', () => {
    registry.byUrl = { [SEQUENCES]: staleRead({ data: [] }) };
    wrapped(<SequencesPage />);
    expect(screen.getByText(/No sequences yet/)).toBeTruthy();
    expect(alerts()).toMatch(/last read/i);
  });
});

describe('the guard cannot see this class, so these assertions do (#2872)', () => {
  const ROOT = process.cwd();
  const AUTO = 'app/tenant/automation/page.tsx';
  const SEQ = 'app/tenant/automation/sequences/page.tsx';
  const src = (f: string) => readFileSync(join(ROOT, f), 'utf8');

  it('splits the two states on both pages instead of branching on one flag', () => {
    for (const name of ['workflows', 'automations']) {
      expect(src(AUTO), `${name} never learned the difference`).toMatch(new RegExp(`Boolean\\(${name}Error\\) && !`));
      expect(src(AUTO)).toMatch(new RegExp(`Boolean\\(${name}Error\\) && Boolean\\(`));
      expect(src(AUTO)).toMatch(new RegExp(`${name}Error\\?\\.message \\|\\| 'no response from the server'`));
    }
    expect(src(SEQ)).toMatch(/Boolean\(sequencesError\) && !data/);
    expect(src(SEQ)).toMatch(/Boolean\(sequencesError\) && Boolean\(data\)/);
    expect(src(SEQ)).toMatch(/sequencesError\?\.message \|\| 'no response from the server'/);
  });

  it('never branches a list or a counter on the bare flag', () => {
    for (const f of [AUTO, SEQ]) {
      const s = src(f);
      expect(s, `${f} still replaces kept rows with the outage card`).not.toMatch(/\)\s*:\s*\w*[Ee]rror \? \(/);
      expect(s, `${f} still reads the error message directly in the copy`).not.toMatch(/\$\{\w*[Ee]rror\.message\}/);
      expect(s, `${f} lost its caveat`).toMatch(/\{(?:\w*[Ss]tale|stale) && \(/);
    }
    expect(src(AUTO), 'the pre-built counter now has a kept-read branch to print').toMatch(
      /workflowsFailed \? 'Pre-built \(—\)' : `Pre-built \(\$\{prebuilts\.filter/,
    );
    expect(src(AUTO)).toMatch(/automationsFailed \? 'Custom \(—\)'/);
    expect(src(AUTO)).toMatch(/countersFailed \? '—' : totalEnabled/);
  });

  it('does not overlap the suite that owns the never-answered half', () => {
    const comms = readFileSync(join(ROOT, 'tests/unit/panel-page-error-not-empty-tenant-lists-2829.test.tsx'), 'utf8');
    expect(comms, '#2829 speaks about a kept read too; the two files must be reconciled').not.toMatch(/last read/);
    expect(comms).toMatch(/Failed to load which automations are running/);
  });

  it('reports both pages clean before and after the split is taken back out', async () => {
    const { inspect } = await import(`file://${join(ROOT, 'scripts/check-panel-error-state.mjs')}`);
    const rewinds: [string, string, string][] = [
      [AUTO,
        /const workflowsFailed = Boolean\(workflowsError\) && !pbData;\s*\n\s*const workflowsStale = Boolean\(workflowsError\) && Boolean\(pbData\);/,
        'const workflowsFailed = Boolean(workflowsError);'],
      [SEQ,
        /const stale = Boolean\(sequencesError\) && Boolean\(data\);/,
        'const stale = false;'],
    ];
    for (const [file, pattern, replacement] of rewinds) {
      const s = src(file);
      expect(s, `${file}: the shape this slice depends on moved`).toMatch(pattern);
      expect(inspect(file, s).offends, `${file} was already on the guard's list`).toBe(false);
      expect(
        inspect(file, s.replace(pattern, replacement)).offends,
        `${file}: the guard would catch this rewind after all`,
      ).toBe(false);
    }
  });

  it('keeps the baseline shrink-only and the sweep green', () => {
    const files = Object.keys(JSON.parse(readFileSync(join(ROOT, 'scripts/panel-error-state-baseline.json'), 'utf8')).files);
    expect(files.length, 'a ceiling, not a count').toBeLessThanOrEqual(3);
    for (const f of [AUTO, SEQ]) expect(files, `${f} went back on the list`).not.toContain(f);
    const res = spawnSync('node', ['scripts/check-panel-error-state.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });

  it('keeps every file it touched inside the size ceiling', () => {
    for (const f of [AUTO, SEQ]) {
      expect(src(f).split('\n').length, `${f} is past the ceiling`).toBeLessThanOrEqual(500);
    }
    const res = spawnSync('node', ['scripts/check-file-size.mjs'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
