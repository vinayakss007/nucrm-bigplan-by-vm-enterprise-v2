import { describe, it, expect } from 'vitest';
import { scrubPii } from '@/sentry-pii-scrub';

// `beforeSend` is the last thing between our code and Sentry's storage, so these
// tests describe what a third party actually receives, not what we intended.

describe('scrubPii — breadcrumb data', () => {
  it('redacts an email in every breadcrumb data value, not just the first', () => {
    // Regression: the guard was `if (EMAIL_RE.test(v))`, and EMAIL_RE is /g, so
    // `.test()` resumed from the previous match's `lastIndex`. A long value whose
    // email sits near the end pushed the cursor past the start of the next one,
    // which then tested false and went out with the address intact.
    const event = {
      breadcrumbs: [
        { message: 'first', data: { detail: 'notified verylongaddress.beforethetld@example.com' } },
        { message: 'second', data: { detail: 'a@b.co' } },
      ],
    };
    const out = scrubPii(event);
    expect(out.breadcrumbs[0].data.detail).toBe('notified [redacted-email]');
    expect(out.breadcrumbs[1].data.detail).toBe('[redacted-email]');
  });

  it('redacts the breadcrumb message', () => {
    const out = scrubPii({ breadcrumbs: [{ message: 'login failed for who@example.com' }] });
    expect(out.breadcrumbs[0].message).toBe('login failed for [redacted-email]');
  });

  it('replaces sensitive data keys wholesale', () => {
    const out = scrubPii({ breadcrumbs: [{ data: { password: 'hunter2', note: 'fine' } }] });
    expect(out.breadcrumbs[0].data).toEqual({ password: '[redacted]', note: 'fine' });
  });
});

describe('scrubPii — identity and request', () => {
  it('drops user identity fields but keeps the user object shape', () => {
    const out = scrubPii({ user: { email: 'a@b.co', ip_address: '1.2.3.4', username: 'admin' } });
    expect(out.user).toEqual({});
  });

  it('strips query strings and cookies, and redacts credential headers', () => {
    const out = scrubPii({
      request: {
        url: 'https://app.example/api/x?token=abc',
        query_string: 'email=a@b.co&token=abc',
        cookies: 'sessionid=deadbeef; theme=dark',
        headers: { authorization: 'Bearer secret', 'X-Api-Key': 'k', accept: 'application/json' },
      },
    });
    expect(out.request.url).toBe('https://app.example/api/x');
    expect(out.request.query_string).toBe('email=[redacted-email]&token=abc');
    expect(out.request.cookies).toBe('');
    expect(out.request.headers.authorization).toBe('[redacted]');
    expect(out.request.headers['X-Api-Key']).toBe('[redacted]');
    expect(out.request.headers.accept).toBe('application/json');
  });

  it('clears cookies in the array and object shapes too', () => {
    expect(scrubPii({ request: { cookies: ['sid=1'] } }).request.cookies).toEqual([]);
    expect(scrubPii({ request: { cookies: { sid: '1' } } }).request.cookies).toEqual({});
  });
});

describe('scrubPii — exception payload', () => {
  it('redacts emails in the exception value and in frame filenames', () => {
    const out = scrubPii({
      exception: {
        values: [{ value: 'send to alice@example.com failed', stacktrace: { frames: [{ filename: '/srv/uploads/alice@example.com/x.ts' }] } }],
      },
    });
    expect(out.exception.values[0].value).toBe('send to [redacted-email] failed');
    expect(out.exception.values[0].stacktrace.frames[0].filename).toBe('/srv/uploads/[redacted-email]/x.ts');
  });

  it('redacts sensitive local variables in a frame', () => {
    const out = scrubPii({
      exception: { values: [{ stacktrace: { frames: [{ vars: { ssn: '123-45-6789', id: 7 } }] } }] },
    });
    expect(out.exception.values[0].stacktrace.frames[0].vars).toEqual({ ssn: '[redacted]', id: 7 });
  });
});

describe('scrubPii — boundaries', () => {
  it('passes non-objects through unchanged', () => {
    expect(scrubPii(null)).toBeNull();
    expect(scrubPii('a string')).toBe('a string');
  });

  it('leaves an event with no PII alone', () => {
    const event = { message: 'plain', tags: { context: 'api' } };
    expect(scrubPii(event)).toEqual({ message: 'plain', tags: { context: 'api' } });
  });
});
