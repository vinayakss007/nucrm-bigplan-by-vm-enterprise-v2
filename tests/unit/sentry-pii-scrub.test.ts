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

describe('scrubPii — scope bags written by our own code', () => {
  it('redacts email and ip keys anywhere in `extra`', () => {
    // `lib/errors-server.ts` copies `logError({ metadata })` into `extra` verbatim,
    // and `app/api/emergency/recover/route.ts` puts a raw super-admin email there.
    const out = scrubPii({
      extra: { requestMethod: 'POST', email: 'root@tenant.co', metadata: { ip: '203.0.113.9', tenant: 'acme' } },
    });
    expect(out.extra).toEqual({
      requestMethod: 'POST',
      email: '[redacted]',
      metadata: { ip: '[redacted]', tenant: 'acme' },
    });
  });

  it('masks emails inside array members, which have no key to judge by', () => {
    // An array keeps its shape (how many recipients failed to send is the clue),
    // so members are masked rather than replaced wholesale.
    const out = scrubPii({ extra: { recipients: ['alice@corp.co', 'bob@corp.co'], cc: 'carol@corp.co' } });
    expect(out.extra.recipients).toEqual(['[redacted-email]', '[redacted-email]']);
    expect(out.extra.cc).toBe('[redacted-email]');
  });

  it('strips the query string from any `*url` value in `extra`', () => {
    // `app/api/auth/sso/start/route.ts` logs `extra.requestUrl` with `?email=`
    // intact; scrubbing `event.request.url` does not touch that second copy.
    const out = scrubPii({ extra: { requestUrl: 'https://app.example/api/auth/sso/start?email=a@b.co&token=x' } });
    expect(out.extra.requestUrl).toBe('https://app.example/api/auth/sso/start');
  });

  it('keeps a clean url clean, and drops a fragment as well as a query', () => {
    // `search()` returns -1 when there is neither, and `substring(0, -1)` is `''`
    // — a naive strip would blank every parameterless URL in `extra`.
    const out = scrubPii({
      extra: { webhookUrl: 'https://hooks.tenant.co/inbound', shareUrl: 'https://app/#/deals?owner=a@b.co' },
    });
    expect(out.extra.webhookUrl).toBe('https://hooks.tenant.co/inbound');
    expect(out.extra.shareUrl).toBe('https://app/');
  });

  it('redacts emails in `tags`, which carry customer-created automation names', () => {
    const out = scrubPii({ tags: { context: 'automation: notify alice@corp.co', tenantId: '9f2c…' } });
    expect(out.tags.context).toBe('automation: notify [redacted-email]');
    expect(out.tags.tenantId).toBe('9f2c…');
  });

  it('does not loop forever on a self-referencing bag', () => {
    const bag: Record<string, unknown> = { name: 'x' };
    bag.self = bag;
    expect(() => scrubPii({ extra: bag })).not.toThrow();
  });

  it('leaves a bag that holds only opaque ids alone', () => {
    const extra = { requestId: '0d9f-1a2b', attempt: 3, at: '2026-10-04T05:00:00Z' };
    expect(scrubPii({ extra }).extra).toEqual(extra);
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
