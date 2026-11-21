/**
 * #3407 — the status-owner guard must pin the surface and fail in exactly one
 * direction: a NEW direct status write to a registered table. Shrinking is
 * progress; a stale pin fails so the ledger cannot rot.
 */
import { describe, it, expect } from 'vitest';
import {
  countDirectStatusWrites,
  maskComments,
  check,
  REGISTERED_TABLES,
} from '../../scripts/check-status-owner.mjs';

describe('status-owner guard (#3407)', () => {
  it('registers only the tables with a transition rule', () => {
    expect(REGISTERED_TABLES).toEqual(['supportTickets', 'quotes', 'productTemplates', 'tenantMembers']);
  });

  it('counts a direct status write and ignores a non-status write', () => {
    expect(countDirectStatusWrites("tx.update(quotes).set({ status: 'sent', updatedAt: new Date() })")).toBe(1);
    expect(countDirectStatusWrites("tx.update(quotes).set({ updatedAt: new Date() })")).toBe(0);
  });

  it('does not let a later write in the same file create a false positive', () => {
    const src = `
      tx.update(quotes).set({ updatedAt: new Date() });
      // many lines later
      tx.update(supportTickets).set({ status: 'closed' });
    `;
    expect(countDirectStatusWrites(src)).toBe(1);
  });

  it('ignores commented-out writes', () => {
    expect(countDirectStatusWrites("// tx.update(quotes).set({ status: 'sent' })")).toBe(0);
    expect(countDirectStatusWrites("/* tx.update(quotes).set({ status: 'sent' }) */")).toBe(0);
  });

  it('masks comments without disturbing code', () => {
    expect(maskComments("const x = 1; // note\nconst y = 2;")).toContain('const y = 2;');
  });

  it('fails a new bypass, allows a shrink, and rejects a stale pin', () => {
    expect(check({ 'a.ts': 1 }, {})[0]).toMatch(/not pinned/);
    expect(check({ 'a.ts': 2 }, { 'a.ts': 1 })[0]).toMatch(/grew/);
    expect(check({ 'a.ts': 1 }, { 'a.ts': 2 })).toEqual([]);
    expect(check({}, { 'a.ts': 1 })[0]).toMatch(/stale/);
  });
});
