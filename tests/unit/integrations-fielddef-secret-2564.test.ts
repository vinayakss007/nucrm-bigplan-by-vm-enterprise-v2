/**
 * #2564 — one rule decides "is this field a credential?", and every consumer reads
 * it from the same place.
 *
 * Before this PR three independent mechanisms answered that question:
 *   1. `app/tenant/integrations/page.tsx:287` chose the input's `type` with
 *      `field.key.includes('key') || includes('token') || includes('secret')`;
 *   2. `lib/integrations/config-credentials.ts` `SECRET_CONFIG_KEY` stripped keys
 *      out of `GET /api/tenant/plugin-engine` and `GET /api/tenant/integrations`
 *      (added by #2535 / PR #2559);
 *   3. nothing at all — `FieldDef` had no way to say.
 *
 * 1 and 2 disagreed in both directions, and neither disagreement is safe:
 *   - a key the regex strips that the client renders as text (`password`,
 *     `credential`, `access_key`) shows the admin a plain box whose contents they
 *     can never read back, with nothing to explain why;
 *   - a key the client masks that the regex does not strip (`monkey_mode`, or any
 *     setting with `key` in its name) is a plain value displayed as a secret.
 *
 * `FieldDef.secret` is now the single declaration, and the client renders from it.
 * These tests pin the three properties that make that true rather than decorative:
 * the declaration agrees with the mask, the page no longer guesses, and the mask
 * still covers the credential writers that have no `FieldDef` at all — webhook and
 * calendar rows are written straight into `integrations.config`
 * (`app/api/tenant/webhooks/route.ts:108`, `lib/calendar-sync/service.ts:49-50`)
 * and `providers/` knows nothing about them, so `SECRET_CONFIG_KEY` is the floor
 * under the metadata, not a redundant copy of it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SECRET_CONFIG_KEY } from '@/lib/integrations/config-credentials';
import { getAllProviders } from '@/lib/integrations/registry';
import { customApiProvider } from '@/lib/integrations/providers/custom';
import type { FieldDef, ProviderDefinition } from '@/lib/integrations/types';

/** Every provider definition the integrations UI can render a field for. */
function allProviders(): ProviderDefinition[] {
  return [...getAllProviders(), customApiProvider];
}

/** configFields plus every capability input — both are `FieldDef`s of the same type. */
function allFields(providers: ProviderDefinition[]): { provider: string; field: FieldDef }[] {
  return providers.flatMap((provider) => [
    ...provider.configFields.map((field) => ({ provider: provider.id, field })),
    ...provider.capabilities.flatMap((cap) =>
      cap.inputFields.map((field) => ({ provider: provider.id, field })),
    ),
  ]);
}

describe('#2564 — FieldDef.secret is the one credential declaration', () => {
  const providers = allProviders();
  const fields = allFields(providers);

  it('walks a non-empty metadata set, so the assertions below cannot pass vacuously', () => {
    // The registry is the whole point of the guard: if `providers/` were ever
    // re-wired and this walk returned [], every other test here would go green on
    // an empty list.
    expect(providers.map((p) => p.id).sort()).toEqual(
      ['__custom__', 'mailgun', 'openai', 'sendgrid', 'slack'],
    );
    expect(fields.length).toBeGreaterThan(15);
  });

  it('marks a field secret exactly when the server-side mask strips it', () => {
    const disagreements = fields
      .filter(({ field }) => Boolean(field.secret) !== SECRET_CONFIG_KEY.test(field.key))
      .map(({ provider, field }) => `${provider}.${field.key} secret=${String(field.secret)}`);

    // One line per offender: the message is the fix instruction, because the next
    // failure is a brand-new provider field someone forgot to think about.
    expect(disagreements).toEqual([]);
  });

  it('carries the five credential fields this issue was filed about', () => {
    const secretKeys = fields
      .filter(({ field }) => field.secret === true)
      .map(({ provider, field }) => `${provider}.${field.key}`)
      .sort();

    expect(secretKeys).toEqual([
      '__custom__.api_key',
      'mailgun.api_key',
      'openai.api_key',
      'sendgrid.api_key',
      'slack.bot_token',
    ]);
  });

  it('never renders an input type from the key name again', () => {
    const src = readFileSync(join(process.cwd(), 'app/tenant/integrations/page.tsx'), 'utf8');

    // The guard is textual because the deleted expression was correct *often* — a
    // runtime test would not notice it coming back. What must not return is a second
    // answer to the question `FieldDef.secret` now answers.
    expect(src).not.toMatch(/field\.key\.includes\(/);
    expect(src).toMatch(/type=\{field\.secret \? 'password' : 'text'\}/);
  });

  it('keeps the custom provider out of the inline-literal business it was smuggled from', () => {
    const src = readFileSync(join(process.cwd(), 'app/tenant/integrations/page.tsx'), 'utf8');
    // `__custom__` must be a real definition: a literal in the page is invisible to
    // the two assertions above and to any future registry-wide check.
    expect(src).toMatch(/customApiProvider/);
    expect(src).not.toMatch(/id: '__custom__'/);
  });

  it('still masks the credentials that no FieldDef describes', () => {
    // The half of `integrations.config` the metadata cannot reach, verbatim from its
    // writers. If one of these ever stops matching the pattern, the row is readable
    // from GET /api/tenant/plugin-engine even though every provider is marked.
    const unmodelled = ['secret', 'SigningSecret', 'accessToken', 'refreshToken', 'access_token', 'bot_token'];
    for (const key of unmodelled) {
      expect(SECRET_CONFIG_KEY.test(key), `SECRET_CONFIG_KEY no longer strips ${key}`).toBe(true);
    }

    // …and the settings next to them must stay visible, or the mask has eaten the
    // only fields the page shows (`url`, `events`, `chat_id`).
    for (const key of ['url', 'events', 'chat_id', 'calendarId', 'from_email', 'base_url']) {
      expect(SECRET_CONFIG_KEY.test(key), `SECRET_CONFIG_KEY wrongly strips ${key}`).toBe(false);
    }
  });
});
