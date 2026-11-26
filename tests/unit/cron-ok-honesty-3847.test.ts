/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const crons = [
  {
    name: 'trial-check',
    file: 'app/api/cron/trial-check/route.ts',
    ok: /ok: emailsRejected === 0/,
    rejected: 'emailsRejected++',
  },
  {
    name: 'warmup-emails',
    file: 'app/api/cron/warmup-emails/route.ts',
    ok: /ok: sweep\.failed\.length === 0 && totals\.errors\.length === 0/,
  },
  {
    name: 'lead-warming',
    file: 'app/api/cron/lead-warming/route.ts',
    ok: /ok: sweep\.failed\.length === 0 && warmingTotals\.errors\.length === 0 && replyTotals\.errors === 0/,
  },
  {
    name: 'process-at-risk',
    file: 'app/api/cron/process-at-risk/route.ts',
    ok: /ok: sweep\.failed\.length === 0 && emailsRejected === 0/,
    rejected: 'emailsRejected++',
  },
  {
    name: 'process-sequences',
    file: 'app/api/cron/process-sequences/route.ts',
    ok: /ok: sweep\.failed\.length === 0 && emailsRejected === 0/,
    rejected: 'if (!success) emailsRejected++;',
  },
  {
    name: 'contract-renewal-check',
    file: 'app/api/cron/contract-renewal-check/route.ts',
    ok: /ok: sweep\.failed\.length === 0 && remindersWithoutRecipient === 0 && emailsRejected === 0/,
    rejected: 'emailsRejected++',
  },
  {
    name: 'subscription-renewal-check',
    file: 'app/api/cron/subscription-renewal-check/route.ts',
    ok: /ok: sweep\.failed\.length === 0 && remindersWithoutRecipient === 0 && emailsRejected === 0/,
    rejected: 'emailsRejected++',
  },
  {
    name: 'backup',
    file: 'app/api/cron/backup/route.ts',
    ok: /ok: !offsiteError/,
  },
] as const;

describe.each(crons)('$name cron ok must reflect rejected work (#3847)', ({ file, ok, rejected }) => {
  const source = readFileSync(path.join(process.cwd(), file), 'utf8');

  it('never reports ok:true from the sweep alone', () => {
    expect(source).toMatch(ok);
  });

  if (rejected) {
    it('counts the rejection explicitly', () => {
      expect(source).toContain(rejected);
    });
  }
});
