/**
 * Tests for lib/webhooks/event-catalog.ts
 */
import { describe, it, expect } from 'vitest';
import {
  WebhookEvent,
  getEventInfo,
  listEventsByCategory,
  getCategories,
  getAllEvents,
  getDefaultEnabledEvents,
  isValidEvent,
} from '@/lib/webhooks/event-catalog';

describe('WebhookEvent constants', () => {
  it('has contact events', () => {
    expect(WebhookEvent.CONTACT_CREATED).toBe('contact.created');
    expect(WebhookEvent.CONTACT_UPDATED).toBe('contact.updated');
    expect(WebhookEvent.CONTACT_DELETED).toBe('contact.deleted');
  });

  it('has deal events', () => {
    expect(WebhookEvent.DEAL_CREATED).toBe('deal.created');
    expect(WebhookEvent.DEAL_WON).toBe('deal.won');
    expect(WebhookEvent.DEAL_LOST).toBe('deal.lost');
    expect(WebhookEvent.DEAL_STAGE_CHANGED).toBe('deal.stage_changed');
  });

  it('has system events', () => {
    expect(WebhookEvent.WEBHOOK_TEST).toBe('webhook.test');
    expect(WebhookEvent.EXPORT_COMPLETED).toBe('export.completed');
  });

  it('all values follow entity.action format', () => {
    const values = Object.values(WebhookEvent);
    expect(values.every((v) => v.includes('.'))).toBe(true);
  });
});

describe('getEventInfo', () => {
  it('returns metadata for valid event', () => {
    const info = getEventInfo('contact.created');
    expect(info).not.toBeNull();
    expect(info!.event).toBe('contact.created');
    expect(info!.category).toBe('contacts');
    expect(info!.description).toContain('contact');
    expect(info!.payloadKeys).toContain('contact');
  });

  it('returns null for unknown event', () => {
    expect(getEventInfo('unknown.event')).toBeNull();
  });

  it('returns correct category for deals', () => {
    const info = getEventInfo('deal.won');
    expect(info!.category).toBe('deals');
    expect(info!.payloadKeys).toContain('deal');
  });
});

describe('listEventsByCategory', () => {
  it('returns contact events', () => {
    const events = listEventsByCategory('contacts');
    expect(events.length).toBeGreaterThanOrEqual(3);
    expect(events.every((e) => e.category === 'contacts')).toBe(true);
  });

  it('returns deal events', () => {
    const events = listEventsByCategory('deals');
    expect(events.length).toBeGreaterThanOrEqual(5);
    expect(events.some((e) => e.event === 'deal.won')).toBe(true);
  });

  it('returns system events', () => {
    const events = listEventsByCategory('system');
    expect(events.length).toBeGreaterThanOrEqual(3);
  });

  it('returns empty for invalid category', () => {
    const events = listEventsByCategory('nonexistent' as 'contacts');
    expect(events).toEqual([]);
  });
});

describe('getCategories', () => {
  it('returns all categories', () => {
    const cats = getCategories();
    expect(cats).toContain('contacts');
    expect(cats).toContain('deals');
    expect(cats).toContain('leads');
    expect(cats).toContain('tasks');
    expect(cats).toContain('invoices');
    expect(cats).toContain('system');
    expect(cats.length).toBeGreaterThanOrEqual(8);
  });

  it('has no duplicates', () => {
    const cats = getCategories();
    expect(new Set(cats).size).toBe(cats.length);
  });
});

describe('getAllEvents', () => {
  it('returns all registered events', () => {
    const events = getAllEvents();
    expect(events.length).toBeGreaterThanOrEqual(35);
  });

  it('every event has required fields', () => {
    const events = getAllEvents();
    for (const e of events) {
      expect(e.event).toBeTruthy();
      expect(e.description).toBeTruthy();
      expect(e.category).toBeTruthy();
      expect(Array.isArray(e.payloadKeys)).toBe(true);
      expect(typeof e.defaultEnabled).toBe('boolean');
    }
  });

  it('returns a copy (not the original array)', () => {
    const events1 = getAllEvents();
    const events2 = getAllEvents();
    expect(events1).not.toBe(events2);
    expect(events1).toEqual(events2);
  });
});

describe('getDefaultEnabledEvents', () => {
  it('returns events enabled by default', () => {
    const defaults = getDefaultEnabledEvents();
    expect(defaults.length).toBeGreaterThan(5);
    expect(defaults).toContain('contact.created');
    expect(defaults).toContain('deal.won');
    expect(defaults).toContain('invoice.paid');
  });

  it('does not include system events by default', () => {
    const defaults = getDefaultEnabledEvents();
    expect(defaults).not.toContain('webhook.test');
    expect(defaults).not.toContain('automation.triggered');
  });
});

describe('isValidEvent', () => {
  it('returns true for valid events', () => {
    expect(isValidEvent('contact.created')).toBe(true);
    expect(isValidEvent('deal.won')).toBe(true);
    expect(isValidEvent('invoice.paid')).toBe(true);
  });

  it('returns false for invalid events', () => {
    expect(isValidEvent('unknown.event')).toBe(false);
    expect(isValidEvent('')).toBe(false);
    expect(isValidEvent('contact')).toBe(false);
  });
});
