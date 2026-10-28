/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3292 asks 1 and 2 — the server has to consult the provider's declared
 * `configFields` before it stores what a tenant typed into them.
 *
 * `lib/integrations/providers/mailgun.ts` declares `base_url` as
 * `type: 'select'` with exactly two legal values, and the install form renders
 * that as a two-option dropdown. That is a UI affordance, not a control:
 * `createIntegrationSchema` (`lib/api/schemas/admin.ts:43`) types the whole bag as
 * `z.record(z.string(), z.unknown())`, so the API accepted
 * `{"base_url":"http://169.254.169.254/latest/meta-data/iam/security-credentials"}`
 * and `handleMailgun` then fetched it and returned the body.
 *
 * The policy is deliberately generic — every declared `select` is enforced, and
 * every value that parses as an absolute http(s) URL is run through the same
 * save-time SSRF check the webhook target already uses (`app/api/tenant/webhooks/
 * route.ts:94`, `checkSaveTimeUrlSafety` from #2276). A per-provider special case
 * would leave the next `type: 'select'` field (`openai.model`,
 * `custom.auth_type`) exactly as unenforced as this one was.
 */
import { describe, it, expect } from 'vitest';
import { mailgunProvider } from '@/lib/integrations/providers/mailgun';
import { customApiProvider } from '@/lib/integrations/providers/custom';
import { validateIntegrationConfig } from '@/lib/integrations/config-policy';

const MAILGUN_BASE = 'https://api.mailgun.net/v3';
const MAILGUN_EU = 'https://api.eu.mailgun.net/v3';

function keys(violations: { key: string }[]) {
  return violations.map((v) => v.key).sort();
}

describe('a declared select is enforced with the values it declares', () => {
  it('accepts the two regions the UI offers', () => {
    expect(validateIntegrationConfig(mailgunProvider, { base_url: MAILGUN_BASE })).toEqual([]);
    expect(validateIntegrationConfig(mailgunProvider, { base_url: MAILGUN_EU })).toEqual([]);
  });

  it('rejects the metadata address from the issue report', () => {
    const violations = validateIntegrationConfig(mailgunProvider, {
      base_url: 'http://169.254.169.254/latest/meta-data/iam/security-credentials',
    });
    expect(keys(violations)).toEqual(['base_url']);
    expect(violations[0].reason).toContain(MAILGUN_BASE);
  });

  it('rejects a loopback listener', () => {
    expect(keys(validateIntegrationConfig(mailgunProvider, { base_url: 'http://127.0.0.1:3001' })))
      .toEqual(['base_url']);
  });

  it('rejects a host that merely ends with an allowed one', () => {
    // #3325: an allowlist that compares suffixes or substrings accepts this.
    expect(validateIntegrationConfig(mailgunProvider, { base_url: `${MAILGUN_BASE}.evil.test` }))
      .not.toEqual([]);
  });

  it('rejects a near-miss on scheme, port, or case rather than normalising it', () => {
    for (const near of [
      'http://api.mailgun.net/v3',
      'https://api.mailgun.net:444/v3',
      'https://API.Mailgun.NET/v3',
      'https://api.mailgun.net/v3/',
    ]) {
      expect(keys(validateIntegrationConfig(mailgunProvider, { base_url: near })), near)
        .toEqual(['base_url']);
    }
  });

  it('rejects a non-string value for a select field', () => {
    expect(keys(validateIntegrationConfig(mailgunProvider, { base_url: { toString: 1 } })))
      .toEqual(['base_url']);
  });

  it('leaves an absent optional field alone', () => {
    // `base_url` is optional; the handler's own default is the US region.
    expect(validateIntegrationConfig(mailgunProvider, { api_key: 'k', domain: 'mg.example.com' })).toEqual([]);
  });

  it('enforces every other declared select, not just this one', () => {
    expect(keys(validateIntegrationConfig(customApiProvider, { auth_type: 'none' }))).toEqual(['auth_type']);
    expect(validateIntegrationConfig(customApiProvider, { auth_type: 'basic' })).toEqual([]);
  });
});

describe('a stored config value is never an unsafe absolute URL', () => {
  it('runs any http(s) value through the save-time SSRF screen', () => {
    const violations = validateIntegrationConfig(mailgunProvider, {
      // Not a declared select: a free-text setting that still names a target.
      webhook_override: 'http://localhost:9090/api/v1/query',
    });
    expect(keys(violations)).toEqual(['webhook_override']);
  });

  it('accepts a public https target', () => {
    expect(validateIntegrationConfig(undefined, { url: 'https://customer.example/recv' })).toEqual([]);
  });

  it('applies the URL rule even when no provider definition exists', () => {
    // `webhook`/`google`/`outlook` rows are written through the same two routes
    // (`lib/integrations/config-credentials.ts` documents that) and have no
    // `ProviderDefinition`, so the select rule has nothing to say about them —
    // the URL rule still must.
    expect(keys(validateIntegrationConfig(undefined, { url: 'http://169.254.169.254/latest/meta-data/' })))
      .toEqual(['url']);
  });

  it('ignores values that are not URLs', () => {
    expect(validateIntegrationConfig(mailgunProvider, {
      api_key: 'key-not-a-url',
      from_email: 'noreply@example.com',
      retries: 3,
      verify_tls: false,
    })).toEqual([]);
  });

  it('survives a non-object bag without throwing', () => {
    for (const junk of [null, undefined, 'string', 42, []]) {
      expect(() => validateIntegrationConfig(mailgunProvider, junk)).not.toThrow();
    }
  });
});
