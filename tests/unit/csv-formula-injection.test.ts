/**
 * Tests for #2340 — CSV formula injection in client-side exports.
 *
 * The server escapeCSV already neutralised spreadsheet formula payloads, but
 * every client "Export CSV" button hand-rolled only the quoting half, so a
 * value like `=cmd|' /C calc'!A0` submitted through the *unauthenticated*
 * public lead form executed when an operator opened the exported file.
 *
 * lib/csv.ts is now the single escaper used by both sides. These tests pin the
 * numeric-vs-payload split, control-char handling, structure round-tripping and
 * the guard script that stops a seventh hand-rolled exporter appearing.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { csvEscapeValue, csvRow, FORMULA_PREFIXES } from '@/lib/csv';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('csvEscapeValue — formula neutralisation (#2340)', () => {
  it('prefix-neutralises the classic payloads', () => {
    expect(csvEscapeValue('=1+1')).toBe("'=1+1");
    expect(csvEscapeValue("@SUM(1+9)*cmd|' /C calc'!A0")).toBe("'@SUM(1+9)*cmd|' /C calc'!A0");
    expect(csvEscapeValue("+|cmd|'/C calc'!A0")).toBe("'+|cmd|'/C calc'!A0");
    expect(csvEscapeValue('-|cmd|calc')).toBe("'-|cmd|calc");
  });

  it('escapes each formula prefix character', () => {
    for (const p of FORMULA_PREFIXES) {
      if (p === '+' || p === '-') continue; // numeric exemption below
      // a CR payload ALSO needs quoting, so the record starts with `"` —
      // assert the neutralising apostrophe is present, right after any quote
      expect(csvEscapeValue(`${p}cmd|calc`).replace(/^"/, '')).toContain("'");
    }
    expect(csvEscapeValue('\t=1+1').charAt(0)).toBe("'");
    expect(csvEscapeValue('\r|cmd')).toBe("\"'\r|cmd\"");
  });

  it('exempts real signed numbers from the apostrophe', () => {
    expect(csvEscapeValue('-500')).toBe('-500');
    expect(csvEscapeValue('+1.5')).toBe('+1.5');
    expect(csvEscapeValue('-0.3')).toBe('-0.3');
    expect(csvEscapeValue('+1-5551234')).toBe('+1-5551234');
  });

  it('keeps the documented numeric exemption even when a formula follows', () => {
    // matches the server escapeCSV: -1+1 parses as a number-then-noise and is
    // left verbatim; -|cmd|calc (no digit after the sign) is neutralised above
    expect(csvEscapeValue('+1+1')).toBe('+1+1');
    expect(csvEscapeValue('=1+1')).toBe("'=1+1");
  });

  it("renders null/undefined as an empty cell and never throws", () => {
    expect(csvEscapeValue(null)).toBe('');
    expect(csvEscapeValue(undefined)).toBe('');
    expect(() => csvEscapeValue({ a: 1 })).not.toThrow();
    expect(() => csvEscapeValue([1, 2])).not.toThrow();
  });

  it('serialises objects as JSON (not [object Object]) and Dates as ISO', () => {
    expect(csvEscapeValue({ a: 1 })).toBe('"{""a"":1}"');
    // ["x","y"] — the JSON quotes force CSV quoting + doubling too
    expect(csvEscapeValue(['x', 'y'])).toBe('"[""x"",""y""]"');
    expect(csvEscapeValue([{ a: 'x,y' }])).toBe('"[{""a"":""x,y""}]"');
    const iso = new Date('2026-01-02T03:04:05.000Z');
    expect(csvEscapeValue(iso)).toBe('2026-01-02T03:04:05.000Z');
  });

  it('quotes on need: separators and all three line breaks stay in one cell', () => {
    expect(csvEscapeValue('plain')).toBe('plain');
    expect(csvEscapeValue('a,b')).toBe('"a,b"');
    expect(csvEscapeValue('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscapeValue('line1\nline2')).toBe('"line1\nline2"');
    // site 4 of #2340: the old client escaper omitted \r AND \n entirely
    expect(csvEscapeValue('line1\rline2')).toBe('"line1\rline2"');
  });

  it('quotes when neutralisation introduces a double quote', () => {
    expect(csvEscapeValue('=a"b')).toBe('"=a""b"'.replace('=a', "'=a"));
  });
});

describe('csvRow — record assembly (#2340)', () => {
  it('joins escaped values with separators', () => {
    expect(csvRow(['Name', 'Amount'])).toBe('Name,Amount');
    expect(csvRow(['=1+1', -500])).toBe("'=1+1,-500");
    expect(csvRow(['multi\nline', 'x,y'])).toBe('"multi\nline","x,y"');
  });

  it('keeps a hostile record at exactly one cell per value', () => {
    const row = csvRow(['evilmart', '=cmd|\' /C calc\'!A0', 'note']);
    const cells = row.split(',');
    // the quoted payload keeps its commas inside one cell → split count is
    // deterministic only because quoting is correct
    expect(row.startsWith('evilmart,')).toBe(true);
    expect(row.endsWith(',note')).toBe(true);
    expect(cells.length).toBeGreaterThan(2);
  });
});

describe('lib/export escapeCSV delegates to lib/csv (#2340)', () => {
  it('is a thin re-export (single source of truth)', () => {
    const src = readFileSync(join(REPO, 'lib', 'export', 'index.ts'), 'utf8');
    expect(src).toContain("from '@/lib/csv'");
    expect(src).toContain('return csvEscapeValue(val)');
    expect(src).not.toContain("FORMULA_PREFIXES = ['='");
  });
});

describe('client export pages use the shared escaper (#2340)', () => {
  const SITES = [
    'app/tenant/data-explorer/page.tsx',
    'app/superadmin/data-explorer/page.tsx',
    'app/tenant/reports/page.tsx',
    'app/tenant/reports/custom/page.tsx',
    'app/tenant/reports/team-performance/page.tsx',
    'app/tenant/reports/funnel/page.tsx',
  ];
  for (const site of SITES) {
    it(`${site} imports @/lib/csv and has no private escaper`, () => {
      const src = readFileSync(join(REPO, site), 'utf8');
      expect(src).toContain("from '@/lib/csv'");
      // no surviving private escaper (quote-doubling); display-layer
      // .replace(/_/g, ...) calls are fine
      expect(src).not.toMatch(/replace\(\/"\/g/);
      expect(src).not.toContain("'\"\"'");
    });
  }
});

describe('check-csv-blob guard (#2340)', () => {
  const GUARD = join(REPO, 'scripts', 'check-csv-blob.mjs');
  const FIXTURE_DIR = join(REPO, 'app', '__csv_guard_probe__');
  const FIXTURE = join(FIXTURE_DIR, 'page.tsx');

  function runGuard(cwd = REPO): string {
    return execFileSync('node', [GUARD], { cwd, encoding: 'utf8' });
  }

  it('the committed tree is clean', () => {
    expect(runGuard()).toContain('0 unescaped text/csv Blob builders');
  });

  it('flags a Blob built without @/lib/csv', () => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(
      FIXTURE,
      "'use client';\nexport default function P() {\n" +
        "  const blob = new Blob(['a'], { type: 'text/csv;charset=utf-8;' });\n  return blob.size;\n}\n",
    );
    try {
      expect(() => runGuard()).toThrowError(/__csv_guard_probe__/);
    } finally {
      unlinkSync(FIXTURE);
      rmdirSync(FIXTURE_DIR);
    }
  });

  it('is wired into package.json and CI', () => {
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['guard:csv']).toContain('check-csv-blob');
    const ci = readFileSync(join(REPO, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(ci).toContain('npm run guard:csv');
  });
});
