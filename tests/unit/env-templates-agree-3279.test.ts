/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3279 — the two committed env templates must not disagree quietly.
 *
 * `deploy/.env.production` (tracked, the Docker/compose path) and `.env.example`
 * (the template an operator on the pm2/host path copies) each carry a full set of
 * security-relevant defaults, and until now nothing compared them. The measured
 * starting state, which corrects three points in the issue report:
 *
 *   - `TRUST_PROXY` is `false` in `.env.example` and `true` in the production
 *     template, and the difference decides whether a fresh install can log in at
 *     all: `getClientIp()` (`lib/client-ip.ts:15`) returns `'unknown'` unless the
 *     value is exactly `'true'`, and `lib/rate-limit.ts:442` answers 503 for every
 *     auth-scoped action when the caller's IP is `'unknown'` (#2630).
 *   - `DATABASE_SSL` is `true` in BOTH files. The issue listed it as unset in
 *     `.env.example`; it is not, so nothing there needed changing.
 *   - `ecosystem.config.cjs` carries no `TRUST_PROXY` at all on `main`. The pin the
 *     issue attributes to #3271 exists only on the unmerged branch
 *     `fix/trust-proxy-runtime-env-3271`, so on `main` a third source encodes the
 *     decision by NOT encoding it.
 *   - `deploy/.env.production` writes `SETUP_KEY=<<<REQUIRED>>>`. That token is not
 *     a gap, it is a *value*: `app/api/setup/create-admin/route.ts:52-57` compares
 *     the header against `process.env.SETUP_KEY` with plain `!==`, so a production
 *     box that ships the template unfilled accepts the string `<<<REQUIRED>>>` as
 *     the bootstrap key for the one platform super admin. `.env.example`'s empty
 *     value is the safer of the two (`!expectedKey` ⇒ 403). The published-placeholder
 *     half of this is caught at runtime, not in the template, by
 *     `scripts/assert-runtime-env.mjs`.
 *
 * So the guarantee this file pins is: every security-relevant name is present in
 * both templates, and where both templates assign it a different value, the file
 * the operator copies states why in its own comments. A divergence that is not
 * explained is exactly the bug — the reader who opens the other file first has no
 * way to know which value is deliberate.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname!, '..', '..');
const DEV_FILE = join(ROOT, '.env.example');
const PROD_FILE = join(ROOT, 'deploy', '.env.production');
const SCRIPT = join(ROOT, 'scripts', 'assert-runtime-env.mjs');

/** The comment marker that means "this divergence is deliberate, see #3279". */
const MARKER = '#3279';

type Entry = {
  /** The literal value after `=`, or `undefined` when nothing assigns it. */
  value?: string;
  /** True when only a commented line (`# NAME=value`) mentions it. */
  commented: boolean;
  /** The contiguous `#` block directly above the assignment, plus a trailing comment. */
  notes: string;
  line: number;
};

/**
 * Parse an env template into name → entry.
 *
 * A `# NAME=value` line counts as present-and-commented (the knob is documented and
 * off), which is how `check-env-coverage.mjs` already reads `.env.example`; an entry
 * that only appears in prose does not count, because it assigns nothing.
 */
function parseTemplate(text: string): Record<string, Entry> {
  const lines = text.split('\n');
  const out: Record<string, Entry> = {};
  let block: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const commented = raw.match(/^\s*#\s*([A-Z0-9_]+)=(.*)$/);
    const assigned = raw.match(/^\s*([A-Z0-9_]+)=(.*)$/);
    if (commented && !assigned) {
      const name = commented[1];
      if (!(name in out)) {
        out[name] = { commented: true, value: undefined, notes: block.join('\n'), line: i + 1 };
      }
      block = [];
      continue;
    }
    if (assigned) {
      const name = assigned[1];
      const trailing = raw.match(/#\s*(.*)$/)?.[1] ?? '';
      out[name] = {
        commented: false,
        value: assigned[2].trim(),
        notes: `${block.join('\n')}\n${trailing}`,
        line: i + 1,
      };
      block = [];
      continue;
    }
    if (/^\s*#/.test(raw)) block.push(raw.replace(/^\s*#\s?/, ''));
    else if (!raw.trim()) block = [];
  }
  return out;
}

const devText = readFileSync(DEV_FILE, 'utf8');
const prodText = readFileSync(PROD_FILE, 'utf8');
const dev = parseTemplate(devText);
const prod = parseTemplate(prodText);

/**
 * `<<<REQUIRED>>>`-style tokens are a fill-me marker, not a value: neither template
 * holds a usable credential, so they count as agreeing. What must NOT count as
 * agreeing is one file holding a marker and the other a working value.
 */
const isPlaceholder = (value?: string) => /<<<[^>]*>>>/.test(value ?? '');
const effective = (entry?: Entry) =>
  !entry || entry.commented || isPlaceholder(entry.value) ? undefined : entry.value;

/** Names the runtime assertion table and the templates share — loaded from the table. */
async function securityFlags(): Promise<{ name: string; compare: boolean; reason: string }[]> {
  const mod = (await import(SCRIPT)) as {
    TEMPLATE_SECURITY_FLAGS: { name: string; compare?: boolean; reason?: string }[];
  };
  return mod.TEMPLATE_SECURITY_FLAGS.map((f) => ({
    name: f.name,
    compare: f.compare !== false,
    reason: f.reason ?? '',
  }));
}

describe('the two committed env templates', () => {
  it('name every security-relevant variable in both files, so neither path is missing a knob', async () => {
    const flags = await securityFlags();
    const absent: string[] = [];
    for (const { name } of flags) {
      if (!(name in dev)) absent.push(`${name} is absent from .env.example`);
      if (!(name in prod)) absent.push(`${name} is absent from deploy/.env.production`);
    }
    expect(absent).toEqual([]);
  });

  it('never assigns a security-relevant variable two different values without saying why in the copied file', async () => {
    const flags = await securityFlags();
    const unjustified: string[] = [];
    for (const { name, compare } of flags) {
      if (!compare) continue;
      const a = effective(dev[name]);
      const b = effective(prod[name]);
      if (a === undefined || b === undefined || a === b) continue;
      if (!dev[name].notes.includes(MARKER)) {
        unjustified.push(
          `${name}: .env.example=${a} vs deploy/.env.production=${b} with no ${MARKER} reason at line ${dev[name].line}`,
        );
      }
    }
    expect(unjustified).toEqual([]);
  });

  it('agrees outright on DATABASE_SSL, which #3279 listed as unset in .env.example but is not', () => {
    expect(dev.DATABASE_SSL?.value).toBe('true');
    expect(prod.DATABASE_SSL?.value).toBe('true');
  });

  it('explains the 503 beside the TRUST_PROXY default, because that is the flag that costs hours', () => {
    const notes = dev.TRUST_PROXY?.notes ?? '';
    expect(notes).toContain(MARKER);
    expect(notes).toMatch(/503/);
    expect(notes).toMatch(/2630/);
    expect(notes).toContain('getClientIp');
  });

  it('keeps the dev template from trusting proxy headers it cannot verify', () => {
    // TRUST_PROXY=true lets a client pick its own rate-limit bucket by sending
    // X-Forwarded-For, so the dev template's `false` is the safe default and the
    // fix for #3279 is the annotation plus the runtime assert, not a flip.
    expect(dev.TRUST_PROXY?.value).toBe('false');
  });

  it('tells a host operator, in the file they copy, which values a production deploy needs', () => {
    for (const line of [
      'NODE_ENV=production',
      'TRUST_PROXY=true',
      'COOKIE_SECURE=true',
      'DATABASE_SSL=true',
    ]) {
      expect(devText).toContain(line);
    }
    expect(devText).toMatch(/LAUNCH_RUNBOOK/);
  });

  it('carries the same explanation for the divergence in the production template too', async () => {
    // The operator who starts from deploy/.env.production deserves the reason as
    // well; otherwise only one of the two readers is told the two files differ.
    const flags = await securityFlags();
    const silent: string[] = [];
    for (const { name, compare } of flags) {
      if (!compare) continue;
      const a = effective(dev[name]);
      const b = effective(prod[name]);
      if (a === undefined || b === undefined || a === b) continue;
      if (!prod[name].notes.includes(MARKER)) silent.push(name);
    }
    expect(silent).toEqual([]);
  });
});

describe('the fill-me placeholder convention', () => {
  it('recognises every placeholder token the production template actually uses', async () => {
    const mod = (await import(SCRIPT)) as { valueIsUnfilledTemplateToken: (v: string) => boolean };
    const tokens = [...prodText.matchAll(/<<<[^<>]*>>>/g)].map((m) => m[0]);
    expect(tokens.length).toBeGreaterThan(5);
    const unmatched = tokens.filter((t) => !mod.valueIsUnfilledTemplateToken(t));
    expect(unmatched).toEqual([]);
  });

  it('marks SETUP_KEY required in README.md, the claim #3279 asked to verify', () => {
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
    const row = readme.split('\n').find((l) => /^\|\s*`SETUP_KEY`/.test(l));
    expect(row).toBeDefined();
    expect(row).toMatch(/\|\s*Yes\s*\|/);
  });
});
