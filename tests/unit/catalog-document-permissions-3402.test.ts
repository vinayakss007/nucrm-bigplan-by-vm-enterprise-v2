/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * #3402 — the six catalog/document ids and the gates that enforce them.
 *
 * `products`, `services` and `documents` were the last tenant CRUD surfaces with
 * no permission id at all: their handlers authenticated the caller but never
 * asked what role they held. The vocabulary guard proves every declared id is
 * enforced somewhere; this spec pins WHICH route asks for WHICH id and the
 * default-role grants that make those checks meaningful for non-admins.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS } from '@/lib/permissions/definitions';

const ROOT = join(import.meta.dirname!, '..', '..');
const source = (p: string) => readFileSync(join(ROOT, 'app/api/tenant', p), 'utf8');

/** The gate inside each exported handler, read from the handler's own block. */
function gateOf(file: string, handler: string): string | null {
  const text = source(file);
  const start = text.indexOf(`export const ${handler} = `);
  if (start < 0) return null;
  const rest = text.slice(start);
  const next = rest.indexOf('\nexport const ', 1);
  const block = next < 0 ? rest : rest.slice(0, next);
  return block.match(/requirePerm\(ctx, '([^']+)'\)/)?.[1] ?? null;
}

const ROUTES: [string, Record<string, string>][] = [
  ['products/route.ts', { GET: 'products.view', POST: 'products.manage' }],
  ['products/[id]/route.ts', { GET: 'products.view', PATCH: 'products.manage', DELETE: 'products.manage' }],
  ['services/route.ts', { GET: 'services.view', POST: 'services.manage' }],
  ['services/[id]/route.ts', { GET: 'services.view', PATCH: 'services.manage', DELETE: 'services.manage' }],
  ['documents/route.ts', { GET: 'documents.view', POST: 'documents.manage', DELETE: 'documents.manage' }],
  ['documents/[id]/route.ts', { GET: 'documents.view', DELETE: 'documents.manage' }],
  ['documents/[id]/verify/route.ts', { POST: 'documents.manage' }],
  ['documents/upload-url/route.ts', { POST: 'documents.manage' }],
];

describe('catalog/document route gates (#3402)', () => {
  it.each(ROUTES)('%s asks for the expected id in every handler', (file, handlers) => {
    for (const [handler, perm] of Object.entries(handlers)) {
      expect(gateOf(file, handler), `${file} ${handler}`).toBe(perm);
    }
  });

  it('declares all six ids in the Roles-UI catalog', () => {
    const ids = PERMISSIONS.map((p) => p.id);
    for (const id of [
      'products.view', 'products.manage', 'services.view', 'services.manage',
      'documents.view', 'documents.manage',
    ]) {
      expect(ids).toContain(id);
    }
  });

  it('grants reads broadly but tenant-wide writes only to admin/manager', () => {
    const rep = DEFAULT_ROLE_PERMISSIONS['sales_rep'];
    const viewer = DEFAULT_ROLE_PERMISSIONS['viewer'];
    for (const id of ['products.view', 'services.view', 'documents.view']) {
      expect(rep[id], `sales_rep ${id}`).toBe(true);
      expect(viewer[id], `viewer ${id}`).toBe(true);
    }
    for (const id of ['products.manage', 'services.manage', 'documents.manage']) {
      expect(rep[id], `sales_rep ${id}`).toBeUndefined();
      expect(DEFAULT_ROLE_PERMISSIONS['admin'][id], `admin ${id}`).toBe(true);
      expect(DEFAULT_ROLE_PERMISSIONS['manager'][id], `manager ${id}`).toBe(true);
    }
  });
});
