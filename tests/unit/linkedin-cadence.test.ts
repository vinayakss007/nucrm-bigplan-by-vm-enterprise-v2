import { describe, it, expect } from 'vitest';
import {
  createLinkedInTask,
  getLinkedInUrl,
  formatLinkedInMessage,
} from '@/lib/cadence/linkedin';
import type { Contact, LinkedInAction } from '@/lib/cadence/linkedin';

describe('LinkedIn Cadence', () => {
  describe('createLinkedInTask', () => {
    it('creates a connect task with all fields', () => {
      const dueAt = new Date('2025-02-01T10:00:00Z');
      const task = createLinkedInTask('contact-1', 'connect', 'Hi, let us connect!', dueAt);

      expect(task.id).toBeDefined();
      expect(task.contactId).toBe('contact-1');
      expect(task.action).toBe('connect');
      expect(task.message).toBe('Hi, let us connect!');
      expect(task.dueAt).toEqual(dueAt);
      expect(task.status).toBe('pending');
      expect(task.createdAt).toBeInstanceOf(Date);
    });

    it('creates a message task with null message', () => {
      const dueAt = new Date('2025-03-01T10:00:00Z');
      const task = createLinkedInTask('contact-2', 'message', null, dueAt);

      expect(task.action).toBe('message');
      expect(task.message).toBeNull();
    });

    it('creates a view_profile task', () => {
      const dueAt = new Date('2025-03-01T10:00:00Z');
      const task = createLinkedInTask('contact-3', 'view_profile', null, dueAt);

      expect(task.action).toBe('view_profile');
      expect(task.linkedinUrl).toBeNull();
    });

    it('creates an endorse task', () => {
      const dueAt = new Date('2025-03-01T10:00:00Z');
      const task = createLinkedInTask('contact-4', 'endorse', 'Endorse for TypeScript', dueAt);

      expect(task.action).toBe('endorse');
      expect(task.message).toBe('Endorse for TypeScript');
    });

    it('throws if contactId is empty', () => {
      expect(() => createLinkedInTask('', 'connect', null, new Date())).toThrow('contactId is required');
    });

    it('throws if action is invalid', () => {
      expect(() => createLinkedInTask('c-1', 'spam' as LinkedInAction, null, new Date())).toThrow(
        'Invalid LinkedIn action'
      );
    });

    it('throws if dueAt is not a valid date', () => {
      expect(() => createLinkedInTask('c-1', 'connect', null, new Date('invalid'))).toThrow(
        'dueAt must be a valid Date'
      );
    });
  });

  describe('getLinkedInUrl', () => {
    it('returns URL from linkedinUrl field', () => {
      const contact: Contact = {
        id: 'c-1',
        firstName: 'John',
        linkedinUrl: 'https://linkedin.com/in/johndoe',
      };
      expect(getLinkedInUrl(contact)).toBe('https://linkedin.com/in/johndoe');
    });

    it('returns URL from linkedin field', () => {
      const contact: Contact = {
        id: 'c-2',
        firstName: 'Jane',
        linkedin: 'https://www.linkedin.com/in/janedoe',
      };
      expect(getLinkedInUrl(contact)).toBe('https://www.linkedin.com/in/janedoe');
    });

    it('normalizes URL by adding https prefix', () => {
      const contact: Contact = {
        id: 'c-3',
        linkedinUrl: 'linkedin.com/in/noprotocol',
      };
      expect(getLinkedInUrl(contact)).toBe('https://linkedin.com/in/noprotocol');
    });

    it('upgrades http to https', () => {
      const contact: Contact = {
        id: 'c-4',
        linkedinUrl: 'http://linkedin.com/in/httpuser',
      };
      expect(getLinkedInUrl(contact)).toBe('https://linkedin.com/in/httpuser');
    });

    it('removes trailing slash', () => {
      const contact: Contact = {
        id: 'c-5',
        linkedinUrl: 'https://linkedin.com/in/trailingslash/',
      };
      expect(getLinkedInUrl(contact)).toBe('https://linkedin.com/in/trailingslash');
    });

    it('returns null if no LinkedIn URL is present', () => {
      const contact: Contact = {
        id: 'c-6',
        firstName: 'NoLinkedIn',
      };
      expect(getLinkedInUrl(contact)).toBeNull();
    });

    it('returns null for invalid LinkedIn URLs', () => {
      const contact: Contact = {
        id: 'c-7',
        linkedinUrl: 'https://twitter.com/user',
      };
      expect(getLinkedInUrl(contact)).toBeNull();
    });

    it('handles /pub/ style LinkedIn URLs', () => {
      const contact: Contact = {
        id: 'c-8',
        linkedinUrl: 'https://linkedin.com/pub/olduser/12/345/abc',
      };
      expect(getLinkedInUrl(contact)).toBe('https://linkedin.com/pub/olduser/12/345/abc');
    });
  });

  describe('formatLinkedInMessage', () => {
    it('interpolates firstName and lastName', () => {
      const contact: Contact = {
        id: 'c-1',
        firstName: 'John',
        lastName: 'Doe',
      };
      const result = formatLinkedInMessage('Hi {{firstName}} {{lastName}}, great to connect!', contact);
      expect(result).toBe('Hi John Doe, great to connect!');
    });

    it('interpolates company and title', () => {
      const contact: Contact = {
        id: 'c-2',
        firstName: 'Alice',
        company: 'Acme Corp',
        title: 'VP Sales',
      };
      const result = formatLinkedInMessage('Hello {{firstName}}, loved what {{company}} is doing.', contact);
      expect(result).toBe('Hello Alice, loved what Acme Corp is doing.');
    });

    it('replaces missing fields with empty string', () => {
      const contact: Contact = {
        id: 'c-3',
        firstName: 'Bob',
      };
      const result = formatLinkedInMessage('Hi {{firstName}} from {{company}}', contact);
      expect(result).toBe('Hi Bob from ');
    });

    it('returns empty string for empty template', () => {
      const contact: Contact = { id: 'c-4', firstName: 'Test' };
      expect(formatLinkedInMessage('', contact)).toBe('');
    });

    it('handles template with no placeholders', () => {
      const contact: Contact = { id: 'c-5', firstName: 'Test' };
      const result = formatLinkedInMessage('Static message with no vars', contact);
      expect(result).toBe('Static message with no vars');
    });
  });
});
