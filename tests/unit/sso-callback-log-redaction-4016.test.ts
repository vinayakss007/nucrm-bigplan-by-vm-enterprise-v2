import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { redactRequestUrl } from '@/app/api/auth/sso/callback/route';

const CALLBACK = join(import.meta.dirname!, '../../app/api/auth/sso/callback/route.ts');

describe('SSO callback log redaction (#4016)', () => {
  it('keeps only the pathname, dropping code, state and nonce query values', () => {
    const url = 'https://app.example.com/api/auth/sso/callback?code=SENSITIVE_CODE&state=SENSITIVE_STATE';
    expect(redactRequestUrl(url)).toBe('/api/auth/sso/callback');
    expect(redactRequestUrl(url)).not.toContain('SENSITIVE_CODE');
  });

  it('handles malformed URLs without throwing', () => {
    expect(redactRequestUrl('not a url')).toBe('(invalid-url)');
  });

  it('both logError calls use the redacted URL', () => {
    const source = readFileSync(CALLBACK, 'utf8');
    const logCalls = source.split('void logError(').slice(1);
    expect(logCalls.length).toBeGreaterThanOrEqual(2);
    for (const call of logCalls.slice(0, 2)) {
      expect(call).toContain('requestUrl: redactRequestUrl(request.url)');
      expect(call).not.toContain('requestUrl: request.url');
    }
  });
});
