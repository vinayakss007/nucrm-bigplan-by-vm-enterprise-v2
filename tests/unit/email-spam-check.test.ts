import { describe, it, expect } from 'vitest';
import { checkSpam, SpamVerdict } from '../../lib/email/spam-check';

describe('spam-check', () => {
  it('returns CLEAN for normal email', () => {
    const result = checkSpam({
      subject: 'Meeting tomorrow',
      body: 'Hi team, just a reminder about our meeting tomorrow at 10am. Thanks!',
      fromName: 'John Doe',
    });
    expect(result.verdict).toBe(SpamVerdict.CLEAN);
    expect(result.score).toBe(0);
  });

  it('flags all-caps subject', () => {
    const result = checkSpam({
      subject: 'IMPORTANT URGENT NOTICE',
      body: 'Please read this.',
      fromName: 'Admin',
    });
    expect(result.flags).toContain('caps_subject');
    expect(result.score).toBeGreaterThanOrEqual(2);
  });

  it('flags excessive exclamation marks in subject', () => {
    const result = checkSpam({
      subject: 'AMAZING OFFER!!!',
      body: 'Click here now!',
      fromName: 'Marketer',
    });
    expect(result.flags).toContain('excessive_exclamation');
  });

  it('flags spammy words', () => {
    const result = checkSpam({
      subject: 'Free money act now',
      body: 'Limited time offer. Buy now risk-free.',
      fromName: 'Spammer',
    });
    expect(result.flags).toContain('spammy_words');
  });

  it('flags multiple minor spammy words', () => {
    const result = checkSpam({
      subject: 'Subscribe now for this opportunity',
      body: 'Opt in to get more info',
      fromName: 'Marketing',
    });
    expect(result.flags).toContain('minor_spammy_words');
  });

  it('flags high link ratio', () => {
    const result = checkSpam({
      subject: 'Check this out',
      body: 'Visit https://example1.com and https://example2.com for https://example3.com details https://example4.com',
      fromName: 'Spammer',
    });
    expect(result.flags).toContain('high_link_ratio');
  });

  it('flags low text content (very short body)', () => {
    const result = checkSpam({
      subject: 'Hello',
      body: 'Hi',
      fromName: 'User',
    });
    expect(result.flags).toContain('low_text_content');
  });

  it('returns BLOCKED verdict for high-scoring email', () => {
    const result = checkSpam({
      subject: 'FREE MONEY ACT NOW!!! LIMITED TIME OFFER!!!',
      body: 'Congratulations you won! Claim your prize now. Click here https://spam.com',
      fromName: 'Winner',
    });
    expect(result.verdict).toBe(SpamVerdict.BLOCKED);
    expect(result.score).toBeGreaterThanOrEqual(7);
  });

  it('returns SUSPICIOUS for medium score', () => {
    const result = checkSpam({
      subject: 'Great offer for you',
      body: 'This is a fantastic opportunity. Free information available.',
      fromName: 'Marketing',
    });
    expect(result.verdict).toBe(SpamVerdict.SUSPICIOUS);
  });
});
