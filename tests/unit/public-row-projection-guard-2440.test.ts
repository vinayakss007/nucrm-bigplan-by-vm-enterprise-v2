/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Guard tests for `scripts/check-public-row-projection.mts` (#2440).
 *
 * A guard that finds nothing looks identical to a guard that passes, so the
 * suite has to plant the violation it exists to catch, and then prove the real
 * tree is clean.
 */
import { describe, it, expect } from 'vitest';
import {
  enumerateHandlers,
  findWriteSites,
  findings,
  stripComments,
  run,
  MIN_PUBLIC_WRITE_SITES,
} from '../../scripts/check-public-row-projection.mts';

const FILE = 'app/api/public/tickets/route.ts';

function sitesFor(source: string) {
  return enumerateHandlers(source, FILE).flatMap((h) => findWriteSites(h.body, h.file, h.verb, h.line));
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

  it('refuses to certify a tree it did not walk', () => {
    expect(() => run('.', { dirs: ['scripts'] })).toThrow();
    expect(MIN_PUBLIC_WRITE_SITES).toBeGreaterThan(1);
  });

  it('passes on the real public tree', () => {
    const result = run('.');
    expect(result.problems).toEqual([]);
    expect(result.writes).toBeGreaterThanOrEqual(MIN_PUBLIC_WRITE_SITES);
  });
});
