/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { describe, it, expect } from 'vitest';
import { redactUrl } from '@/lib/logger/pii';

describe('redactUrl (#1293)', () => {
  it('strips the query string (which may carry tokens/keys)', () => {
    const out = redactUrl('https://hooks.example.com/webhook?token=SECRET&sig=abc123');
    expect(out).toBe('https://hooks.example.com/webhook?…');
    expect(out).not.toContain('SECRET');
    expect(out).not.toContain('abc123');
  });

  it('keeps origin + pathname when there is no query string', () => {
    expect(redactUrl('https://hooks.example.com/webhook')).toBe('https://hooks.example.com/webhook');
  });

  it('drops userinfo credentials (user:pass@host)', () => {
    const out = redactUrl('https://user:p4ssw0rd@hooks.example.com/hook?x=1');
    expect(out).toBe('https://hooks.example.com/hook?…');
    expect(out).not.toContain('p4ssw0rd');
  });

  it('handles non-URL strings defensively by dropping after the first ?', () => {
    expect(redactUrl('not a url?token=leak')).toBe('not a url?…');
    expect(redactUrl('not a url?token=leak')).not.toContain('leak');
  });

  it('returns *** for empty/nullish input', () => {
    expect(redactUrl('')).toBe('***');
    expect(redactUrl(null)).toBe('***');
    expect(redactUrl(undefined)).toBe('***');
  });
});
