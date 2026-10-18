/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2814 — the VM bootstrap published the one secret whose job is to keep strangers out.
 *
 * `scripts/deploy-vm.sh` writes the install's `.env.local`, and it generated two of the
 * three values in that file (`:21` `DB_PASS=$(openssl rand -hex 16)`, `:34`
 * `JWT_SECRET=$(openssl rand -hex 32)`) while hardcoding the third — the `SETUP_KEY` — and
 * sending the same literal as `X-Setup-Key`. That key is the entire gate on
 * `POST /api/setup/create-admin` (`app/api/setup/create-admin/route.ts:52-57`), an endpoint
 * on `proxy.ts`'s public list that creates the platform's SINGLE super admin
 * (`:44-46`, `:84-89`), an admin role with `{ all: true }` (`:129-134`) and a 30-day session
 * (`:220-226`). Anyone reading the public repo could claim that admin on any VM this script
 * had provisioned; whoever writes the row first wins it, and the real owner then gets the 403.
 * The script made that outcome likely rather than theoretical: it never starts the app
 * (`grep -nE "npm (run )?(start|build)|pm2|node server"` over it finds nothing), so its own
 * `curl` to `localhost:3000` fails under `set -e` with no admin created and the key installed.
 *
 * It survived the three #2302 scrub PRs (#2357, #2436, #2469) because `.gitleaks.toml` names
 * `scripts/deploy-vm\.sh` in its `[allowlist] paths`, which is why `Secret Scan (gitleaks)` —
 * `ci.yml:187-200` over full history, and the `--no-git` path pass at `ci.yml:223-228` — has
 * been green on every PR that contained the literal. That exemption stays in place on purpose:
 * dropping it would make the history scan re-report the commits that still carry the value, and
 * no file edit can fix that. So the file is policed here instead, by a test that runs in the
 * job gitleaks cannot.
 *
 * The shape of a credential is easy to regex and easy to fake, so the two blocks that matter are
 * EXTRACTED FROM THE SHIPPED SCRIPT AND EXECUTED: the `${VAR:?}` guards, and the heredoc that
 * writes `.env.local`. That proves the failure is a failure rather than a comment.
 *
 *   1. no committed secret survives — every `SETUP_KEY`/`JWT_SECRET`/`DB_PASS` assignment is a
 *      command substitution, and the admin's email and password are read from the operator's
 *      environment, never written;
 *   2. the bootstrap refuses to run without those two variables, BEFORE the install directory is
 *      written — measured, not asserted from prose;
 *   3. what the heredoc actually writes is `SETUP_KEY=<the generated value>` and nothing that looks
 *      like an admin credential, so the secret exists once, in the install;
 *   4. the `curl` authenticates with the same per-install value and builds its body through
 *      `JSON.stringify`, because a password containing a double quote is a valid password —
 *      `lib/auth/session.ts:45` accepts `!@#$%^&*(),.?":{}|<>` as the special character — and
 *      shell interpolation of `-d "{…\"$ADMIN_PASSWORD\"…}"` would silently corrupt the request
 *      on exactly the strong passwords the policy asks for;
 *   5. the gitleaks exemption for this path is still declared and still *named* here, so nobody
 *      reads a green Secret Scan as proof that this file is clean.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../../scripts/deploy-vm.sh', import.meta.url));
const TOML = fileURLToPath(new URL('../../.gitleaks.toml', import.meta.url));
const src = readFileSync(SCRIPT, 'utf8');
const toml = readFileSync(TOML, 'utf8');

/** Lines of the shipped script, selected by a predicate, as one bash fragment. */
function extract(pattern: RegExp, opts: { until?: RegExp; includeEnd?: boolean } = {}): string {
  const lines = src.split('\n');
  const start = lines.findIndex(l => pattern.test(l));
  expect(start, `no line matched ${pattern} in scripts/deploy-vm.sh`).toBeGreaterThanOrEqual(0);
  if (opts.until) {
    const end = lines.findIndex((l, i) => i > start && opts.until!.test(l));
    expect(end, `no terminator for ${pattern}`).toBeGreaterThan(start);
    return lines.slice(start, opts.includeEnd ? end + 1 : end).join('\n');
  }
  return lines.filter(l => pattern.test(l)).join('\n');
}

/** Like `extract`, but a missing block is reported by the case that owns it rather than at
 * import: run against the published script, this file then fails on the invariant that
 * broke instead of failing to load. */
function extractLoose(pattern: RegExp): string {
  return src.split('\n').filter(l => pattern.test(l)).join('\n');
}

function runBash(body: string, env: Record<string, string> = {}): { code: number; out: string } {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-vm-'));
  try {
    const out = execFileSync('bash', ['-c', `set -e\ncd "${dir}"\n${body}`], {
      env: { ...process.env, ...env },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const files = readdirSync(dir);
    const written = files.length
      ? files.map(f => readFileSync(join(dir, f), 'utf8')).join('\n')
      : '';
    return { code: 0, out: `${out}${written}` };
  } catch (err) {
    const e = err as { status?: number; stderr?: string; stdout?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const GUARDS = extractLoose(/^: "\$\{ADMIN_(EMAIL|PASSWORD):\?/);
const HEREDOC = extract(/^cat > \.env\.local << EOF/, { until: /^EOF$/ });

/** Where the `.env.local` heredoc sits, so the two very different jobs can be told apart:
 * a line ABOVE it assigns a value, a line INSIDE it writes one into the install. */
function heredocRange(): [number, number] {
  const lines = src.split('\n');
  const start = lines.findIndex(l => /^cat > \.env\.local/.test(l));
  const end = lines.findIndex((l, i) => i > start && /^EOF$/.test(l));
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return [start, end];
}

describe('the VM bootstrap publishes no credential (#2814)', () => {
  it('generates every secret it installs and commits none', () => {
    const [start, end] = heredocRange();
    const lines = src.split('\n');

    // An assignment is where the value comes from: it must be a fresh command
    // substitution, never something a reader of the public repo can copy.
    for (const name of ['SETUP_KEY', 'DB_PASS']) {
      const assigned = lines.filter((l, i) => new RegExp(`^${name}=`).test(l) && (i < start || i > end));
      expect(assigned.length, name).toBeGreaterThan(0);
      for (const line of assigned) {
        expect(line, `${name} must be a command substitution: ${line}`).toMatch(new RegExp(`^${name}=\\$\\(`));
      }
    }

    // Inside the heredoc the same names appear again, this time as the write into the
    // install. A literal there is the published secret, so each one must expand a variable.
    // `JWT_SECRET` is the exception by design: the substitution IS its assignment site.
    for (const name of ['SETUP_KEY']) {
      const written = lines.filter((l, i) => new RegExp(`^${name}=`).test(l) && i > start && i < end);
      expect(written).toHaveLength(1);
      expect(written[0], `heredoc must expand ${name}, not spell it out`).toBe(`${name}=\${${name}}`);
    }
    expect(src).toMatch(/^SETUP_KEY=\$\{SETUP_KEY\}$/m);
  });

  it('takes the admin identity from the operator, not the commit', () => {
    expect(src).toMatch(/: "\$\{ADMIN_EMAIL:\?/);
    expect(src).toMatch(/: "\$\{ADMIN_PASSWORD:\?/);
    // The `:?` word is parsed, not just expanded: an apostrophe in it unbalances the
    // double-quoted string and bash fails on line 2 of the script, before it ever looks
    // at the environment — which is worse than the bug this file is fixing.
    const messages = src.split('\n').filter(l => /^: "\$\{ADMIN_\w+:\?/.test(l));
    expect(messages).toHaveLength(2);
    for (const line of messages) {
      expect(line, `apostrophe in a :? message breaks parsing: ${line}`).not.toMatch(/'/);
    }
    // Nothing that looks like a JSON credential pair survives in the file.
    expect(src).not.toMatch(/"password"\s*:\s*"[^$"]/);
    expect(src).not.toMatch(/"email"\s*:\s*"[^$"]/);
  });

  it('refuses to run without those two variables, and refuses before writing anything', () => {
    // Executed from the shipped lines: unset ADMIN_EMAIL is exit 2 from bash's `:?` and the
    // message is the script's own, not a test fixture.
    expect(GUARDS, 'the script asks the operator for no admin identity at all').not.toBe('');
    const noEmail = runBash(GUARDS, { ADMIN_EMAIL: '', ADMIN_PASSWORD: '' });
    expect(noEmail.code).not.toBe(0);
    expect(noEmail.out).toMatch(/ADMIN_EMAIL/);

    const both = runBash(GUARDS, {
      ADMIN_EMAIL: 'ops@corp.example',
      ADMIN_PASSWORD: 'Sentinel-Pass-42!',
    });
    expect(both.code, both.out).toBe(0);

    // And the order is the point: the guards sit above the install write, so a run that
    // cannot create an admin never leaves a half-provisioned `.env.local` behind.
    const guardLine = src.split('\n').findIndex(l => /^: "\$\{ADMIN_EMAIL:\?/.test(l));
    const writeLine = src.split('\n').findIndex(l => /^cat > \.env\.local/.test(l));
    expect(guardLine).toBeLessThan(writeLine);
  });

  it('writes the generated key into the install and no admin credential anywhere', () => {
    const res = runBash(`${HEREDOC}\nif [ -f .env.local ]; then echo FILE; fi`, {
      DB_PASS: 'sentinel-dbpass',
      SETUP_KEY: 'sentinel-setup-key',
    });
    expect(res.code, res.out).toBe(0);
    expect(res.out).toContain('SETUP_KEY=sentinel-setup-key');
    expect(res.out).toContain('DATABASE_URL=postgresql://postgres:sentinel-dbpass@');
    expect(res.out).not.toMatch(/ADMIN|admin@|"password"|password=/i);
    // JWT_SECRET is the per-install substitution, so the file has a value, not the command text.
    expect(res.out).toMatch(/^JWT_SECRET=[0-9a-f]{64}$/m);
  });

  it('authenticates the create-admin call with that same per-install value', () => {
    expect(src).toMatch(/-H "X-Setup-Key: \$\{SETUP_KEY\}"/);
    expect(src).not.toMatch(/X-Setup-Key: [^$]/);
  });

  it('builds the admin request body as JSON, not as shell interpolation', () => {
    // A double quote is an allowed special character (`lib/auth/session.ts:45`), and a backslash
    // is legal in a password too, so `-d "…\"${ADMIN_PASSWORD}\"…"` would corrupt the body on
    // exactly the strong passwords the policy asks for. node receives them as argv.
    expect(src).toMatch(/node -e .*JSON\.stringify/);
    expect(src).toMatch(/process\.argv\[1\][\s\S]*process\.argv\[2\]/);
    expect(src).toMatch(/"\$\{ADMIN_EMAIL\}" "\$\{ADMIN_PASSWORD\}"/);
  });

  it('keeps the gitleaks exemption visible, and keeps this test as the reason it is safe', () => {
    // The exemption is why three scrub PRs walked past this file; it cannot be dropped until
    // history is dealt with (#2302 part 4), so the pin lives here instead.
    expect(toml).toMatch(/scripts\/deploy-vm\\\.sh/);
    expect(src).toMatch(/#2814/);
  });

  it('does not leak the admin credentials into the install file it writes', () => {
    // `.env.local` is loaded by the app; writing the operator's password into it would put a
    // live credential in a file that deploy tooling, backups and `cat` all reach.
    const block = HEREDOC;
    expect(block).not.toMatch(/ADMIN_/);
    expect(block.match(/^[A-Z_]+=.*$/gm)).toHaveLength(4);
  });
});
