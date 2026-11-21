/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/** #3760 — the tickets page must read the camelCase shape the route returns. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const page = readFileSync(join(root, 'app/tenant/tickets/page.tsx'), 'utf8');
const route = readFileSync(join(root, 'app/api/tenant/tickets/route.ts'), 'utf8');

describe('#3760 tickets list shape', () => {
  it('the route selects camelCase names and date', () => {
    for (const field of ['firstName: contacts.firstName', 'lastName: contacts.lastName', 'assignedName: users.fullName', 'createdAt: supportTickets.createdAt']) {
      expect(route).toContain(field);
    }
  });

  it('the page reads the same camelCase fields', () => {
    expect(page).toContain('createdAt: string;');
    expect(page).toContain('firstName: string | null;');
    expect(page).toContain('assignedName: string | null;');
    expect(page).toContain('ticket.firstName ? `${ticket.firstName} ${ticket.lastName');
    expect(page).toContain('formatDate(ticket.createdAt)');
    expect(page).not.toMatch(/ticket\.(first_name|assigned_name|created_at)/);
  });
});
