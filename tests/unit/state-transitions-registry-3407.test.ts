/**
 * #3407 — the registry must read the entity's own transition map instead of a
 * second copy. Unknown tables and targets fail closed so a typo cannot turn
 * into "any status may move anywhere".
 */
import { describe, it, expect } from 'vitest';
import { allowedFromStatus, canTransition } from '../../lib/state/transitions';

describe('transition registry', () => {
  it('uses the offer map already enforced by the quote routes', () => {
    expect(canTransition('quotes', 'draft', 'sent')).toBe(true);
    expect(canTransition('quotes', 'accepted', 'sent')).toBe(false);
    expect(allowedFromStatus('quotes', 'sent')).toContain('draft');
  });

  it('uses the ticket map already enforced by the ticket routes', () => {
    expect(canTransition('supportTickets', 'closed', 'open')).toBe(true);
    expect(canTransition('supportTickets', 'resolved', 'cancelled')).toBe(false);
  });

  it('fails closed on an unknown target or table', () => {
    expect(allowedFromStatus('quotes', 'not-a-status')).toEqual([]);
    expect(allowedFromStatus('nope' as never, 'sent')).toEqual([]);
  });
});
