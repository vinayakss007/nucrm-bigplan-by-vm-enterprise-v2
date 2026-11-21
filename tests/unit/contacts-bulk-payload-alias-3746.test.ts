/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3746 — the bulk handler must read the action arguments from `updates`, the
 * key its own schema and the real client both send. It used to read only
 * `payload`, so tag/assign/status always got an empty bag.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const route = readFileSync(join(root, 'app/api/tenant/contacts/bulk/route.ts'), 'utf8');
const client = readFileSync(join(root, 'components/tenant/contacts-client.tsx'), 'utf8');
const schema = readFileSync(join(root, 'lib/api/schemas/import-export.ts'), 'utf8');

describe('#3746 contacts bulk payload alias', () => {
  it('the handler falls back from payload to updates', () => {
    expect(route).toContain('const payload = rawBody.payload ?? rawBody.updates ?? {};');
  });

  it('the schema validates the key the client sends', () => {
    expect(schema).toMatch(/bulkUpdateSchema = z\.object\(\{[\s\S]{0,200}updates:/);
    expect(client).toContain('updates: payload ?? {}');
  });
});
