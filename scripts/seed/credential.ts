/**
 * #3281 — the seed credential, resolved instead of hardcoded.
 *
 * `scripts/seed-dev.ts` used to hash the literal `'password123'` into a PLATFORM
 * super admin (`is_super_admin` → the `app.is_super_admin` GUC → RLS is not
 * applied), and `.github/workflows/release.yml` used the same pair as its release
 * gate login. The repository is public, so that account has a known password
 * wherever the seed has run. The literal also violated the application's own
 * policy: `password123` is 11 characters, has no uppercase and no special, and
 * `lib/auth/session.ts:38-46` rejects exactly that — so the seeded account could
 * log in but could never be re-created or changed to the same credential.
 *
 * So: the password comes from the environment, there is no fallback, and it is
 * validated against the same four rules before anything touches the database.
 *
 * Proprietary & confidential. NuCRM Enterprise — Property of abetworks.in.
 */

/** The env var this repository's seed scripts read. Never committed, never echoed. */
export const SEED_PASSWORD_ENV = 'SEED_PASSWORD';

/**
 * Mirrors `validatePassword` in `lib/auth/session.ts:38-46`. That module cannot be
 * imported from a tsx script — it pulls `next/headers` and `@/drizzle/schema` — so
 * the rules are restated here and pinned against the real one by
 * `tests/unit/seed-credential-contents-3281.test.ts`, which reads session.ts and
 * compares the thresholds. If the app policy changes, that test goes red.
 */
export const PASSWORD_MIN_LENGTH = 12;
const REQUIRE_UPPERCASE = /[A-Z]/;
const REQUIRE_DIGIT = /[0-9]/;
const REQUIRE_SPECIAL = /[!@#$%^&*(),.?":{}|<>]/;

/** The app's own policy, as a message rather than a throw. */
export function passwordPolicyError(password: string): string | null {
  if (!password || password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  if (!REQUIRE_UPPERCASE.test(password)) return 'Password must contain at least one uppercase letter';
  if (!REQUIRE_DIGIT.test(password)) return 'Password must contain at least one number';
  if (!REQUIRE_SPECIAL.test(password)) return 'Password must contain at least one special character';
  return null;
}

export interface ResolvedCredential {
  readonly password: string | null;
  readonly error: string | null;
}

/**
 * Resolve the seed password from an environment object. Two ways to fail, kept
 * distinct because the fix is different: nothing was supplied, or what was supplied
 * would not survive the app's own password change endpoint.
 */
export function resolveSeedPassword(
  env: Record<string, string | undefined> = process.env,
): ResolvedCredential {
  const raw = env[SEED_PASSWORD_ENV];
  if (raw === undefined || raw === '') {
    return {
      password: null,
      error:
        `${SEED_PASSWORD_ENV} is not set. The seed creates a platform super admin, so it ` +
        'needs a password you own — there is no committed default (#3281). Generate one, e.g. ' +
        `node -e "console.log(require('crypto').randomBytes(12).toString('base64url')+'A1!')" ` +
        `and export it before running the seed.`,
    };
  }
  const policy = passwordPolicyError(raw);
  return policy ? { password: null, error: `${SEED_PASSWORD_ENV} is set but invalid: ${policy}.` } : { password: raw, error: null };
}
