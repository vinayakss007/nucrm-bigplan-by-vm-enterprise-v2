/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3590 — the create API's status vocabularies must equal the DB CHECKs. A
 * value that passes Zod but is refused by the table dies at INSERT with 23514;
 * a DB-legal value the API cannot set is unreachable through the create route.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  QUOTE_STATUSES,
  CONTRACT_STATUSES,
  createQuoteSchema,
  createContractSchema,
} from '../../lib/api/schemas/billing';

const MIGRATION = readFileSync(
  new URL('../../drizzle/migrations/0050_data_validation_checks.sql', import.meta.url).pathname,
  'utf8',
);

function checkValues(table: string, constraint: string): string[] {
  const re = new RegExp(
    `ALTER TABLE ${table} ADD CONSTRAINT ${constraint}\\s+CHECK \\(status IN \\(([^)]*)\\)\\)`,
  );
  const match = MIGRATION.match(re);
  if (!match) throw new Error(`could not parse ${constraint} from migration 0050`);
  return [...match[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!).sort();
}

const UUID = '11111111-1111-4111-8111-111111111111';
/** A complete valid payload, so only `status` decides the parse result. */
const quotePayload = (status: string) => ({
  contact_id: UUID,
  company_id: UUID,
  title: 'Q',
  status,
  line_items: [{ description: 'Item', quantity: 1, unit_price: 10 }],
});

describe('#3590 quote status vocabulary', () => {
  it('equals the DB CHECK exactly', () => {
    expect([...QUOTE_STATUSES].sort()).toEqual(checkValues('quotes', 'chk_quotes_status'));
  });

  it('rejects the never-used values the DB refuses', () => {
    for (const status of ['rejected', 'negotiating', 'won', 'lost']) {
      expect(createQuoteSchema.safeParse(quotePayload(status)).success, status).toBe(false);
    }
  });

  it('accepts the canonical OfferStatus values the DB allows', () => {
    for (const status of ['viewed', 'declined', 'cancelled']) {
      expect(createQuoteSchema.safeParse(quotePayload(status)).success, status).toBe(true);
    }
  });
});

describe('#3590 contract status vocabulary', () => {
  it('equals the DB CHECK exactly', () => {
    expect([...CONTRACT_STATUSES].sort()).toEqual(checkValues('contracts', 'chk_contracts_status'));
  });

  it('rejects signed, which no producer writes and the DB refuses', () => {
    expect(createContractSchema.safeParse({
      title: 'C', contact_id: UUID, company_id: UUID, status: 'signed',
    }).success).toBe(false);
  });

  it('accepts real DB-legal states the old enum omitted', () => {
    for (const status of ['under_review', 'suspended', 'completed', 'pending_signature']) {
      expect(createContractSchema.safeParse({
        title: 'C', contact_id: UUID, company_id: UUID, status,
      }).success, status).toBe(true);
    }
  });
});
