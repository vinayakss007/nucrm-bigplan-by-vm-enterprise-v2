import { describe, it, expect } from 'vitest';
import {
  calculateGST,
  calculateTDS,
  formatGSTInvoiceNumber,
  validateGSTIN,
  getStateFromGSTIN,
  calculateExportGST,
  STATE_CODES,
} from '@/lib/tax/gst';
import { getGSTRate, getCessRate, isSACCode } from '@/lib/tax/gst-rates';

describe('GST Tax Engine', () => {
  describe('calculateGST - Intra-state (CGST + SGST)', () => {
    it('splits 18% into 9% CGST and 9% SGST for same state', () => {
      const result = calculateGST(10000, '27', '27'); // Maharashtra to Maharashtra
      expect(result.cgst).toBe(900);
      expect(result.sgst).toBe(900);
      expect(result.igst).toBe(0);
      expect(result.total).toBe(1800);
      expect(result.taxRate).toBe(18);
    });

    it('handles intra-state with HSN code at 5% rate', () => {
      const result = calculateGST(10000, '29', '29', '0901'); // Karnataka, Coffee
      expect(result.cgst).toBe(250);
      expect(result.sgst).toBe(250);
      expect(result.igst).toBe(0);
      expect(result.total).toBe(500);
      expect(result.taxRate).toBe(5);
    });

    it('handles intra-state with SAC code at 18%', () => {
      const result = calculateGST(50000, '07', '07', '998314'); // Delhi, IT consulting
      expect(result.cgst).toBe(4500);
      expect(result.sgst).toBe(4500);
      expect(result.igst).toBe(0);
      expect(result.total).toBe(9000);
      expect(result.taxRate).toBe(18);
    });

    it('handles intra-state with 28% product', () => {
      const result = calculateGST(100000, '27', '27', '8703'); // Motor cars
      expect(result.cgst).toBe(14000);
      expect(result.sgst).toBe(14000);
      expect(result.igst).toBe(0);
      expect(result.total).toBe(28000);
      expect(result.taxRate).toBe(28);
    });
  });

  describe('calculateGST - Inter-state (IGST)', () => {
    it('applies full 18% IGST when states differ', () => {
      const result = calculateGST(10000, '27', '29'); // Maharashtra to Karnataka
      expect(result.cgst).toBe(0);
      expect(result.sgst).toBe(0);
      expect(result.igst).toBe(1800);
      expect(result.total).toBe(1800);
      expect(result.taxRate).toBe(18);
    });

    it('applies IGST with 12% rate for specific HSN', () => {
      const result = calculateGST(20000, '07', '33', '1905'); // Delhi to Tamil Nadu, Bakery
      expect(result.cgst).toBe(0);
      expect(result.sgst).toBe(0);
      expect(result.igst).toBe(2400);
      expect(result.total).toBe(2400);
      expect(result.taxRate).toBe(12);
    });

    it('applies IGST with cess for luxury items', () => {
      const result = calculateGST(10000, '27', '29', '2402'); // Cigarettes (28% + 12% cess)
      expect(result.igst).toBe(2800);
      expect(result.cess).toBe(1200);
      expect(result.total).toBe(4000);
      expect(result.taxRate).toBe(28);
    });
  });

  describe('calculateGST - Edge cases', () => {
    it('returns zero for 0 amount', () => {
      const result = calculateGST(0, '27', '29');
      expect(result.cgst).toBe(0);
      expect(result.sgst).toBe(0);
      expect(result.igst).toBe(0);
      expect(result.cess).toBe(0);
      expect(result.total).toBe(0);
      expect(result.taxRate).toBe(0);
    });

    it('returns zero for negative amount', () => {
      const result = calculateGST(-5000, '27', '29');
      expect(result.total).toBe(0);
      expect(result.taxRate).toBe(0);
    });

    it('handles decimal amounts correctly', () => {
      const result = calculateGST(999.99, '27', '27');
      expect(result.cgst).toBe(90);
      expect(result.sgst).toBe(90);
      expect(result.total).toBe(180);
    });

    it('applies default 18% when no HSN code provided', () => {
      const result = calculateGST(10000, '27', '29');
      expect(result.taxRate).toBe(18);
      expect(result.igst).toBe(1800);
    });
  });

  describe('calculateGST - Reverse charge', () => {
    it('calculates tax with reverse charge flag (same computation)', () => {
      const result = calculateGST(10000, '27', '29', '998314', true);
      expect(result.igst).toBe(1800);
      expect(result.total).toBe(1800);
      expect(result.taxRate).toBe(18);
    });

    it('calculates intra-state with reverse charge', () => {
      const result = calculateGST(10000, '27', '27', undefined, true);
      expect(result.cgst).toBe(900);
      expect(result.sgst).toBe(900);
      expect(result.total).toBe(1800);
    });
  });

  describe('calculateExportGST - Zero-rated exports', () => {
    it('returns zero tax for exports', () => {
      const result = calculateExportGST(100000);
      expect(result.cgst).toBe(0);
      expect(result.sgst).toBe(0);
      expect(result.igst).toBe(0);
      expect(result.cess).toBe(0);
      expect(result.total).toBe(0);
      expect(result.taxRate).toBe(0);
    });
  });

  describe('validateGSTIN', () => {
    it('validates a correct GSTIN', () => {
      // 27AAPFU0939F1ZV - valid format for Maharashtra
      expect(validateGSTIN('27AAPFU0939F1ZV')).toBe(true);
    });

    it('rejects GSTIN with invalid length', () => {
      expect(validateGSTIN('27AAPFU0939F1Z')).toBe(false); // 14 chars
      expect(validateGSTIN('27AAPFU0939F1ZVX')).toBe(false); // 16 chars
    });

    it('rejects empty string', () => {
      expect(validateGSTIN('')).toBe(false);
    });

    it('rejects GSTIN with invalid state code', () => {
      expect(validateGSTIN('99AAPFU0939F1ZV')).toBe(false); // 99 is not valid
    });

    it('rejects GSTIN with invalid format', () => {
      expect(validateGSTIN('27AAAA00000A1Z0')).toBe(false); // wrong PAN format
      expect(validateGSTIN('2711111111111Z1')).toBe(false); // all digits in PAN area
    });

    it('rejects GSTIN with wrong checksum', () => {
      // Change last char to make checksum invalid
      expect(validateGSTIN('27AAPFU0939F1ZA')).toBe(false);
    });
  });

  describe('getStateFromGSTIN', () => {
    it('extracts state code from valid GSTIN', () => {
      expect(getStateFromGSTIN('27AAPFU0939F1ZV')).toBe('27'); // Maharashtra
    });

    it('extracts state code 07 (Delhi)', () => {
      expect(getStateFromGSTIN('07AAPFU0939F1ZV')).toBe('07');
    });

    it('returns null for invalid state code', () => {
      expect(getStateFromGSTIN('99INVALID')).toBe(null);
    });

    it('returns null for empty string', () => {
      expect(getStateFromGSTIN('')).toBe(null);
    });

    it('returns null for null/undefined-like input', () => {
      expect(getStateFromGSTIN('')).toBe(null);
    });
  });

  describe('getGSTRate - HSN/SAC rate lookup', () => {
    it('returns 18% for SAC 998314 (IT consulting)', () => {
      const result = getGSTRate('998314');
      expect(result.rate).toBe(18);
      expect(result.description).toBe('IT consulting and support services');
    });

    it('returns 18% for SAC 998313 (Management consulting)', () => {
      const result = getGSTRate('998313');
      expect(result.rate).toBe(18);
      expect(result.description).toBe('Management consulting services');
    });

    it('returns 5% for HSN 0901 (Coffee)', () => {
      const result = getGSTRate('0901');
      expect(result.rate).toBe(5);
    });

    it('returns 28% for HSN 8703 (Motor cars)', () => {
      const result = getGSTRate('8703');
      expect(result.rate).toBe(28);
    });

    it('returns 18% default for unknown code', () => {
      const result = getGSTRate('0000');
      expect(result.rate).toBe(18);
      expect(result.description).toBe('Default GST rate');
    });

    it('handles prefix matching for sub-codes', () => {
      // 99831400 should match parent 998314
      const result = getGSTRate('99831400');
      expect(result.rate).toBe(18);
    });

    it('returns cess rate for applicable items', () => {
      expect(getCessRate('2402')).toBe(12); // Cigarettes
      expect(getCessRate('998314')).toBe(0); // IT consulting - no cess
    });

    it('identifies SAC codes correctly', () => {
      expect(isSACCode('998314')).toBe(true);
      expect(isSACCode('8703')).toBe(false);
    });
  });

  describe('calculateTDS', () => {
    it('calculates 2% TDS by default', () => {
      const result = calculateTDS(250000);
      expect(result.tdsAmount).toBe(5000);
      expect(result.tdsRate).toBe(2);
      expect(result.netPayable).toBe(245000);
    });

    it('calculates custom TDS rate', () => {
      const result = calculateTDS(100000, 10);
      expect(result.tdsAmount).toBe(10000);
      expect(result.tdsRate).toBe(10);
      expect(result.netPayable).toBe(90000);
    });

    it('returns zero for zero amount', () => {
      const result = calculateTDS(0);
      expect(result.tdsAmount).toBe(0);
      expect(result.netPayable).toBe(0);
    });

    it('returns zero for negative amount', () => {
      const result = calculateTDS(-5000);
      expect(result.tdsAmount).toBe(0);
      expect(result.netPayable).toBe(0);
    });
  });

  describe('formatGSTInvoiceNumber', () => {
    it('formats invoice number with tenant code and sequence', () => {
      const result = formatGSTInvoiceNumber('ABC', 1, 2024);
      expect(result).toBe('ABC/2024/000001');
    });

    it('pads sequence to 6 digits', () => {
      const result = formatGSTInvoiceNumber('XY', 42, 2024);
      expect(result).toBe('XY/2024/000042');
    });

    it('truncates tenant code to 4 characters', () => {
      const result = formatGSTInvoiceNumber('ABCDEFGH', 1, 2024);
      expect(result).toBe('ABCD/2024/000001');
    });

    it('uppercases tenant code', () => {
      const result = formatGSTInvoiceNumber('abc', 99, 2024);
      expect(result).toBe('ABC/2024/000099');
    });

    it('handles large sequence numbers', () => {
      const result = formatGSTInvoiceNumber('NU', 999999, 2024);
      expect(result).toBe('NU/2024/999999');
    });

    it('uses current financial year when not specified', () => {
      const result = formatGSTInvoiceNumber('NU', 1);
      // Should contain a valid year
      expect(result).toMatch(/^NU\/\d{4}\/000001$/);
    });
  });

  describe('STATE_CODES', () => {
    it('contains Maharashtra as 27', () => {
      expect(STATE_CODES['27']).toBe('Maharashtra');
    });

    it('contains Delhi as 07', () => {
      expect(STATE_CODES['07']).toBe('Delhi');
    });

    it('contains Karnataka as 29', () => {
      expect(STATE_CODES['29']).toBe('Karnataka');
    });
  });
});
