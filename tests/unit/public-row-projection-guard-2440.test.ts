/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Guard tests for `scripts/check-public-row-projection.mts` — writes (#2440),
 * `.select()` reads (#2443), `db.query` relational reads (#2457), and the
 * proxy-derived scope plus the inline waiver (#2459).
 *
 * A guard that finds nothing looks identical to a guard that passes, so the
 * suite has to plant the violation it exists to catch, and then prove the real
 * tree is clean. The waiver is the newest way to make a guard pass by accident,
 * so it gets the same treatment: planted, and pinned to the one site that uses it.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  enumerateHandlers,
  findWriteSites,
  findings,
  findReadSites,
  readFindings,
  findRelationalReadSites,
  relationalFindings,
  hasTopLevelColumns,
  maskHandlerBodies,
  stripComments,
  findExemptMarkers,
  applyExemptions,
  EXEMPT_WINDOW,
  publicApiPaths,
  routeDirFor,
  resolveScope,
  run,
  MIN_PUBLIC_WRITE_SITES,
  MIN_PUBLIC_READ_SITES,
  MIN_PUBLIC_RELATIONAL_READ_SITES,
} from '../../scripts/check-public-row-projection.mts';

const FILE = 'app/api/public/tickets/route.ts';
const ROOT = join(import.meta.dirname!, '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'check-public-row-projection.mts');

/** An unprojected relational read, planted at a known line. */
function plantedRead(line: number) {
  return [{ file: FILE, verb: 'POST', line, table: 'contacts', method: 'findFirst' as const, unprojected: true }];
}

function sitesFor(source: string) {
  return enumerateHandlers(source, FILE).flatMap((h) => findWriteSites(h.body, h.file, h.verb, h.line));
}

function readSitesFor(source: string) {
  return enumerateHandlers(source, FILE).flatMap((h) => findReadSites(h.body, h.file, h.verb, h.line));
}

function relationalSitesFor(source: string) {
  return enumerateHandlers(source, FILE).flatMap((h) => findRelationalReadSites(h.body, h.file, h.verb, h.line));
}

describe('check-public-row-projection', () => {
  it('flags an argument-less .returning() in a public write', () => {
    const src = [
      'export async function POST(request: NextRequest) {',
      '  const [ticket] = await db.insert(supportTickets).values({ subject }).returning();',
      '  return NextResponse.json({ data: ticket }, { status: 201 });',
      '}',
    ].join('\n');
    const sites = sitesFor(src);
    expect(sites).toHaveLength(1);
    expect(sites[0].unprojected).toBe(true);
    expect(findings(sites)).toHaveLength(1);
    expect(findings(sites)[0].verb).toBe('POST');
  });

  it('accepts a named column selection', () => {
    const src = [
      'export async function POST(request: NextRequest) {',
      '  const [ticket] = await db.insert(supportTickets).values({ subject }).returning({',
      '    id: supportTickets.id,',
      '    subject: supportTickets.subject,',
      '  });',
      '  return NextResponse.json({ data: ticket }, { status: 201 });',
      '}',
    ].join('\n');
    expect(findings(sitesFor(src))).toEqual([]);
  });

  it('treats an empty selection object as unprojected', () => {
    const src = [
      'export async function POST(request: NextRequest) {',
      '  const [row] = await db.insert(t).values(v).returning({});',
      '}',
    ].join('\n');
    expect(findings(sitesFor(src))).toHaveLength(1);
  });

  it('does not mistake the prose that explains the rule for a violation', () => {
    const src = [
      'export async function POST(request: NextRequest) {',
      '  // an argument-less .returning() returns the whole row',
      '  /* .returning() is what leaked portal_token (#2440) */',
      '  const [row] = await db.insert(t).values(v).returning({ id: t.id });',
      '}',
    ].join('\n');
    expect(sitesFor(src)).toHaveLength(1);
    expect(findings(sitesFor(src))).toEqual([]);
  });

  it('keeps every newline when blanking comments, so reported lines stay true', () => {
    const src = ['// one', '/* two\nthree */', 'four'].join('\n');
    const stripped = stripComments(src);
    expect(stripped.split('\n')).toHaveLength(4);
    expect(stripped).not.toContain('one');
    expect(stripped).toContain('four');
  });

  it('reports the line of the call, not the line of the handler', () => {
    const src = [
      'export async function GET(request: NextRequest) {',
      '  const a = 1;',
      '  const b = await db.insert(t).values(v).returning();',
      '}',
    ].join('\n');
    expect(findWriteSites(src.split('\n').slice(0, 4).join('\n'), FILE, 'GET', 1)[0].line).toBe(3);
  });

  it('counts write sites across every handler of a file', () => {
    const src = [
      'export async function POST(request: NextRequest) {',
      '  await db.insert(t).values(v).returning({ id: t.id });',
      '}',
      '',
      'export async function PATCH(request: NextRequest) {',
      '  await db.insert(u).values(v).returning();',
      '}',
    ].join('\n');
    const sites = sitesFor(src);
    expect(sites).toHaveLength(2);
    expect(sites.map((s) => s.verb)).toEqual(['POST', 'PATCH']);
  });

  it('flags an argument-less .select() — the read half of the same class (#2443)', () => {
    const src = [
      'export async function GET(request: NextRequest) {',
      '  const [ticket] = await db.select().from(supportTickets).limit(1);',
      '  return NextResponse.json({ data: { ticket } });',
      '}',
    ].join('\n');
    const sites = readSitesFor(src);
    expect(sites).toHaveLength(1);
    expect(sites[0].unprojected).toBe(true);
    expect(readFindings(sites)).toHaveLength(1);
    expect(readFindings(sites)[0].verb).toBe('GET');
  });

  it('accepts both a literal column map and a shared projection passed by name', () => {
    const src = [
      'export async function GET(request: NextRequest) {',
      '  const a = await db.select({ id: t.id, subject: t.subject }).from(t);',
      '  const b = await db.select(PUBLIC_TICKET_COLUMNS).from(t);',
      '  const c = await db',
      '    .select(PUBLIC_TICKET_COLUMNS)',
      '    .from(t);',
      '}',
    ].join('\n');
    const sites = readSitesFor(src);
    expect(sites).toHaveLength(3);
    expect(readFindings(sites)).toEqual([]);
  });

  it('treats an empty selection object as unprojected', () => {
    const src = [
      'export async function GET(request: NextRequest) {',
      '  const [row] = await db.select({}).from(t);',
      '}',
    ].join('\n');
    expect(readFindings(readSitesFor(src))).toHaveLength(1);
  });

  it('does not mistake the prose that explains the rule for a violation', () => {
    const src = [
      'export async function GET(request: NextRequest) {',
      '  // db.select() with no argument list is SELECT *',
      '  /* .select() is what leaked metadata.resolution (#2443) */',
      '  const [row] = await db.select({ id: t.id }).from(t);',
      '}',
    ].join('\n');
    const sites = readSitesFor(src);
    expect(sites).toHaveLength(1);
    expect(readFindings(sites)).toEqual([]);
  });

  it('reports the line of the read, not the line of the handler', () => {
    const src = [
      'export async function GET(request: NextRequest) {',
      '  const limited = await checkRateLimit(request);',
      '  const [ticket] = await db.select().from(supportTickets).limit(1);',
      '}',
    ].join('\n');
    expect(findReadSites(src, FILE, 'GET', 1)[0].line).toBe(3);
  });

  it('audits a module-level helper that builds the response, not only the handler body', () => {
    const src = [
      'async function ticketWithReplies(id: string) {',
      '  return db.select().from(supportTickets).limit(1);',
      '}',
      'export async function GET(request: NextRequest) {',
      '  return ticketWithReplies("t1");',
      '}',
    ].join('\n');
    const handlers = enumerateHandlers(src, FILE);
    // Handler bodies alone prove nothing: the read sits above them.
    expect(handlers.flatMap((h) => findReadSites(h.body, h.file, h.verb, h.line))).toEqual([]);
    const sites = findReadSites(maskHandlerBodies(src, handlers), FILE, 'module', 1);
    expect(sites).toHaveLength(1);
    expect(sites[0].unprojected).toBe(true);
    expect(sites[0].line).toBe(2);
  });

  it('flags db.query.<table>.findFirst() that names no columns — the third spelling (#2457)', () => {
    // Exactly the shape that survived #2440 and #2443: the anonymous ticket
    // embed looked a contact up through the relational API, which has neither a
    // `.select(` nor a `.returning(` token for the other two regexes to match.
    const src = [
      'export async function POST(request: NextRequest) {',
      '  const contact = await db.query.contacts.findFirst({',
      '    where: and(eq(contacts.tenantId, tenant_id), eq(contacts.email, email)),',
      '  });',
      '  return NextResponse.json({ data: { id: contact.id } });',
      '}',
    ].join('\n');
    const sites = relationalSitesFor(src);
    expect(sites).toHaveLength(1);
    expect(sites[0].table).toBe('contacts');
    expect(sites[0].method).toBe('findFirst');
    expect(sites[0].unprojected).toBe(true);
    expect(relationalFindings(sites)).toHaveLength(1);
    expect(relationalFindings(sites)[0].verb).toBe('POST');
  });

  it('accepts a top-level columns projection wherever it sits in the options', () => {
    const src = [
      'export async function GET(request: NextRequest) {',
      '  const a = await db.query.contacts.findFirst({',
      '    columns: { id: true, tenantId: true },',
      '    where: eq(contacts.id, id),',
      '  });',
      '  const b = await db.query.contacts.findMany({',
      '    where: eq(contacts.email, email),',
      '    columns: { id: true },',
      '  });',
      '}',
    ].join('\n');
    const sites = relationalSitesFor(src);
    expect(sites).toHaveLength(2);
    expect(sites.map((s) => s.method)).toEqual(['findFirst', 'findMany']);
    expect(relationalFindings(sites)).toEqual([]);
  });

  it('does not credit a projection that only narrows the with: side', () => {
    // `with: { tickets: { columns: {...} } }` is the shape this rule invites a
    // reader to mistake for compliance: the nested rows get narrow, the row in
    // scope stays the whole table.
    const src = [
      'export async function GET(request: NextRequest) {',
      '  const contact = await db.query.contacts.findFirst({',
      '    where: eq(contacts.id, id),',
      '    with: { tickets: { columns: { id: true } } },',
      '  });',
      '}',
    ].join('\n');
    const sites = relationalSitesFor(src);
    expect(sites).toHaveLength(1);
    expect(sites[0].unprojected).toBe(true);
  });

  it('flags a call whose options it cannot read, rather than assuming a projection', () => {
    const src = [
      'export async function GET(request: NextRequest) {',
      '  const a = await db.query.contacts.findFirst();',
      '  const b = await db.query.contacts.findFirst(opts);',
      '}',
    ].join('\n');
    const sites = relationalSitesFor(src);
    expect(sites).toHaveLength(2);
    expect(relationalFindings(sites)).toHaveLength(2);
  });

  it('does not mistake the prose that explains the relational rule for a violation', () => {
    const src = [
      'export async function POST(request: NextRequest) {',
      '  // db.query.contacts.findFirst({ where }) is SELECT * of the row',
      '  /* an unprojected findFirst() is what #2457 closes */',
      '  const contact = await db.query.contacts.findFirst({',
      '    where: eq(contacts.id, id),',
      '    columns: { id: true },',
      '  });',
      '}',
    ].join('\n');
    const sites = relationalSitesFor(src);
    expect(sites).toHaveLength(1);
    expect(relationalFindings(sites)).toEqual([]);
  });

  it('tracks depth through a quoted value, so a brace in a string is not structure', () => {
    expect(hasTopLevelColumns("where: sql`email = '{'`, columns: { id: true }")).toBe(true);
    expect(hasTopLevelColumns('with: { tickets: { orderBy: sql`x = \'}\'` } }')).toBe(false);
  });

  it('reports the line of the relational read, not the line of the handler', () => {
    const src = [
      'export async function GET(request: NextRequest) {',
      '  const limited = await checkRateLimit(request);',
      '  const contact = await db.query.contacts.findFirst({ where: eq(contacts.id, id) });',
      '}',
    ].join('\n');
    expect(findRelationalReadSites(src, FILE, 'GET', 1)[0].line).toBe(3);
  });

  it('audits a module-level helper that reads through the relational API too', () => {
    const src = [
      'async function contactFor(email: string) {',
      '  return db.query.contacts.findFirst({ where: eq(contacts.email, email) });',
      '}',
      'export async function GET(request: NextRequest) {',
      '  return contactFor("a@b.c");',
      '}',
    ].join('\n');
    const handlers = enumerateHandlers(src, FILE);
    expect(handlers.flatMap((h) => findRelationalReadSites(h.body, h.file, h.verb, h.line))).toEqual([]);
    const sites = findRelationalReadSites(maskHandlerBodies(src, handlers), FILE, 'module', 1);
    expect(sites).toHaveLength(1);
    expect(sites[0].unprojected).toBe(true);
    expect(sites[0].line).toBe(2);
  });

  it('refuses to certify a tree it did not walk', () => {
    expect(() => run('.', { dirs: ['scripts'] })).toThrow();
    expect(MIN_PUBLIC_WRITE_SITES).toBeGreaterThan(1);
    expect(MIN_PUBLIC_READ_SITES).toBeGreaterThan(1);
    expect(MIN_PUBLIC_RELATIONAL_READ_SITES).toBeGreaterThan(1);
  });

  it('passes on the real anonymous surface', () => {
    const result = run('.');
    expect(result.problems).toEqual([]);
    expect(result.writes).toBeGreaterThanOrEqual(MIN_PUBLIC_WRITE_SITES);
    expect(result.reads).toBeGreaterThanOrEqual(MIN_PUBLIC_READ_SITES);
    expect(result.relational).toBeGreaterThanOrEqual(MIN_PUBLIC_RELATIONAL_READ_SITES);
  });

  it('has exactly one waiver on the whole surface, and it is the one #2459 documented', () => {
    // An exemption that nobody can count is how "zero exceptions" quietly becomes
    // a baseline. Pinning the file turns the header's claim into a check: adding a
    // second marker is a decision someone has to make consciously, in a PR.
    const result = run('.');
    expect(result.waived.map((w) => w.file)).toEqual(['app/api/forms/submit/route.ts']);
  });

  describe('the inline waiver', () => {
    it('excuses the read a marker sits above, and says which issue paid for it', () => {
      const result = run('.', { relationalSites: plantedRead(281), markers: [{ file: FILE, line: 279, issue: '2459' }] });
      expect(result.problems).toEqual([]);
      expect(result.waived).toHaveLength(1);
      expect(result.waived[0].detail).toContain('waived by #2459');
      // The site is still counted: a waiver hides a response, not the audit of
      // how many reads the surface has, and the floors depend on that count.
      expect(result.relational).toBe(1);
    });

    it('reaches the window exactly three lines above the call, and no further', () => {
      const call = 300;
      const near = run('.', {
        relationalSites: plantedRead(call),
        markers: [{ file: FILE, line: call - EXEMPT_WINDOW, issue: '2459' }],
      });
      expect(near.problems).toEqual([]);
      const far = run('.', {
        relationalSites: plantedRead(call),
        markers: [{ file: FILE, line: call - EXEMPT_WINDOW - 1, issue: '2459' }],
      });
      // Two findings, both honest: the read is still unprojected, and the marker
      // that thought it was covering the read is itself reported as covering
      // nothing — that is what tells the author to move it down two lines.
      expect(far.problems).toHaveLength(2);
      expect(far.problems.find((p) => p.verb !== 'marker')!.detail).toContain('SELECT *');
      expect(far.problems.find((p) => p.verb === 'marker')!.detail).toContain('covering nothing');
    });

    it('refuses a marker that cites no issue', () => {
      const result = run('.', { relationalSites: plantedRead(281), markers: [{ file: FILE, line: 280, issue: null }] });
      expect(result.waived).toEqual([]);
      expect(result.problems).toHaveLength(1);
      expect(result.problems[0].detail).toContain('cites no issue');
    });

    it('fails a marker that covers nothing — the stale one is the dangerous one', () => {
      // The call below it gained its projection. The marker is now decoration
      // over a compliant read, which is exactly the shape the next editor copies.
      const src = [
        'export async function POST(request: NextRequest) {',
        '  // row-projection-exempt: #2459 nothing here needs waiving',
        '  const contact = await db.query.contacts.findFirst({',
        '    where: eq(contacts.id, id),',
        '    columns: { id: true },',
        '  });',
        '}',
      ].join('\n');
      const markers = findExemptMarkers(src, FILE);
      expect(markers).toEqual([{ file: FILE, line: 2, issue: '2459' }]);
      const sites = relationalSitesFor(src);
      expect(relationalFindings(sites)).toEqual([]);
      const result = applyExemptions([], markers);
      expect(result.problems).toHaveLength(1);
      expect(result.problems[0].verb).toBe('marker');
      expect(result.problems[0].line).toBe(2);
      expect(result.problems[0].detail).toContain('covering nothing');
    });

    it('does not mistake the prose that explains the waiver for a waiver', () => {
      const src = [
        '/**',
        ' * Write `// row-projection-exempt: #1` above a read you mean to leave wide.',
        ' * That comment is documentation, not a marker.',
        ' */',
        '  // row-projection-exempt: #2459 this one is',
        '  const x = "// row-projection-exempt: #3 in a string";',
      ].join('\n');
      expect(findExemptMarkers(src, FILE).map((m) => m.line)).toEqual([5]);
    });

    it('waives per file, so a marker cannot reach across to another route', () => {
      const result = run('.', {
        relationalSites: plantedRead(281),
        markers: [{ file: 'app/api/public/other/route.ts', line: 279, issue: '2459' }],
      });
      expect(result.problems.map((p) => p.file).sort()).toEqual(
        ['app/api/public/other/route.ts', FILE].sort(),
      );
      expect(result.waived).toEqual([]);
    });
  });

  describe('the scope comes from the edge, not from a folder name', () => {
    const proxySource = readFileSync(join(ROOT, 'proxy.ts'), 'utf8');
    const paths = publicApiPaths(proxySource);

    it('lists every /api/ entry of PUBLIC_PATHS and PUBLIC_PREFIXES, and no page path', () => {
      // #2459 is the routes that live outside a folder called `public`: the
      // portal login that mints the session cookie, the webhook receivers, the
      // cron sweeps on their secret, the gateway prefix.
      expect(paths).toContain('/api/tenant/portal/login');
      expect(paths).toContain('/api/webhooks/inbound');
      expect(paths).toContain('/api/cron');
      expect(paths).toContain('/api/forms/submit');
      expect(paths).toContain('/api/v2');
      expect(paths.every((p) => p.startsWith('/api/'))).toBe(true);
      expect(paths).not.toContain('/portal');
      // PP-061 moved the OAuth exchange and the inbound receivers ONTO this list, so
      // they are no longer evidence of anything here — and the projection guard's
      // scope has to follow them, which these two assertions now pin. The routes that
      // must stay OFF it are the consent screen (a browser that already has a
      // session) and the credential-less, limiter-less anonymous visitor write.
      expect(paths).toContain('/api/auth/oauth/token');
      expect(paths).toContain('/api/webhooks/payu');
      expect(paths).not.toContain('/api/auth/oauth/authorize');
      expect(paths).not.toContain('/api/tenant/visitors/track');
    });

    it('does not widen the scope out of a comment that quotes a path', () => {
      const src = [
        '// the old list said `PUBLIC_PATHS = [\'/api/gone\']` — see #2415',
        'const PUBLIC_PATHS = [',
        "  '/api/real',",
        '];',
        "const PUBLIC_PREFIXES = ['/_next', '/api/prefixed'];",
      ].join('\n');
      expect(publicApiPaths(src)).toEqual(['/api/prefixed', '/api/real']);
    });

    it('maps an edge path to the directory that serves it', () => {
      expect(routeDirFor('/api/public/tickets')).toBe(join('app', 'api', 'public', 'tickets'));
      expect(() => routeDirFor('/portal/tickets')).toThrow();
      expect(() => routeDirFor('/api')).toThrow();
    });

    it('separates the public paths that have a route from the ones that only have an edge rule', () => {
      const scope = resolveScope('.', paths);
      expect(scope.dirs.length).toBeGreaterThan(30);
      // Measured: the edge opens two doors that nothing is behind. This is the
      // #2415 class, reported rather than failed — a route that does not exist
      // cannot leak a row, but it must not stay invisible either.
      expect(scope.unresolved).toEqual(['/api/lead-capture', '/api/lead-capture/submit']);
    });

    it('walks the derived tree instead of a hardcoded one, and finds the reads the old scope missed', () => {
      const portalLogin = run('.', { dirs: ['app/api/tenant/portal/login', 'app/api/cron'] });
      expect(portalLogin.relational).toBeGreaterThan(0);
      expect(portalLogin.problems).toEqual([]);
      // The claim is about coverage, not about either subtree: the derived scope
      // screens reads the folder-hardcoded one never reached.
      const oldScope = run('.', { dirs: ['app/api/public'] });
      expect(run('.').relational).toBeGreaterThan(oldScope.relational);
    });
  });

  it('surfaces a planted relational site through the same seam as the others', () => {
    // Without this, `run` would still walk the disk for a planted write-only
    // run and the class the test is exercising would go unreported.
    const planted = run('.', {
      relationalSites: [
        { file: FILE, verb: 'POST', line: 127, table: 'contacts', method: 'findFirst', unprojected: true },
      ],
    });
    expect(planted.problems).toHaveLength(1);
    expect(planted.problems[0].detail).toContain('db.query.contacts.findFirst');
    expect(planted.writes).toBe(0);
    expect(planted.reads).toBe(0);
    expect(planted.relational).toBe(1);
  });

  it('would fail the tree that #2443 removed, if it came back', () => {
    // The detail route read the whole ticket and shipped it minus the token. If
    // that ever returns, the guard has to catch it — planted here rather than
    // trusted from the real-tree run above.
    const planted = run('.', {
      readSites: [{ file: 'app/api/public/tickets/[id]/route.ts', verb: 'GET', line: 24, unprojected: true }],
    });
    expect(planted.problems).toHaveLength(1);
    expect(planted.problems[0].file).toContain('public/tickets');
  });
});

/**
 * The CLI, as an auditor runs it.
 *
 * `--json` is how this guard gets pointed at a tree outside its own scope, and
 * that is where it under-reported: `process.exit()` discards stdout that has not
 * drained into the pipe, so a 194,406-character audit of `app/api` arrived as
 * 65,536 characters — the size of the pipe buffer — with exit status 1 and a
 * prefix that looks like output. The caller then either fails to parse or,
 * worse, parses a truncated list and reasons about the findings that were left
 * out. Measured 4 failures in 4 runs against the old exit path, 0 against
 * `process.exitCode`.
 */
describe('the guard as an auditor runs it', () => {
  function cli(args: string[]) {
    return spawnSync(process.execPath, ['--import', 'tsx', SCRIPT, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  }

  it('delivers a complete --json document, not as much as the pipe had room for', () => {
    const wide = cli(['--json', 'app/api']);
    expect(wide.status).toBe(1);
    // The fixture has to be bigger than the pipe, or this proves nothing.
    expect(wide.stdout.length).toBeGreaterThan(65_536);
    const parsed = JSON.parse(wide.stdout) as { problems: unknown[]; relational: number };
    const inProcess = run('.', { dirs: ['app/api'] });
    expect(parsed.problems).toHaveLength(inProcess.problems.length);
    expect(parsed.relational).toBe(inProcess.relational);
  });

  it('counts the relational reads it screened, on the tree it owns', () => {
    // No directory argument: the tree this guard owns is the one proxy.ts
    // describes, and the floors are calibrated for exactly that run (#2459).
    const own = cli(['--json']);
    expect(own.status).toBe(0);
    const parsed = JSON.parse(own.stdout) as {
      relational: number; problems: unknown[]; waived: unknown[]; unresolved: string[];
    };
    expect(parsed.problems).toEqual([]);
    expect(parsed.relational).toBeGreaterThanOrEqual(MIN_PUBLIC_RELATIONAL_READ_SITES);
    expect(parsed.waived).toHaveLength(1);
  });

  it('names the public paths that have no route behind them', () => {
    const own = cli([]);
    expect(own.status).toBe(0);
    expect(own.stdout).toContain('/api/lead-capture is in proxy.ts');
  });

  it('still refuses a directory argument that points at no routes', () => {
    const bad = cli(['--json', 'scripts']);
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain('no route.ts found');
  });
});
