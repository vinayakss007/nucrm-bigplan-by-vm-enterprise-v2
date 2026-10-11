/**
 * #2529 — recipient email addresses must not be interpolated into `console.*`.
 *
 * stdout is collected into Loki and retained there indefinitely, which puts it
 * outside the erasure boundary this same codebase implements for GDPR deletion:
 * `app/api/superadmin/user-data` DELETE soft-deletes records, yet the log line
 * that recorded a contact going DNC or a sequence being cancelled kept the address
 * plus that behavioural context forever.
 *
 * The convention is already in `app/api/webhooks/resend/route.ts` itself — the DROP
 * line logs `${email.split('@')[1] ?? 'no-domain'}` — and the fix follows it rather
 * than inventing a new one. Ids and domains are enough to debug a webhook; the
 * address is not.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '../..');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

const CONSOLE_CALL = /console\.(log|warn|error|info)\(`(?:[^`]|\\`)*`\)/g;
const INTERPOLATION = /\$\{([^}]*)\}/g;

/**
 * An interpolation is an address when it mentions the whole word `email` — which
 * covers `email`, `user.email` and `contact.email` while correctly ignoring
 * `emailId` / `email_id` (Resend message ids, not PII) and `emailAddress`-style
 * camelCase that would need a separate rule. `.split(` is the sanctioned
 * domain-only form from `resend/route.ts:162`, so it is exempt.
 */
function interpolatesRawAddress(expr: string): boolean {
  if (/\bemail\b/.test(expr) && !expr.includes('.split(')) return true;
  return false;
}

describe('#2529 no console line interpolates a raw email address', () => {
  const files = walk(join(ROOT, 'app/api'));

  it('scans a meaningful number of route files', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it.each(files.map((f) => [f.slice(ROOT.length + 1), f]))(
    '%s keeps addresses out of console output',
    (rel, abs) => {
      const source = readFileSync(abs, 'utf8');
      for (const call of source.matchAll(CONSOLE_CALL)) {
        for (const expr of call[0].matchAll(INTERPOLATION)) {
          expect(
            interpolatesRawAddress(expr[1]),
            `${rel}: ${call[0].slice(0, 140)} — log the domain (` +
              "`${email.split('@')[1] ?? 'no-domain'}`) or an id instead (#2529)"
          ).toBe(false);
        }
      }
    },
  );

  it('the three sites #2529 names are all domain-only or id-only now', () => {
    const resend = readFileSync(join(ROOT, 'app/api/webhooks/resend/route.ts'), 'utf8');
    const restore = readFileSync(join(ROOT, 'app/api/superadmin/user-data/route.ts'), 'utf8');

    expect(resend).toContain("marked DNC for ${email.split('@')[1] ?? 'no-domain'}");
    expect(resend).toContain("sequence enrollment(s) for ${email.split('@')[1] ?? 'no-domain'}");
    expect(restore).toContain('[User Data Restore] user=${user_id}');
    expect(restore).not.toContain('[User Data Restore] user=${user.email}');
  });
});
