import { describe, it, expect } from 'vitest';
import { getStageProbability, calculateWeightedValue } from '@/lib/forecast';

describe('Forecast Probability', () => {
  describe('getStageProbability', () => {
    it("'Closed Lost' returns 0.0", () => {
      expect(getStageProbability('Closed Lost')).toBe(0.0);
    });

    it("'Lost' returns 0.0", () => {
      expect(getStageProbability('Lost')).toBe(0.0);
    });

    it("'Won' returns 1.0", () => {
      expect(getStageProbability('Won')).toBe(1.0);
    });

    it("'Closed Won' returns 1.0", () => {
      expect(getStageProbability('Closed Won')).toBe(1.0);
    });

    it("'Negotiation' returns 0.75", () => {
      expect(getStageProbability('Negotiation')).toBe(0.75);
    });

    it("'Proposal' returns 0.5", () => {
      expect(getStageProbability('Proposal')).toBe(0.5);
    });

    it("'Qualified' returns 0.25", () => {
      expect(getStageProbability('Qualified')).toBe(0.25);
    });
  });

  describe('calculateWeightedValue', () => {
    it("calculateWeightedValue(10000, 'Closed Lost') returns 0", () => {
      expect(calculateWeightedValue(10000, 'Closed Lost')).toBe(0);
    });

    it("calculateWeightedValue(10000, 'Won') returns 10000", () => {
      expect(calculateWeightedValue(10000, 'Won')).toBe(10000);
    });

    it("calculateWeightedValue(10000, 'Proposal') returns 5000", () => {
      expect(calculateWeightedValue(10000, 'Proposal')).toBe(5000);
    });

    it("calculateWeightedValue(10000, 'Negotiation') returns 7500", () => {
      expect(calculateWeightedValue(10000, 'Negotiation')).toBe(7500);
    });
  });
});
