/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Guard tests for `scripts/check-public-row-projection.mts` — writes (#2440),
 * `.select()` reads (#2443) and `db.query` relational reads (#2457).
 *
 * A guard that finds nothing looks identical to a guard that passes, so the
 * suite has to plant the violation it exists to catch, and then prove the real
 * tree is clean.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
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
  run,
  MIN_PUBLIC_WRITE_SITES,
  MIN_PUBLIC_READ_SITES,
  MIN_PUBLIC_RELATIONAL_READ_SITES,
} from '../../scripts/check-public-row-projection.mts';

const FILE = 'app/api/public/tickets/route.ts';

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

  it('passes on the real public tree', () => {
    const result = run('.');
    expect(result.problems).toEqual([]);
    expect(result.writes).toBeGreaterThanOrEqual(MIN_PUBLIC_WRITE_SITES);
    expect(result.reads).toBeGreaterThanOrEqual(MIN_PUBLIC_READ_SITES);
    expect(result.relational).toBeGreaterThanOrEqual(MIN_PUBLIC_RELATIONAL_READ_SITES);
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
const ROOT = join(import.meta.dirname!, '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'check-public-row-projection.mts');

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
    const own = cli(['--json', 'app/api/public']);
    expect(own.status).toBe(0);
    const parsed = JSON.parse(own.stdout) as { relational: number; problems: unknown[] };
    expect(parsed.problems).toEqual([]);
    expect(parsed.relational).toBeGreaterThanOrEqual(MIN_PUBLIC_RELATIONAL_READ_SITES);
  });
});
