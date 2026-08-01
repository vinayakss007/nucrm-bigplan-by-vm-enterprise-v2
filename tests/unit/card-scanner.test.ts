import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseBusinessCard,
  parseVCard,
  normalizePhone,
  normalizeEmail,
  toContactPayload,
  detectDuplicate,
} from '@/lib/field-sales/card-scanner';

// Mock the database module for detectDuplicate tests
vi.mock('@/drizzle/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => []),
        })),
      })),
    })),
  },
}));

vi.mock('@/drizzle/schema', () => ({
  contacts: {
    id: 'id',
    tenantId: 'tenant_id',
    email: 'email',
    phone: 'phone',
    isArchived: 'is_archived',
    deletedAt: 'deleted_at',
  },
}));

describe('Card Scanner', () => {
  // ── Business Card OCR Parsing ──

  describe('parseBusinessCard', () => {
    it('extracts email from OCR text', () => {
      const text = 'John Doe\njohn.doe@example.com\n+91 98765 43210';
      const result = parseBusinessCard(text);
      expect(result.email).toBe('john.doe@example.com');
    });

    it('extracts phone number from OCR text', () => {
      const text = 'Jane Smith\njane@test.com\n+91 98765 43210';
      const result = parseBusinessCard(text);
      expect(result.phone).toBe('+91 98765 43210');
    });

    it('extracts full name as first line', () => {
      const text = 'Rajesh Kumar\nSenior Engineer\nrajesh@company.com';
      const result = parseBusinessCard(text);
      expect(result.fullName).toBe('Rajesh Kumar');
      expect(result.firstName).toBe('Rajesh');
      expect(result.lastName).toBe('Kumar');
    });

    it('extracts job title using keyword matching', () => {
      const text = 'Amit Patel\nSenior Software Engineer\namitp@tech.co';
      const result = parseBusinessCard(text);
      expect(result.jobTitle).toBe('Senior Software Engineer');
    });

    it('extracts company name with common suffixes', () => {
      const text = 'Priya Sharma\nManager\nInfosys Technologies Ltd\npriya@infosys.com';
      const result = parseBusinessCard(text);
      expect(result.company).toBe('Infosys Technologies Ltd');
    });

    it('extracts website URL', () => {
      const text = 'John Doe\nwww.mycompany.com\njohn@mycompany.com';
      const result = parseBusinessCard(text);
      expect(result.website).toBe('www.mycompany.com');
    });

    it('extracts LinkedIn URL', () => {
      const text = 'Sarah Wilson\nhttps://linkedin.com/in/sarah-wilson\nsarah@co.com';
      const result = parseBusinessCard(text);
      expect(result.linkedinUrl).toBe('https://linkedin.com/in/sarah-wilson');
    });

    it('does not confuse email domain as website', () => {
      const text = 'Test User\nuser@domain.com';
      const result = parseBusinessCard(text);
      // Website should not be the email domain
      expect(result.website).not.toBe('domain.com');
    });

    it('handles multi-word last names', () => {
      const text = 'Maria De La Cruz\nDirector\nmaria@test.com';
      const result = parseBusinessCard(text);
      expect(result.firstName).toBe('Maria');
      expect(result.lastName).toBe('De La Cruz');
    });

    it('always includes rawText', () => {
      const text = 'Some random card text';
      const result = parseBusinessCard(text);
      expect(result.rawText).toBe(text);
    });

    it('handles empty text gracefully', () => {
      const result = parseBusinessCard('');
      expect(result.rawText).toBe('');
      expect(result.email).toBeUndefined();
      expect(result.phone).toBeUndefined();
    });

    it('extracts CEO title', () => {
      const text = 'John Smith\nCEO\nAcme Corp Ltd\njohn@acme.com';
      const result = parseBusinessCard(text);
      expect(result.jobTitle).toBe('CEO');
    });
  });

  // ── vCard Parsing ──

  describe('parseVCard', () => {
    it('parses a standard vCard 3.0', () => {
      const vcard = [
        'BEGIN:VCARD',
        'VERSION:3.0',
        'FN:Arun Mehta',
        'N:Mehta;Arun;;;',
        'ORG:TechStartup Inc',
        'TITLE:CTO',
        'TEL;TYPE=CELL:+919876543210',
        'EMAIL:arun@techstartup.com',
        'URL:https://techstartup.com',
        'END:VCARD',
      ].join('\n');

      const result = parseVCard(vcard);
      expect(result.fullName).toBe('Arun Mehta');
      expect(result.firstName).toBe('Arun');
      expect(result.lastName).toBe('Mehta');
      expect(result.company).toBe('TechStartup Inc');
      expect(result.jobTitle).toBe('CTO');
      expect(result.phone).toBe('+919876543210');
      expect(result.email).toBe('arun@techstartup.com');
      expect(result.website).toBe('https://techstartup.com');
    });

    it('parses a vCard 4.0', () => {
      const vcard = [
        'BEGIN:VCARD',
        'VERSION:4.0',
        'FN:Neha Gupta',
        'N:Gupta;Neha;;;',
        'EMAIL;TYPE=WORK:neha.gupta@corp.in',
        'TEL;VALUE=uri:tel:+91-98765-43210',
        'ORG:Global Solutions Pvt Ltd',
        'END:VCARD',
      ].join('\n');

      const result = parseVCard(vcard);
      expect(result.fullName).toBe('Neha Gupta');
      expect(result.email).toBe('neha.gupta@corp.in');
      expect(result.company).toBe('Global Solutions Pvt Ltd');
    });

    it('extracts LinkedIn URL from vCard', () => {
      const vcard = [
        'BEGIN:VCARD',
        'VERSION:3.0',
        'FN:Test User',
        'URL:https://linkedin.com/in/testuser',
        'END:VCARD',
      ].join('\n');

      const result = parseVCard(vcard);
      expect(result.linkedinUrl).toBe('https://linkedin.com/in/testuser');
    });

    it('parses address from vCard', () => {
      const vcard = [
        'BEGIN:VCARD',
        'VERSION:3.0',
        'FN:Test User',
        'ADR:;;123 Main St;Mumbai;MH;400001;India',
        'END:VCARD',
      ].join('\n');

      const result = parseVCard(vcard);
      expect(result.address).toContain('Mumbai');
      expect(result.address).toContain('India');
    });

    it('returns empty card for invalid vCard', () => {
      const result = parseVCard('This is not a vCard');
      expect(result.fullName).toBeUndefined();
      expect(result.email).toBeUndefined();
      expect(result.rawText).toBe('This is not a vCard');
    });

    it('handles vCard with only FN (no N field)', () => {
      const vcard = [
        'BEGIN:VCARD',
        'VERSION:3.0',
        'FN:Single Name',
        'END:VCARD',
      ].join('\n');

      const result = parseVCard(vcard);
      expect(result.fullName).toBe('Single Name');
      expect(result.firstName).toBe('Single');
      expect(result.lastName).toBe('Name');
    });

    it('handles vCard with Windows-style line endings', () => {
      const vcard = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Test\r\nEMAIL:t@t.com\r\nEND:VCARD';
      const result = parseVCard(vcard);
      expect(result.fullName).toBe('Test');
      expect(result.email).toBe('t@t.com');
    });
  });

  // ── Phone Normalization ──

  describe('normalizePhone', () => {
    it('normalizes 10-digit Indian number', () => {
      expect(normalizePhone('9876543210')).toBe('+919876543210');
    });

    it('removes leading 0 from Indian number', () => {
      expect(normalizePhone('09876543210')).toBe('+919876543210');
    });

    it('handles +91 prefix already present', () => {
      expect(normalizePhone('+919876543210')).toBe('+919876543210');
    });

    it('removes spaces and dashes', () => {
      expect(normalizePhone('98765 43210')).toBe('+919876543210');
      expect(normalizePhone('987-654-3210')).toBe('+919876543210');
    });

    it('handles 91 prefix without plus', () => {
      expect(normalizePhone('919876543210')).toBe('+919876543210');
    });

    it('handles different country code', () => {
      expect(normalizePhone('2025551234', '+1')).toBe('+12025551234');
    });

    it('preserves already normalized international number', () => {
      expect(normalizePhone('+442071234567')).toBe('+442071234567');
    });

    it('handles parentheses and dots', () => {
      expect(normalizePhone('(987) 654.3210')).toBe('+919876543210');
    });
  });

  // ── Email Normalization ──

  describe('normalizeEmail', () => {
    it('lowercases email', () => {
      expect(normalizeEmail('John.Doe@Example.COM')).toBe('john.doe@example.com');
    });

    it('trims whitespace', () => {
      expect(normalizeEmail('  user@test.com  ')).toBe('user@test.com');
    });

    it('handles already normalized email', () => {
      expect(normalizeEmail('already@normal.com')).toBe('already@normal.com');
    });
  });

  // ── Contact Payload Conversion ──

  describe('toContactPayload', () => {
    it('converts full scanned card to contact payload', () => {
      const card = {
        firstName: 'Vikram',
        lastName: 'Singh',
        email: 'Vikram@Company.com',
        phone: '9876543210',
        jobTitle: 'Director of Sales',
        website: 'https://company.com',
        linkedinUrl: 'https://linkedin.com/in/vikram',
        address: '123 MG Road, Bangalore',
        rawText: 'raw',
      };

      const payload = toContactPayload(card, 'tenant-1', 'user-1');
      expect(payload.tenantId).toBe('tenant-1');
      expect(payload.createdBy).toBe('user-1');
      expect(payload.assignedTo).toBe('user-1');
      expect(payload.firstName).toBe('Vikram');
      expect(payload.lastName).toBe('Singh');
      expect(payload.email).toBe('vikram@company.com');
      expect(payload.phone).toBe('+919876543210');
      expect(payload.jobTitle).toBe('Director of Sales');
      expect(payload.website).toBe('https://company.com');
      expect(payload.linkedinUrl).toBe('https://linkedin.com/in/vikram');
      expect(payload.leadSource).toBe('business_card_scan');
      expect(payload.notes).toContain('123 MG Road');
    });

    it('handles minimal card with only rawText', () => {
      const card = { rawText: 'some text' };
      const payload = toContactPayload(card, 'tenant-2', 'user-2');
      expect(payload.firstName).toBe('Unknown');
      expect(payload.lastName).toBe('');
      expect(payload.email).toBeNull();
      expect(payload.phone).toBeNull();
    });

    it('uses fullName when firstName is missing', () => {
      const card = { fullName: 'Test Name', rawText: 'text' };
      const payload = toContactPayload(card, 't', 'u');
      expect(payload.firstName).toBe('Test Name');
    });
  });

  // ── Duplicate Detection ──

  describe('detectDuplicate', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('returns not duplicate when neither email nor phone provided', async () => {
      const result = await detectDuplicate(undefined, undefined, 'tenant-1');
      expect(result.isDuplicate).toBe(false);
      expect(result.duplicateId).toBeUndefined();
    });

    it('queries database when email is provided', async () => {
      const { db } = await import('@/drizzle/db');
      const mockLimit = vi.fn().mockResolvedValue([]);
      const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit });
      const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
      (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from: mockFrom });

      const result = await detectDuplicate('test@example.com', undefined, 'tenant-1');
      expect(result.isDuplicate).toBe(false);
      expect(db.select).toHaveBeenCalled();
    });

    it('returns duplicate when database finds match', async () => {
      const { db } = await import('@/drizzle/db');
      const mockLimit = vi.fn().mockResolvedValue([{ id: 'existing-id' }]);
      const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit });
      const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
      (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from: mockFrom });

      const result = await detectDuplicate('dup@test.com', undefined, 'tenant-1');
      expect(result.isDuplicate).toBe(true);
      expect(result.duplicateId).toBe('existing-id');
    });

    it('queries database when phone is provided', async () => {
      const { db } = await import('@/drizzle/db');
      const mockLimit = vi.fn().mockResolvedValue([]);
      const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit });
      const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
      (db.select as ReturnType<typeof vi.fn>).mockReturnValue({ from: mockFrom });

      const result = await detectDuplicate(undefined, '+919876543210', 'tenant-1');
      expect(result.isDuplicate).toBe(false);
      expect(db.select).toHaveBeenCalled();
    });
  });

  // ── Edge Cases ──

  describe('edge cases', () => {
    it('parseBusinessCard handles text with only email', () => {
      const result = parseBusinessCard('random@test.org');
      expect(result.email).toBe('random@test.org');
      expect(result.fullName).toBeUndefined();
    });

    it('parseBusinessCard handles text with only phone', () => {
      const result = parseBusinessCard('+91 9876543210');
      expect(result.phone).toBe('+91 9876543210');
      expect(result.email).toBeUndefined();
    });

    it('parseVCard handles empty vCard', () => {
      const vcard = 'BEGIN:VCARD\nVERSION:3.0\nEND:VCARD';
      const result = parseVCard(vcard);
      expect(result.fullName).toBeUndefined();
      expect(result.rawText).toBe(vcard);
    });

    it('normalizePhone handles short numbers gracefully', () => {
      const result = normalizePhone('123');
      // Too short for normalization, returns cleaned digits
      expect(result).toBe('123');
    });

    it('parseBusinessCard handles special characters in name', () => {
      const text = "Jean-Pierre O'Brien\njp@test.com";
      const result = parseBusinessCard(text);
      expect(result.fullName).toBe("Jean-Pierre O'Brien");
      expect(result.firstName).toBe("Jean-Pierre");
      expect(result.lastName).toBe("O'Brien");
    });
  });
});
