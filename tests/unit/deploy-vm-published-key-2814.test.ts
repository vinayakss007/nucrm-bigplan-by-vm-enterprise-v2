/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #2814 — `scripts/deploy-vm.sh` shipped the one secret whose whole job is to say
 * "only the operator may create the first admin", plus the admin's email and
 * password, in a public repo.
 *
 * Three pull requests had already done #2302's document half, and the credential
 * survived all of them for a specific reason: `.gitleaks.toml` exempts this file
 * by name, so Secret Scan and the SAST path scan both walk past the one tracked
 * file that held a real pair. `app/api/setup/create-admin/route.ts:52-57` proves
 * itself with `SETUP_KEY` rather than a session, and in production that key is
 * the only gate before a super admin with `{ all: true }` and a 30-day session.
 *
 * The script is fixed by rule, not by deleting the particular literals it used to
 * contain, because a test that names the old values would republish them. Every
 * assertion below is on the *shape*: a `*_KEY` / `*_SECRET` / `*_PASS` /
 * `*_PASSWORD` assignment must be a command substitution or a reference to one,
 * the header must name the variable, the credentials must arrive from the
 * operator and fail closed before anything is written, and nothing may echo them.
 *
 * Rotation is not a code change and is not claimed here: anything ever provisioned
 * by this script must be treated as reachable (#2814, out of scope).
 *
 * #3278 rewrote the install path end to end. Nothing here was relaxed to fit it:
 * the assertions that had to change shape (`cat >"$ENV_TARGET"`, the
 * `${SETUP_KEY:-…}` default, the mktemp payload instead of `-d '{…}'`, `set -euo
 * pipefail`) guard the same claims, two were widened while at it (printing goes
 * through `say`/`printf`, not only `echo`; a `%s` slot is not a literal), and the
 * behaviour half of the new script is pinned by
 * tests/unit/deploy-vm-runnable-install-3278.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../../scripts/deploy-vm.sh', import.meta.url));
const GITLEAKS = fileURLToPath(new URL('../../.gitleaks.toml', import.meta.url));

const src = readFileSync(SCRIPT, 'utf8');
const lines = src.split('\n');

/** Line index (0-based) of the first line matching, or -1. */
const at = (re: RegExp) => lines.findIndex((l) => re.test(l));

// The credential-shaped variables this script is responsible for. A literal on any
// of these is what shipped; the check is on the assignment's right-hand SHAPE, so
// the test never has to name the value it is guarding. `$(` (a command
// substitution) and `${` (a reference to one made above) are both allowed.
const SECRET_VAR = /^[A-Za-z_]*(KEY|SECRET|PASS|PASSWORD|TOKEN)[A-Za-z_]*=(?!\$[({])/;

const envWrite = at(/cat >"\$ENV_TARGET"/);

describe('deploy-vm.sh installs secrets it does not contain (#2814)', () => {
  it('no credential-shaped variable is assigned a literal', () => {
    const offenders = lines
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => SECRET_VAR.test(line.trim()));
    expect(offenders, `literal secret assignments at line(s) ${offenders.map((o) => o.n).join(', ')}`).toEqual([]);
  });

  it('SETUP_KEY is generated per install, like the two secrets either side of it', () => {
    // #3278 rewrote the script around re-running: every secret honours a value the
    // operator already has (`${SETUP_KEY:-$(openssl rand -hex 24)}`), because a
    // second run that rotated the key the live server holds is a lockout. The
    // claim is unchanged — the value comes from openssl, never from the commit —
    // so the assertion is on the generator inside the default, not on the shape
    // of the default itself.
    expect(src).toMatch(/^SETUP_KEY=\$\{SETUP_KEY:-\$\(openssl rand -hex \d+\)\}$/m);
    // …and the .env.local line writes THAT variable, not a second value which
    // could drift away from the one the curl below sends.
    expect(src).toMatch(/^SETUP_KEY=\$\{SETUP_KEY\}$/m);
    expect(src).toContain('-H "X-Setup-Key: $SETUP_KEY"');
  });

  it('the admin identity comes from the operator, not the commit', () => {
    // The request body is built into a mktemp file (#3278: argv is readable
    // through /proc by any local process), so the shape this guards is the
    // printf: the two %s slots are filled by the operator's variables and the
    // file is deleted after the call.
    const body = lines[at(/printf '\{"email":/)] ?? '';
    expect(body, 'no create-admin request body found').not.toBe('');
    expect(body).toContain('"$ADMIN_EMAIL"');
    expect(body).toContain('"$escaped"');
    expect(src).toMatch(/^\s+payload=\$\(mktemp\)$/m);
    expect(src).toContain('--data @"$payload"');
    expect(src).toContain('rm -f "$payload"');
    // The shape the old lines had: a literal address / password in the body. A %s
    // slot or a variable reference is not a literal.
    expect(src).not.toMatch(/"email":"(?![%$\\])[^"]/);
    expect(src).not.toMatch(/"password":"(?![%$\\])[^"]/);
  });

  it('both guards fail closed BEFORE anything is written', () => {
    const emailGuard = at(/ADMIN_EMAIL=\$\{ADMIN_EMAIL:/);
    const passGuard = at(/ADMIN_PASSWORD=\$\{ADMIN_PASSWORD:/);
    expect(emailGuard, 'no ${ADMIN_EMAIL:?…} guard').toBeGreaterThan(-1);
    expect(passGuard, 'no ${ADMIN_PASSWORD:?…} guard').toBeGreaterThan(-1);
    expect(envWrite, 'no .env.local write found').toBeGreaterThan(-1);
    expect(emailGuard).toBeLessThan(envWrite);
    expect(passGuard).toBeLessThan(envWrite);
  });

  it('the password guard says what the endpoint requires', () => {
    // `app/api/setup/create-admin` enforces a minimum length twice over — the
    // zod schema at 8 and `validatePassword` at 12 with composition rules — so
    // a guard that only says "required" sends the operator into a 400 they
    // cannot read.
    const guardLine = lines[at(/ADMIN_PASSWORD=\$\{ADMIN_PASSWORD:/)] ?? '';
    expect(guardLine).toMatch(/8/);
    expect(guardLine).toMatch(/12/);
  });

  it('neither credential is echoed', () => {
    // #3278 moved the script's printing onto a `say`/`printf` helper, so guarding
    // `echo` alone would let a value walk straight out over the operator's
    // terminal — and into the issue report they paste from it. The one exempt
    // line is the request-body write: it redirects into the mktemp file (mode
    // 600, deleted after the call) and reaches no terminal and no argv.
    const toTerminal = (l: string) => /^\s*(echo|printf|say)\b/.test(l) && /\$\{?(ADMIN_PASSWORD|SETUP_KEY|ADMIN_EMAIL)\b/.test(l);
    const toBodyFile = (l: string) => /printf .*>"\$payload"$/.test(l);
    const echoed = lines.filter((l) => toTerminal(l) && !toBodyFile(l));
    expect(echoed).toEqual([]);
  });

  it('keeps the fail-fast posture the rest of the script depends on', () => {
    // -u and pipefail are load-bearing here, not decoration: an unset variable
    // used to silently build a `postgresql://nucrm_app:@…` connection string, and
    // a pipeline whose first command failed (curl | grep) read as success.
    expect(src).toMatch(/^set -euo pipefail$/m);
  });
});

describe('the exemption that let this survive three scrub PRs', () => {
  it('still names the file, and now says why it cannot be dropped yet', () => {
    const toml = readFileSync(GITLEAKS, 'utf8');
    // Removing the path would make Secret Scan rescan full history, where the
    // literal is in every commit that ever carried it — the gate would go red for
    // a reason no file edit can fix. It comes out with the history purge
    // (#2302 part 4), and the comment is what keeps that condition visible.
    expect(toml).toContain(String.raw`'''scripts/deploy-vm\.sh'''`);
    expect(toml.toLowerCase()).toMatch(/history|purge|pre-2814/);
  });
});
