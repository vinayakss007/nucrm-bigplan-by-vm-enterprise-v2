/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3000 — outbound/connector endpoints that spend tenant credentials (Meta,
 * Resend/SMTP, Telegram bot tokens) or mutate the webhook DLQ were open to any
 * authenticated member. Each now carries its gated twin's check. This matrix
 * test fails if a handler loses (or a newly listed handler never gets) its
 * gate, so role-gate regressions can't silently reappear.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface MatrixRow {
  file: string;
  handler: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  gate: RegExp;
  gateName: string;
}

const MATRIX: MatrixRow[] = [
  { file: 'app/api/tenant/whatsapp/send/route.ts', handler: 'POST', gate: /requirePerm\(/, gateName: "requirePerm('contacts.edit')" },
  { file: 'app/api/tenant/whatsapp/templates/route.ts', handler: 'POST', gate: /requirePerm\(/, gateName: "requirePerm('contacts.edit')" },
  { file: 'app/api/tenant/integrations/telegram/test/route.ts', handler: 'POST', gate: /ctx\.isAdmin/, gateName: 'isAdmin' },
  { file: 'app/api/tenant/email/test/route.ts', handler: 'POST', gate: /requirePerm\(/, gateName: "requirePerm('contacts.edit')" },
  { file: 'app/api/tenant/webhooks/dlq/route.ts', handler: 'POST', gate: /ctx\.isAdmin/, gateName: 'isAdmin' },
];

/** Slice of source belonging to a single exported handler. */
function handlerSource(file: string, handler: MatrixRow['handler']): string {
  const src = readFileSync(join(process.cwd(), file), 'utf8');
  const start = src.indexOf(`export const ${handler} =`);
  expect(start, `${handler} export missing from ${file}`).toBeGreaterThanOrEqual(0);
  const next = src.indexOf('\nexport const ', start + 1);
  return next === -1 ? src.slice(start) : src.slice(start, next);
}

describe('outbound/connector role-gate matrix (#3000)', () => {
  for (const row of MATRIX) {
    it(`${row.file} ${row.handler} enforces ${row.gateName} after requireAuth`, () => {
      const body = handlerSource(row.file, row.handler);
      const authIdx = body.indexOf('requireAuth');
      const gateIdx = body.search(row.gate);
      expect(gateIdx, `${row.file} ${row.handler} has no ${row.gateName} gate`).toBeGreaterThanOrEqual(0);
      expect(gateIdx, `gate must run after requireAuth in ${row.file}`).toBeGreaterThan(authIdx);
    });
  }
});
