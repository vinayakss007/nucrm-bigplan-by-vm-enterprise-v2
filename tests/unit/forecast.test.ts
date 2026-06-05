import { describe, it, expect } from 'vitest';
import { getStageProbability, calculateWeightedValue } from '@/lib/forecast';

describe('Revenue Forecasting', () => {
  describe('getStageProbability', () => {
    it('returns 10% for lead/new stages', () => {
      expect(getStageProbability('new')).toBe(0.1);
      expect(getStageProbability('New Lead')).toBe(0.1);
      expect(getStageProbability('lead')).toBe(0.1);
    });

    it('returns 25% for qualified stages', () => {
      expect(getStageProbability('qualified')).toBe(0.25);
      expect(getStageProbability('Sales Qualified')).toBe(0.25);
    });

    it('returns 50% for proposal stages', () => {
      expect(getStageProbability('proposal')).toBe(0.5);
      expect(getStageProbability('Proposal Sent')).toBe(0.5);
    });

    it('returns 75% for negotiation stages', () => {
      expect(getStageProbability('negotiation')).toBe(0.75);
      expect(getStageProbability('In Negotiation')).toBe(0.75);
    });

    it('returns 100% for closed/won stages', () => {
      expect(getStageProbability('closed')).toBe(1.0);
      expect(getStageProbability('won')).toBe(1.0);
      expect(getStageProbability('Closed Won')).toBe(1.0);
    });

    it('returns 30% for unrecognized stages', () => {
      expect(getStageProbability('custom_stage')).toBe(0.3);
      expect(getStageProbability('discovery')).toBe(0.3);
      expect(getStageProbability('')).toBe(0.3);
    });
  });

  describe('calculateWeightedValue', () => {
    it('calculates weighted value correctly', () => {
      expect(calculateWeightedValue(10000, 'qualified')).toBe(2500);
      expect(calculateWeightedValue(10000, 'proposal')).toBe(5000);
      expect(calculateWeightedValue(10000, 'closed')).toBe(10000);
    });

    it('returns 0 for zero amount', () => {
      expect(calculateWeightedValue(0, 'qualified')).toBe(0);
    });

    it('handles large values', () => {
      expect(calculateWeightedValue(1000000, 'negotiation')).toBe(750000);
    });
  });
});
