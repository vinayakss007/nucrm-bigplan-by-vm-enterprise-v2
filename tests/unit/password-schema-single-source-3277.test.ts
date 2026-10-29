import { describe, it, expect } from 'vitest';

/**
 * #3277 — the schema said 8, the policy said 12.
 *
 * `validatePassword()` in `lib/auth/session.ts` is the enforcement; six schemas
 * declared their own minimum next to it. An 8–11 character password therefore
 * cleared validation and was refused one screen later, with a different message
 * depending on which check fired — and on the one-time platform bootstrap, a
 * scripted caller provisioning the tenant reads the schema as the contract.
 *
 * `newPasswordSchema` is derived by *calling* `validatePassword`, so there is no
 * second number to drift. The table below is the assertion that stays true: the
 * schema and the policy accept exactly the same strings, and say the same thing
 * when they refuse.
 */

const CASES: [string, boolean][] = [
  ['Ab1!Ab1!Ab1!', true],                       // the policy, satisfied
  ['A2!aaaaaaaaaaa', true],                     // 12 chars, one of each class
  ['longenough123', false],                     // 13 chars, no uppercase, no special
  ['Password12345', false],                     // 13 chars, no special
  ['Passw0rd!2026', true],
  ['newpassword', false],                       // 11 chars — the case resetPasswordSchema used to wave through
  ['short1234', false],                         // 9 chars — the case create-admin used to wave through
  ['12345678', false],                          // exactly 8, the old declared minimum
  ['Ab1!', false],                              // 4 chars
  ['', false],
];

describe('newPasswordSchema is validatePassword, not a copy of it (#3277)', () => {
  it('accepts exactly what the policy accepts, and refuses with the policy message', async () => {
    const { newPasswordSchema } = await import('@/lib/api/schemas/auth');
    const { validatePassword } = await import('@/lib/auth/session');

    for (const [password, ok] of CASES) {
      const parsed = newPasswordSchema.safeParse(password);
      const policyError = validatePassword(password);
      expect(parsed.success, `${password} — schema said ${parsed.success}, policy said ${!policyError}`).toBe(ok);
      if (!ok) {
        expect(parsed.success).toBe(false);
        const issue = (parsed as { success: false }).error.issues[0]!;
        expect(issue.message, `${password} message`).toBe(policyError);
      }
    }
  });

  it('keeps the bcrypt cost ceiling the schemas already carried', async () => {
    const { newPasswordSchema } = await import('@/lib/api/schemas/auth');
    const long = `Ab1!${'a'.repeat(200)}`;
    expect(newPasswordSchema.safeParse(long).success).toBe(false);
    expect(long.length).toBeGreaterThan(128);
  });
});

describe('every new-password field points at the shared schema (#3277)', () => {
  const WEAK = 'short1234';
  const STRONG = 'Ab1!Ab1!Ab1!';

  it('signup, reset, invite and change-password all refuse what the policy refuses', async () => {
    const auth = await import('@/lib/api/schemas/auth');
    const { inviteMemberSchema, changePasswordSchema } = await import('@/lib/api/schemas');

    expect(auth.signupSchema.safeParse({ email: 'a@b.co', password: WEAK, full_name: 'A', workspace_name: 'W' }).success).toBe(false);
    expect(auth.signupSchema.safeParse({ email: 'a@b.co', password: STRONG, full_name: 'A', workspace_name: 'W' }).success).toBe(true);
    expect(auth.resetPasswordSchema.safeParse({ token: 't', password: WEAK }).success).toBe(false);
    expect(auth.resetPasswordSchema.safeParse({ token: 't', password: STRONG }).success).toBe(true);
    expect(inviteMemberSchema.safeParse({ email: 'a@b.co', password: WEAK }).success).toBe(false);
    expect(inviteMemberSchema.safeParse({ email: 'a@b.co', password: STRONG }).success).toBe(true);
    expect(changePasswordSchema.safeParse({ current_password: 'whatever', new_password: WEAK }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ current_password: 'whatever', new_password: STRONG }).success).toBe(true);
  });

  it('names the offending field, which is what a scripted client reads', async () => {
    const { signupSchema } = await import('@/lib/api/schemas/auth');
    const parsed = signupSchema.safeParse({ email: 'a@b.co', password: WEAK, full_name: 'A', workspace_name: 'W' });
    expect(parsed.success).toBe(false);
    const issue = (parsed as { success: false }).error.issues[0]!;
    expect(issue.path).toEqual(['password']);
    expect(issue.message).toContain('at least 12 characters');
  });

  it('leaves existing-password fields lenient, because #1286 says raising them locks accounts out', async () => {
    const { loginSchema, setup2faSchema, disable2faSchema, changePasswordSchema } = await import('@/lib/api/schemas/auth');

    expect(loginSchema.safeParse({ email: 'a@b.co', password: 'mypassword' }).success).toBe(true);
    expect(setup2faSchema.safeParse({ password: 'mypassword' }).success).toBe(true);
    expect(disable2faSchema.safeParse({ password: 'mypassword' }).success).toBe(true);
    // current_password is re-verified against the hash, never re-checked against policy.
    expect(changePasswordSchema.safeParse({ current_password: 'short', new_password: STRONG }).success).toBe(true);
  });
});
