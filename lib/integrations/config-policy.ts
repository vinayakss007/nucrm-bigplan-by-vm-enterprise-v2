/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3292 — a provider's declared `configFields` have to be a control, not a hint.
 *
 * `lib/integrations/providers/mailgun.ts` declares `base_url` as `type: 'select'`
 * with exactly two values, and the install form renders that as a two-option
 * dropdown. Nothing on the server read those options: `createIntegrationSchema`
 * (`lib/api/schemas/admin.ts:43`) types the whole bag as
 * `z.record(z.string(), z.unknown())`, so `POST /api/tenant/integrations` stored
 * `{"base_url":"http://169.254.169.254/latest/meta-data/iam/security-credentials"}`
 * verbatim and `handleMailgun` then fetched it and returned the body.
 *
 * Two rules, both generic over every provider rather than special-casing Mailgun —
 * the next unenforced `type: 'select'` is `custom.auth_type`, and the next free-text
 * value that names a target is one `configFields: []` row away (`webhook`, `google`
 * and `outlook` have no `ProviderDefinition` at all and are written through the same
 * two routes; see `lib/integrations/config-credentials.ts`):
 *
 *   1. a declared `select` holds one of the values it declares, compared as whole
 *      strings. Normalising case, a trailing slash or a port would reintroduce the
 *      `https://api.mailgun.net.evil.test` class #3325 was about.
 *   2. any value that parses as an absolute http(s) URL goes through
 *      `checkSaveTimeUrlSafety` — the same save-time screen `app/api/tenant/
 *      webhooks/route.ts:94` already applies to a tenant webhook target (#2276) —
 *      whether or not the key is declared.
 *
 * A key is reported once, so a caller gets one field-level entry rather than two
 * competing reasons for the same input.
 */
import { NextResponse } from 'next/server';
import { checkSaveTimeUrlSafety } from '@/lib/security/ssrf';
import type { ProviderDefinition } from './types';

export interface ConfigViolation {
  key: string;
  reason: string;
}

const ABSOLUTE_URL_RE = /^https?:\/\//i;

function isConfigBag(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateIntegrationConfig(
  provider: ProviderDefinition | undefined,
  config: unknown,
): ConfigViolation[] {
  if (!isConfigBag(config)) return [];

  const violations: ConfigViolation[] = [];
  const reported = new Set<string>();

  for (const field of provider?.configFields ?? []) {
    if (field.type !== 'select' || !Array.isArray(field.options)) continue;
    if (!(field.key in config)) continue;
    const legal = field.options.map((option) => option.value);
    const value = config[field.key];
    if (typeof value !== 'string' || !legal.includes(value)) {
      violations.push({
        key: field.key,
        reason: `${field.label} must be exactly one of the values this integration declares: ${legal.join(', ')}`,
      });
      reported.add(field.key);
    }
  }

  for (const [key, value] of Object.entries(config)) {
    if (reported.has(key)) continue;
    if (typeof value !== 'string' || !ABSOLUTE_URL_RE.test(value)) continue;
    const reason = checkSaveTimeUrlSafety(value);
    if (reason) {
      violations.push({ key, reason });
      reported.add(key);
    }
  }

  return violations;
}

/**
 * The 400 both writers return, in the same envelope `validateBody` uses
 * (`{ error: 'Validation failed', details: [{ field, message }] }`), or `null`
 * when the bag may be stored. Returning the response here rather than throwing
 * keeps the field names in one place — the routes differ in everything else.
 */
export function integrationConfigResponse(
  provider: ProviderDefinition | undefined,
  config: unknown,
): NextResponse | null {
  const violations = validateIntegrationConfig(provider, config);
  if (violations.length === 0) return null;
  return NextResponse.json(
    {
      error: 'Validation failed',
      details: violations.map((v) => ({ field: `config.${v.key}`, message: v.reason })),
    },
    { status: 400 },
  );
}
