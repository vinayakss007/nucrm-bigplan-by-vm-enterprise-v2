import { describe, it, expect } from 'vitest';
import { classifyTimeSlot, getOptimalSendTime } from '../../lib/email/send-optimizer';

describe('send-optimizer', () => {
  describe('classifyTimeSlot', () => {
    it('classifies 6-11 as morning', () => {
      expect(classifyTimeSlot(6)).toBe('morning');
      expect(classifyTimeSlot(11)).toBe('morning');
    });

    it('classifies 12-16 as afternoon', () => {
      expect(classifyTimeSlot(12)).toBe('afternoon');
      expect(classifyTimeSlot(16)).toBe('afternoon');
    });

    it('classifies 0-5 and 17-23 as evening', () => {
      expect(classifyTimeSlot(0)).toBe('evening');
      expect(classifyTimeSlot(5)).toBe('evening');
      expect(classifyTimeSlot(17)).toBe('evening');
      expect(classifyTimeSlot(23)).toBe('evening');
    });
  });

  describe('getOptimalSendTime', () => {
    it('returns default with 0 confidence when no history', () => {
      const result = getOptimalSendTime({ openHistory: [] });
      expect(result.dayOfWeek).toBe(1);
      expect(result.hour).toBe(9);
      expect(result.confidence).toBe(0);
    });

    it('returns default with 0 confidence when no opens', () => {
      const result = getOptimalSendTime({
        openHistory: [
          { dayOfWeek: 2, hour: 10, opened: false },
          { dayOfWeek: 3, hour: 14, opened: false },
        ],
      });
      expect(result.dayOfWeek).toBe(1);
      expect(result.hour).toBe(9);
      expect(result.confidence).toBe(0);
    });

    it('picks the most common open slot', () => {
      const result = getOptimalSendTime({
        openHistory: [
          { dayOfWeek: 2, hour: 10, opened: true },
          { dayOfWeek: 2, hour: 10, opened: true },
          { dayOfWeek: 3, hour: 14, opened: true },
        ],
      });
      expect(result.dayOfWeek).toBe(2);
      expect(result.hour).toBe(10);
    });

    it('averages when multiple slots tie for max', () => {
      const result = getOptimalSendTime({
        openHistory: [
          { dayOfWeek: 2, hour: 10, opened: true },
          { dayOfWeek: 4, hour: 14, opened: true },
        ],
      });
      expect(result.dayOfWeek).toBe(3);
      expect(result.hour).toBe(12);
    });

    it('computes confidence as maxCount / totalOpens', () => {
      const result = getOptimalSendTime({
        openHistory: [
          { dayOfWeek: 1, hour: 9, opened: true },
          { dayOfWeek: 1, hour: 9, opened: true },
          { dayOfWeek: 2, hour: 10, opened: true },
          { dayOfWeek: 2, hour: 10, opened: true },
        ],
      });
      expect(result.confidence).toBe(0.5);
    });
  });
});
