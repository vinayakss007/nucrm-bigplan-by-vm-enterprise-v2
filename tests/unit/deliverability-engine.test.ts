import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── D1: Spam Score Check ─────────────────────────────────────────────────

describe('spam score check', () => {
  let checkSpam: typeof import('@/lib/email/spam-check').checkSpam;
  let SpamVerdict: typeof import('@/lib/email/spam-check').SpamVerdict;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('@/lib/email/spam-check');
    checkSpam = mod.checkSpam;
    SpamVerdict = mod.SpamVerdict;
  });

  it('module loads', () => {
    expect(checkSpam).toBeDefined();
    expect(SpamVerdict).toBeDefined();
  });

  it('returns CLEAN for a normal business email', () => {
    const result = checkSpam({
      subject: 'Follow-up on our meeting',
      body: 'Hi John, just wanted to follow up on our discussion yesterday. Let me know if you have any questions.',
      fromName: 'Sales Team',
    });
    expect(result.verdict).toBe(SpamVerdict.CLEAN);
    expect(result.score).toBeLessThan(3);
    expect(result.flags).toHaveLength(0);
  });

  it('flags ALL CAPS subject line', () => {
    const result = checkSpam({
      subject: 'ACT NOW - LIMITED TIME OFFER',
      body: 'Hi, this is a great opportunity for you.',
      fromName: 'Deals',
    });
    expect(result.flags).toContain('caps_subject');
    expect(result.score).toBeGreaterThan(0);
  });

  it('flags excessive exclamation marks', () => {
    const result = checkSpam({
      subject: 'Quick question!!!',
      body: 'You won\'t believe this deal!!! It\'s amazing!!! Act now!!!',
      fromName: 'Promo',
    });
    expect(result.flags).toContain('excessive_exclamation');
  });

  it('flags spammy trigger words', () => {
    const result = checkSpam({
      subject: 'FREE MONEY - Buy now!!!',
      body: 'Click here to claim your prize. No obligation. Risk-free.',
      fromName: 'Offers',
    });
    expect(result.flags).toContain('spammy_words');
    expect(result.score).toBeGreaterThanOrEqual(3);
  });

  it('flags too many links relative to body length', () => {
    const result = checkSpam({
      subject: 'Check this out',
      body: 'Visit https://a.com and https://b.com and https://c.com and https://d.com and https://e.com for more.',
      fromName: 'Links',
    });
    expect(result.flags).toContain('high_link_ratio');
  });

  it('flags image-to-text ratio (subject only, no body text)', () => {
    const result = checkSpam({
      subject: 'Look at this image',
      body: '',
      fromName: 'Gallery',
    });
    // Empty body with link-heavy or no text
    expect(result.flags).toContain('low_text_content');
  });

  it('returns SUSPICIOUS for borderline content', () => {
    const result = checkSpam({
      subject: 'Quick offer for you',
      body: 'Buy now risk-free! Click here! Amazing deal! Subscribe for more info.',
      fromName: 'Best Deals',
    });
    expect(result.verdict).toBe(SpamVerdict.SUSPICIOUS);
    expect(result.score).toBeGreaterThanOrEqual(3);
    expect(result.score).toBeLessThan(7);
  });

  it('returns BLOCKED for extreme spam signals', () => {
    const result = checkSpam({
      subject: 'ACT NOW - FREE MONEY!!! CLICK HERE!!!',
      body: 'Buy now risk-free!!! Click here!!! No obligation!!! Claim your prize!!! You won!!! FREE FREE FREE!!!',
      fromName: 'Spammer',
    });
    expect(result.verdict).toBe(SpamVerdict.BLOCKED);
    expect(result.score).toBeGreaterThanOrEqual(7);
  });

  it('normalizes from address without flagging', () => {
    const result = checkSpam({
      subject: 'Hello',
      body: 'Just saying hi.',
      fromName: 'John Smith',
    });
    expect(result.verdict).toBe(SpamVerdict.CLEAN);
  });
});

// ─── D2: Bounce Classification ────────────────────────────────────────────

describe('bounce classification', () => {
  let classifyBounce: typeof import('@/lib/email/bounce-handler').classifyBounce;
  let BounceType: typeof import('@/lib/email/bounce-handler').BounceType;
  let shouldDisableAddress: typeof import('@/lib/email/bounce-handler').shouldDisableAddress;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('@/lib/email/bounce-handler');
    classifyBounce = mod.classifyBounce;
    BounceType = mod.BounceType;
    shouldDisableAddress = mod.shouldDisableAddress;
  });

  it('module loads', () => {
    expect(classifyBounce).toBeDefined();
    expect(BounceType).toBeDefined();
    expect(shouldDisableAddress).toBeDefined();
  });

  it('classifies hard bounce from 550 user unknown', () => {
    const result = classifyBounce({
      diagnosticCode: '550 5.1.1 The email account that you tried to reach does not exist',
      smtpCode: 550,
      enhancedCode: '5.1.1',
    });
    expect(result.type).toBe(BounceType.HARD);
    expect(result.reason).toContain('5.1.1');
  });

  it('classifies hard bounce from 551 user not local', () => {
    const result = classifyBounce({
      diagnosticCode: '551 5.1.1 User not local',
      smtpCode: 551,
      enhancedCode: '5.1.1',
    });
    expect(result.type).toBe(BounceType.HARD);
  });

  it('classifies hard bounce from mailbox disabled', () => {
    const result = classifyBounce({
      diagnosticCode: '550 5.2.1 The user account is disabled',
      smtpCode: 550,
      enhancedCode: '5.2.1',
    });
    expect(result.type).toBe(BounceType.HARD);
  });

  it('classifies soft bounce from mailbox full', () => {
    const result = classifyBounce({
      diagnosticCode: '452 4.2.2 The email account that you tried to reach is over quota',
      smtpCode: 452,
      enhancedCode: '4.2.2',
    });
    expect(result.type).toBe(BounceType.SOFT);
  });

  it('classifies soft bounce from temporary failure', () => {
    const result = classifyBounce({
      diagnosticCode: '451 4.7.1 Try again later',
      smtpCode: 451,
      enhancedCode: '4.7.1',
    });
    expect(result.type).toBe(BounceType.SOFT);
  });

  it('classifies soft bounce from server unavailable', () => {
    const result = classifyBounce({
      diagnosticCode: '421 4.7.0 Try again later',
      smtpCode: 421,
      enhancedCode: '4.7.0',
    });
    expect(result.type).toBe(BounceType.SOFT);
  });

  it('classifies unknown bounce as soft by default', () => {
    const result = classifyBounce({
      diagnosticCode: 'Some unknown error',
      smtpCode: 0,
    });
    expect(result.type).toBe(BounceType.SOFT);
  });

  it('should disable address after 3 consecutive hard bounces', () => {
    const bounces = [
      { type: BounceType.HARD, count: 1 },
      { type: BounceType.HARD, count: 2 },
      { type: BounceType.HARD, count: 3 },
    ];
    expect(shouldDisableAddress(bounces)).toBe(true);
  });

  it('should not disable after soft bounces', () => {
    const bounces = [
      { type: BounceType.SOFT, count: 1 },
      { type: BounceType.SOFT, count: 2 },
      { type: BounceType.SOFT, count: 3 },
    ];
    expect(shouldDisableAddress(bounces)).toBe(false);
  });

  it('should not disable with mixed bounces below threshold', () => {
    const bounces = [
      { type: BounceType.HARD, count: 1 },
      { type: BounceType.SOFT, count: 1 },
      { type: BounceType.HARD, count: 2 },
    ];
    expect(shouldDisableAddress(bounces)).toBe(false);
  });

  it('should disable on first hard bounce if severity is critical', () => {
    const result = classifyBounce({
      diagnosticCode: '550 5.7.1 Your IP has been blocked',
      smtpCode: 550,
      enhancedCode: '5.7.1',
    });
    expect(result.shouldDisable).toBe(true);
  });
});

// ─── D5: Send-Time Optimization ───────────────────────────────────────────

describe('send-time optimization', () => {
  let getOptimalSendTime: typeof import('@/lib/email/send-optimizer').getOptimalSendTime;
  let classifyTimeSlot: typeof import('@/lib/email/send-optimizer').classifyTimeSlot;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('@/lib/email/send-optimizer');
    getOptimalSendTime = mod.getOptimalSendTime;
    classifyTimeSlot = mod.classifyTimeSlot;
  });

  it('module loads', () => {
    expect(getOptimalSendTime).toBeDefined();
    expect(classifyTimeSlot).toBeDefined();
  });

  it('returns weekday morning for business contacts', () => {
    const result = getOptimalSendTime({
      openHistory: [
        { dayOfWeek: 1, hour: 9, opened: true },
        { dayOfWeek: 2, hour: 10, opened: true },
        { dayOfWeek: 3, hour: 9, opened: true },
        { dayOfWeek: 4, hour: 11, opened: true },
      ],
    });
    expect(result.hour).toBeGreaterThanOrEqual(8);
    expect(result.hour).toBeLessThanOrEqual(11);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('returns evening for consumer contacts', () => {
    const result = getOptimalSendTime({
      openHistory: [
        { dayOfWeek: 1, hour: 19, opened: true },
        { dayOfWeek: 2, hour: 20, opened: true },
        { dayOfWeek: 3, hour: 18, opened: true },
        { dayOfWeek: 5, hour: 21, opened: true },
      ],
    });
    expect(result.hour).toBeGreaterThanOrEqual(17);
    expect(result.hour).toBeLessThanOrEqual(21);
  });

  it('returns default (weekday 9 AM) when no history', () => {
    const result = getOptimalSendTime({ openHistory: [] });
    expect(result.hour).toBe(9);
    expect(result.dayOfWeek).toBeGreaterThanOrEqual(1);
    expect(result.dayOfWeek).toBeLessThanOrEqual(5);
    expect(result.confidence).toBe(0);
  });

  it('classifies morning slot', () => {
    expect(classifyTimeSlot(9)).toBe('morning');
    expect(classifyTimeSlot(11)).toBe('morning');
  });

  it('classifies afternoon slot', () => {
    expect(classifyTimeSlot(13)).toBe('afternoon');
    expect(classifyTimeSlot(16)).toBe('afternoon');
  });

  it('classifies evening slot', () => {
    expect(classifyTimeSlot(18)).toBe('evening');
    expect(classifyTimeSlot(21)).toBe('evening');
  });

  it('handles multiple contacts by averaging', () => {
    const result = getOptimalSendTime({
      openHistory: [
        { dayOfWeek: 1, hour: 8, opened: true },
        { dayOfWeek: 1, hour: 14, opened: true },
        { dayOfWeek: 2, hour: 9, opened: true },
        { dayOfWeek: 2, hour: 15, opened: true },
      ],
    });
    // Average is around 11-12, should be reasonable
    expect(result.hour).toBeGreaterThanOrEqual(8);
    expect(result.hour).toBeLessThanOrEqual(16);
  });
});
