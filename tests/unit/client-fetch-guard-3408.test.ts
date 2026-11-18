/**
 * #3408 — the raw-fetch ratchet must fail on a NEW client call site or a
 * growing one, and ratchet down cleanly when a caller moves to a helper.
 */
import { describe, it, expect } from 'vitest';
import {
  countRawFetches, isClientSource, checkClientFetch,
} from '../../scripts/check-client-fetch.mjs';

describe('client-fetch guard (#3408)', () => {
  it('counts fetch call sites and recognises client components', () => {
    expect(countRawFetches('fetch("/a"); await fetch(url);')).toBe(2);
    expect(countRawFetches('const x = plus(1);')).toBe(0);
    expect(isClientSource("'use client';\nexport default function P() {}")).toBe(true);
    expect(isClientSource('export const GET = () => {};')).toBe(false);
  });

  it('passes when every client raw-fetch file is pinned at its current count', () => {
    const files = ['components/a.tsx', 'app/api/route.ts'];
    const read = (f: string) => f === 'components/a.tsx'
      ? "'use client';\nfetch('/x');" : 'export async function GET() { return fetch(url); }';
    expect(checkClientFetch(files, read, { 'components/a.tsx': 1 })).toEqual([]);
  });

  it('fails when a client file adds raw fetch without a ledger entry', () => {
    const read = () => "'use client';\nfetch('/x');";
    const problems = checkClientFetch(['components/new.tsx'], read, {});
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('not in scripts/client-fetch-ledger.json');
  });

  it('fails when a pinned file grows its raw-fetch surface', () => {
    const read = () => "'use client';\nfetch('/a');\nfetch('/b');";
    const problems = checkClientFetch(['components/a.tsx'], read, { 'components/a.tsx': 1 });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('grew from 1 to 2');
  });

  it('allows a file to shrink and demands removal of a fully-migrated entry', () => {
    const read = () => "'use client';\nfetch('/a');";
    // Fewer calls than pinned is progress, not a failure.
    expect(checkClientFetch(['components/a.tsx'], read, { 'components/a.tsx': 3 })).toEqual([]);
    // Zero calls means the ledger entry is stale and must be removed.
    const problems = checkClientFetch(['components/a.tsx'], () => "'use client';\nexport default function P() {}", {
      'components/a.tsx': 1,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('no raw fetch call');
  });
});
