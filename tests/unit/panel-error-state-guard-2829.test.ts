/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * The #2829 guard tested against sources, not just against the tree.
 *
 * A screen like this fails in one direction only: a regex that quietly stops
 * matching prints "OK" over the panel it exists to catch. So each offender shape
 * is planted and must be named, and each honest shape — including the ones a
 * sloppier screen would flag and the maintainers would then delete — must not
 * be. The last block holds the baseline to account: an entry that has been fixed
 * is dead weight that hides the next offender.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import {
  inspect,
  scan,
  loadBaseline,
  rendersFalseEmpty,
  walk,
  QUERY_RE,
  OBJECT_QUERY_RE,
  readsQueryError,
  EMPTY_SENTENCE,
  EMPTY_TEST,
  FAILURE_AFFORDANCE,
} from '../../scripts/check-panel-error-state.mjs';

const page = (body: string) => `export default function P() {
  const { data, isLoading } = useApiQuery({ queryKey: ['x'], queryFn: fetchX });
  const rows = data?.data ?? [];
  return (
    <div>
      {!rows.length ? (
        ${body}
      ) : <Table rows={rows} />}
    </div>
  );
}`;

describe('panel-error-state guard (#2829) — offenders', () => {
  it('names the shape the issue describes: an empty-state component under a length test', () => {
    const res = inspect(
      'app/tenant/settings/sessions/page.tsx',
      page('<SettingsEmptyState icon={Monitor} title="No sessions found" description="Active sessions will appear here" />'),
    );
    expect(res.offends).toBe(true);
    expect(res.why).toContain('No sessions found');
    expect(res.why, 'pointed at the wrong line').toContain(':7');
  });

  it('names bare JSX text, a ternary string arm, and the "is empty" phrasing', () => {
    const cases = [
      '<p className="muted">No API keys yet</p>',
      '{calls.length === 0 ? <p>No calls logged yet</p> : <List />}',
      '<p>Trash is empty</p>',
      '<SettingsEmptyState title="Nothing here" description="No backups configured yet" />',
    ];
    for (const body of cases) {
      const res = inspect('app/tenant/x/page.tsx', page(body));
      expect(res.offends, body).toBe(true);
    }
  });

  it('catches a page that binds error but never renders anything for it', () => {
    // The half a `useEffect` toast does not close: it speaks for four seconds and
    // the false sentence stays on screen afterwards.
    const src = `function P() {
  const { data, isLoading, error } = useApiQuery({ queryKey: ['x'], queryFn: fetchX });
  const rows = data?.data ?? [];
  useEffect(() => { if (error) toast.error('Failed to load sessions'); }, [error]);
  return <div>{!rows.length ? <p>No sessions found</p> : <Table rows={rows} />}</div>;
}`;
    const res = inspect('app/tenant/y/page.tsx', src);
    expect(res.offends).toBe(true);
    expect(res.bindsError).toBe(true);
    expect(res.why).toContain('`error` bound but never rendered');
  });

  it('names the two shapes apart, because the baseline records which one each page is', () => {
    const neverBound = inspect('app/tenant/y/page.tsx', `function P() {
  const { data } = useApiQuery({ queryKey: ['x'], queryFn: fetchX });
  const rows = data?.data ?? [];
  return <div>{!rows.length ? <p>No sessions found</p> : <Table rows={rows} />}</div>;
}`);
    expect(neverBound.offends).toBe(true);
    expect(neverBound.bindsError).toBe(false);
    expect(neverBound.why).toContain('`error` never bound');
  });

  it('catches the hand-written queryFn form too', () => {
    const src = `function P() {
  const { data, isLoading } = useQuery({ queryKey: ['k'], queryFn: async () => (await fetch('/api/k')).json() });
  const rows = data ?? [];
  return <div>{!rows.length ? <p>No keys configured</p> : <Table rows={rows} />}</div>;
}`;
    expect(inspect('app/tenant/z/page.tsx', src).offends).toBe(true);
  });

  it('catches the object-bound spelling — `const q = useApiQuery(...)`', () => {
    const src = `function P() {
  const q = useApiQuery(['superadmin', 'users'], '/api/superadmin/users');
  const rows = q.data?.data ?? [];
  return <div>{!rows.length ? <p>No users found</p> : <Table rows={rows} />}</div>;
}`;
    const res = inspect('app/superadmin/users/page.tsx', src);
    expect(res.offends).toBe(true);
    // the message says what is missing in *this* shape: not a binding that was
    // left out of a destructuring list, a read that never happens.
    expect(res.why).toContain('never read off the bound result object');
  });

  it('does not count a mutation handler\'s toast.error(d.error) as seeing the read fail', () => {
    const src = `function P() {
  const q = useApiQuery(['superadmin', 'tenants'], '/api/superadmin/tenants');
  const rows = q.data?.data ?? [];
  const m = useMutation({
    mutationFn: patch,
    onSuccess: async (res) => { const d = await res.json(); if (!res.ok) toast.error(d.error); },
  });
  return <div>{!rows.length ? <p>No organizations found</p> : <Table rows={rows} />}</div>;
}`;
    expect(inspect('app/superadmin/tenants/page.tsx', src).offends).toBe(true);
  });
});

describe('panel-error-state guard (#2829) — honest shapes it must not flag', () => {
  const clean = [
    // what the fix looks like: error bound, shared failure state rendered
    () =>
      page(`<sessionsError ? (
        <InlineErrorState message="Could not load your active sessions." onRetry={() => void refetch()} />
      ) : (
        <SettingsEmptyState title="No sessions found" description="Active sessions will appear here" />
      )`).replace('const { data, isLoading }', 'const { data, isLoading, error: sessionsError, refetch }'),
    // ...or a hand-rolled alert block, which is what the portal pages use
    () => `function P() {
  const { data, isLoading, error } = useApiQuery({ queryKey: ['trash'], queryFn: fetchTrash });
  const items = data?.data ?? [];
  if (isLoading) return <Spinner />;
  return (
    <div>
      {error && !items.length ? (
        <div role="alert"><p>Could not load the trash. This is a failed request, not an empty one.</p></div>
      ) : !items.length ? (
        <p>Trash is empty</p>
      ) : <Table rows={items} />}
    </div>
  );
}`,
    // copy in a comment is not a panel asserting anything
    () => `function P() {
  const { data } = useApiQuery({ queryKey: ['x'], queryFn: fetchX });
  const rows = data?.data ?? [];
  // if there are no rows we used to print "No sessions found" here
  return <div>{!rows.length ? <Spinner /> : <Table rows={rows} />}</div>;
}`,
    // a failure the page routes to a toast, with no empty sentence rendered at all
    () => `function P() {
  const { data } = useApiQuery({ queryKey: ['x'], queryFn: fetchX });
  const rows = data?.data ?? [];
  if (!rows.length) toast.error('No sessions found');
  return <div><Table rows={rows} /></div>;
}`,
    // no query hook: a purely local emptiness test cannot be a failed read
    () => `function P({ items }) {
  return <div>{!items.length ? <p>No drafts found</p> : <Table rows={items} />}</div>;
}`,
    // a mutation's onError, which already has a channel
    () => `function P() {
  const m = useMutation({ mutationFn: save, onError: () => setError('No rows found') });
  return <div>{!rows.length ? <p>No sessions found</p> : <Table rows={rows} />}</div>;
}`,
    // the object bound whole, then its error read off it — what #2823 did and the
    // first pass of this guard could not see
    () => `function P() {
  const q = useApiQuery(['superadmin', 'backups', 'schedules'], '/api/superadmin/backups');
  const rows = q.data?.data ?? [];
  return <div>{!rows.length ? (
    q.error ? <InlineErrorState message="Could not load the backup schedules." onRetry={() => void q.refetch()} />
      : <p>No backup schedules configured</p>
  ) : <Table rows={rows} />}</div>;
}`,
    // …the same read spelled `isError`, which TanStack also offers
    () => `function P() {
  const q = useApiQuery(['superadmin', 'users'], '/api/superadmin/users');
  const rows = q.data?.data ?? [];
  return <div>{!rows.length && q.isError ? (
    <div role="alert">Failed to load users: {q.error.message}. An empty table would mean no account exists.</div>
  ) : !rows.length ? <p>No users found</p> : <Table rows={rows} />}</div>;
}`,
    // …or destructured off the object one line later
    () => `function P() {
  const q = useApiQuery(['superadmin', 'tenants'], '/api/superadmin/tenants');
  const { error } = q;
  const rows = q.data?.data ?? [];
  return <div>{!rows.length ? (
    error ? <InlineErrorState message="Could not load organizations." onRetry={() => void q.refetch()} />
      : <p>No organizations found</p>
  ) : <Table rows={rows} />}</div>;
}`,
  ];
  for (const [i, build] of clean.entries()) {
    it(`clean #${i + 1}: ${build().match(EMPTY_SENTENCE)?.[0] ?? ''}`, () => {
      expect(inspect('app/tenant/clean/page.tsx', build()).offends).toBe(false);
    });
  }

  it('does not treat a sentence that is not rendered as copy', () => {
    // The words are a variable the page never prints.
    const src = `const LABEL = 'No sessions found';
function P() {
  const { data } = useApiQuery({ queryKey: ['x'], queryFn: fetchX });
  const rows = data?.data ?? [];
  return <div>{!rows.length ? <Spinner /> : <Table rows={rows} />}</div>;
}`;
    expect(inspect('app/tenant/w/page.tsx', src).offends).toBe(false);
  });
});

describe('the guard against the real tree (#2829)', () => {
  it('is not vacuous: the walker and each regex work', () => {
    const files = [...walk(`${process.cwd()}/app`)].filter((f) => f.endsWith('.tsx'));
    expect(files.length, 'the walk found no .tsx — a screen over nothing prints OK').toBeGreaterThan(200);
    expect(QUERY_RE.test('const { data, isLoading } = useApiQuery({')).toBe(true);
    expect(OBJECT_QUERY_RE.test('const usersQuery = useApiQuery([\'a\', \'b\'], \'/api/b\')')).toBe(true);
    expect(readsQueryError('q', 'if (q.error) throw q;')).toBe(true);
    expect(readsQueryError('q', 'toast.error(d.error)')).toBe(false);
    expect(EMPTY_SENTENCE.test('No sessions found')).toBe(true);
    expect(EMPTY_TEST.test('{!rows.length ? (')).toBe(true);
    expect(FAILURE_AFFORDANCE.test('<InlineErrorState message="x" />')).toBe(true);
    expect(rendersFalseEmpty(['  const rows = data?.data ?? [];', '  {!rows.length ? (', '    <p>No sessions found</p>']).line)
      .toBe(3);
  });

  it('the object-bound spelling is not hypothetical: the tree is full of it', () => {
    // #2829's first pass reported 54 panels and the true count was 58, because
    // every super-admin panel reads `const q = useApiQuery(...)` and the screen
    // only recognised a destructuring list. If that shape ever disappears from
    // the tree the regex should be deleted, not left to pass silently.
    const objectBound = [...walk(`${process.cwd()}/app`)]
      .filter((f) => f.endsWith('.tsx'))
      .filter((f) => {
        OBJECT_QUERY_RE.lastIndex = 0;
        return OBJECT_QUERY_RE.test(readFileSync(f, 'utf8'));
      });
    expect(objectBound.length, 'no file binds a query result as an object').toBeGreaterThan(10);
  });

  it('the four object-bound panels this slice fixed are clean and unlisted', () => {
    const baseline = loadBaseline(process.cwd());
    for (const rel of [
      'app/superadmin/users/page.tsx',
      'app/superadmin/tenants/page.tsx',
      'app/superadmin/backups/page.tsx',
      'app/tenant/reports/page.tsx',
    ]) {
      const src = readFileSync(`${process.cwd()}/${rel}`, 'utf8');
      expect(inspect(rel, src).offends, `${rel} still prints an empty sentence over a failed read`).toBe(false);
      expect(baseline.has(rel), `${rel} must not be allowlisted`).toBe(false);
      // and the guard is looking at the read the page actually has: a query
      // object whose error the page now reads.
      const ids = [...src.matchAll(OBJECT_QUERY_RE)].map((m) => m[1]);
      expect(ids.length, `${rel} no longer binds a query object — update this test`).toBeGreaterThan(0);
      expect(ids.some((id) => readsQueryError(id, src)), `${rel} reads no query error`).toBe(true);
    }
  });

  it('reads the copy under the branch above it, not the line it happens to sit on', () => {
    // Looking forwards from the test would miss this: the sentence is three lines
    // below the `{!rows.length ? (` that decides it.
    const lines = ['{!rows.length ? (', '  <Card>', '    <Icon />', '    <p>No backups yet</p>'];
    expect(rendersFalseEmpty(lines)).toMatchObject({ line: 4, text: 'No backups yet' });
  });

  it('passes on this tree, which is the point of the fix', () => {
    const { novel, stale } = scan(process.cwd(), { baseline: loadBaseline(process.cwd()) });
    expect(novel.map((o) => o.why)).toEqual([]);
    expect(stale).toEqual([]);
  });

  it('the baseline is a real list: every entry exists, names an issue, and still offends', () => {
    const baseline = loadBaseline(process.cwd());
    expect(baseline.size, 'an empty baseline means this test proves nothing').toBeGreaterThan(10);
    const offending = new Map(scan(process.cwd()).offenders.map((o) => [o.why.split(':')[0], o.why]));
    for (const [rel, reason] of baseline) {
      expect(existsSync(`${process.cwd()}/${rel}`), `${rel} is gone — drop the entry`).toBe(true);
      expect(reason, `${rel} needs the issue that carries it`).toMatch(/^#\d{4}:/);
      const found = offending.get(rel);
      expect(found, `${rel} is allowlisted but no longer prints an empty sentence over a failed read`).toBeTruthy();
      // The reason is documentation, so it has to say which shape the page has:
      // #2829's own sweep said "never binds error" about 54 pages and 29 of them
      // do bind it — they toast it and leave the sentence up.
      const claimsBound = /binds `error`/.test(reason);
      expect(claimsBound, `${rel}'s reason names the wrong shape`).toBe(/`error` bound but never rendered/.test(found!));
    }
  });

  it('the files this slice fixed are no longer in the baseline', () => {
    const baseline = loadBaseline(process.cwd());
    for (const rel of [
      'app/tenant/settings/sessions/page.tsx',
      'app/tenant/settings/api-keys/page.tsx',
      'app/tenant/settings/webhooks/dlq/page.tsx',
      'app/tenant/trash/page.tsx',
      'app/tenant/settings/backup/page.tsx',
      'app/superadmin/announcements/page.tsx',
      'app/superadmin/rate-limits/page.tsx',
      'app/superadmin/usage/page.tsx',
    ]) {
      expect(baseline.has(rel), `${rel} was fixed in this PR and must not stay listed`).toBe(false);
    }
    for (const rel of [
      'app/tenant/settings/sessions/page.tsx',
      'app/tenant/settings/api-keys/page.tsx',
      'app/tenant/settings/webhooks/dlq/page.tsx',
      'app/tenant/trash/page.tsx',
      'app/tenant/settings/backup/page.tsx',
      'app/superadmin/announcements/page.tsx',
      'app/superadmin/rate-limits/page.tsx',
      'app/superadmin/usage/page.tsx',
    ]) {
      expect(inspect(rel, readFileSync(`${process.cwd()}/${rel}`, 'utf8')).offends, `${rel} still offends`).toBe(false);
    }
  });

  it('wiring: the guard is reachable from npm and from CI', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(pkg.scripts['guard:panel-error-state']).toBe('node scripts/check-panel-error-state.mjs');
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(ci).toContain('npm run guard:panel-error-state');
  });
});
