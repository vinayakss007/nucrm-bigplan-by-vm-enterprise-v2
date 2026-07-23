import { describe, it, expect } from 'vitest';
import { classifyBounce, shouldDisableAddress, BounceType } from '../../lib/email/bounce-handler';

describe('bounce-handler', () => {
  describe('classifyBounce', () => {
    it('classifies enhanced code 5.1.1 as hard bounce', () => {
      const result = classifyBounce({ diagnosticCode: '550 5.1.1 user unknown', smtpCode: 550, enhancedCode: '5.1.1' });
      expect(result.type).toBe(BounceType.HARD);
      expect(result.shouldDisable).toBe(false);
    });

    it('classifies enhanced code 5.2.1 as hard bounce (account issue)', () => {
      const result = classifyBounce({ diagnosticCode: '550 5.2.1 mailbox disabled', smtpCode: 550, enhancedCode: '5.2.1' });
      expect(result.type).toBe(BounceType.HARD);
    });

    it('classifies SMTP code 511 as hard bounce', () => {
      const result = classifyBounce({ diagnosticCode: '511 bad address', smtpCode: 511 });
      expect(result.type).toBe(BounceType.HARD);
    });

    it('classifies blocked diagnostic as critical hard bounce', () => {
      const result = classifyBounce({ diagnosticCode: 'Blocked by policy', smtpCode: 550 });
      expect(result.type).toBe(BounceType.HARD);
      expect(result.shouldDisable).toBe(true);
    });

    it('classifies user unknown as hard bounce', () => {
      const result = classifyBounce({ diagnosticCode: 'User unknown', smtpCode: 550 });
      expect(result.type).toBe(BounceType.HARD);
    });

    it('classifies unknown errors as soft bounce', () => {
      const result = classifyBounce({ diagnosticCode: 'Temporary failure', smtpCode: 450 });
      expect(result.type).toBe(BounceType.SOFT);
      expect(result.shouldDisable).toBe(false);
    });
  });

  describe('shouldDisableAddress', () => {
    it('returns false with fewer than 3 hard bounces', () => {
      const result = shouldDisableAddress([
        { type: BounceType.HARD, count: 2 },
      ]);
      expect(result).toBe(false);
    });

    it('returns true with 3 or more consecutive hard bounces', () => {
      const result = shouldDisableAddress([
        { type: BounceType.HARD, count: 1 },
        { type: BounceType.HARD, count: 1 },
        { type: BounceType.HARD, count: 1 },
      ]);
      expect(result).toBe(true);
    });

    it('ignores soft bounces when counting hard bounces', () => {
      const result = shouldDisableAddress([
        { type: BounceType.SOFT, count: 5 },
        { type: BounceType.HARD, count: 2 },
      ]);
      expect(result).toBe(false);
    });
  });
});
