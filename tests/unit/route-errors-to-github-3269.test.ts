/**
 * #3269 — a route runtime error must reach the tracker as ONE issue, and the
 * filing must never be able to hurt the caller.
 *
 * The assertions below are the issue's own acceptance criteria, not a snapshot
 * of the implementation:
 *
 *   - unset config files nothing (no request at all),
 *   - the same error twice files once (fingerprint + cooldown),
 *   - an error that already has an open issue is recognised, not duplicated,
 *   - a GitHub failure is returned as a value and never thrown, so `logError`
 *     cannot break a request over it,
 *   - `logError` actually calls it (the "wired, not just written" half).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  AUTOMATED_ISSUE_LABEL,
  DEFAULT_COOLDOWN_MS,
  errorFingerprint,
  fileErrorIssue,
  issueBody,
  issueTitle,
  meetsLevelFloor,
  readIssueFilingConfig,
  resetIssueCooldown,
  FINGERPRINT_MARKER_PREFIX,
} from '@/lib/errors/github-issue';

const CONFIGURED_ENV = {
  GITHUB_ISSUES_TOKEN: 'ghp_test_token',
  GITHUB_ISSUES_REPO: 'owner/repo',
};

/** A fetch double that answers the dedupe search and the issue create separately. */
function fetchDouble(opts: {
  searchBody?: string | null;
  searchOk?: boolean;
  createOk?: boolean;
  createStatus?: number;
  createUrl?: string;
} = {}) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/search/issues')) {
      const ok = opts.searchOk ?? true;
      return {
        ok,
        status: ok ? 200 : 500,
        json: async () => ({
          items: opts.searchBody ? [{ number: 7, html_url: 'https://github.com/owner/repo/issues/7', body: opts.searchBody }] : [],
        }),
      } as unknown as Response;
    }
    const ok = opts.createOk ?? true;
    return {
      ok,
      status: opts.createStatus ?? (ok ? 201 : 422),
      json: async () => ({ html_url: opts.createUrl ?? 'https://github.com/owner/repo/issues/99' }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

const BASE_INPUT = {
  message: 'Failed query: select from deals',
  level: 'error' as const,
  context: 'GET /api/tenant/deals',
  requestId: 'req-1',
};

describe('#3269 — GitHub issue filing for runtime errors', () => {
  beforeEach(() => {
    resetIssueCooldown();
  });

  afterEach(() => {
    resetIssueCooldown();
    vi.restoreAllMocks();
  });

  describe('config gate', () => {
    it('is disabled when neither variable is set', async () => {
      const fetchImpl = fetchDouble();
      const result = await fileErrorIssue(BASE_INPUT, { env: {}, fetchImpl });
      expect(result.outcome).toBe('disabled');
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('is disabled when only the token is set', async () => {
      const fetchImpl = fetchDouble();
      const result = await fileErrorIssue(BASE_INPUT, {
        env: { GITHUB_ISSUES_TOKEN: 'ghp_x' },
        fetchImpl,
      });
      expect(result.outcome).toBe('disabled');
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('rejects a repo that is not owner/repo instead of 404ing on every error', () => {
      expect(readIssueFilingConfig({ GITHUB_ISSUES_TOKEN: 't', GITHUB_ISSUES_REPO: 'just-a-name' })).toBeNull();
      expect(readIssueFilingConfig({ GITHUB_ISSUES_TOKEN: 't', GITHUB_ISSUES_REPO: 'owner/repo' })).not.toBeNull();
    });

    it('defaults the level floor to error and honours an explicit one', () => {
      expect(readIssueFilingConfig(CONFIGURED_ENV)?.minLevel).toBe('error');
      expect(readIssueFilingConfig({ ...CONFIGURED_ENV, GITHUB_ISSUES_MIN_LEVEL: 'fatal' })?.minLevel).toBe('fatal');
      expect(readIssueFilingConfig({ ...CONFIGURED_ENV, GITHUB_ISSUES_MIN_LEVEL: 'nonsense' })?.minLevel).toBe('error');
    });

    it('filters by the level floor both ways', async () => {
      const fetchImpl = fetchDouble();

      const warning = await fileErrorIssue(
        { ...BASE_INPUT, level: 'warning' },
        { env: CONFIGURED_ENV, fetchImpl },
      );
      expect(warning.outcome).toBe('level-filtered');

      resetIssueCooldown();
      const fatal = await fileErrorIssue(
        { ...BASE_INPUT, level: 'fatal' },
        { env: { ...CONFIGURED_ENV, GITHUB_ISSUES_MIN_LEVEL: 'fatal' }, fetchImpl },
      );
      expect(fatal.outcome).toBe('created');

      expect(meetsLevelFloor('warning', 'error')).toBe(false);
      expect(meetsLevelFloor('fatal', 'error')).toBe(true);
    });
  });

  describe('fingerprint', () => {
    it('is stable for the same message and context', () => {
      const a = errorFingerprint({ message: 'boom', context: 'GET /x' });
      const b = errorFingerprint({ message: 'boom', context: 'GET /x' });
      expect(a).toBe(b);
      expect(a).toMatch(/^[0-9a-f]{16}$/);
    });

    it('separates the same message in different places, and different messages in one place', () => {
      expect(errorFingerprint({ message: 'boom', context: 'GET /a' })).not.toBe(
        errorFingerprint({ message: 'boom', context: 'GET /b' }),
      );
      expect(errorFingerprint({ message: 'boom', context: 'GET /a' })).not.toBe(
        errorFingerprint({ message: 'bang', context: 'GET /a' }),
      );
    });

    it('does not depend on a stack, so a moved function keeps its issue', () => {
      // Same message + context, deliberately different stacks: the fingerprint
      // has no stack input at all, which is the property being asserted.
      const withStack = { message: 'boom', context: 'GET /a', stack: 'at foo (a.ts:1:1)' };
      expect(errorFingerprint(withStack)).toBe(errorFingerprint({ message: 'boom', context: 'GET /a' }));
    });
  });

  describe('filing', () => {
    it('creates one issue and carries the fingerprint marker + label', async () => {
      const fetchImpl = fetchDouble();
      const result = await fileErrorIssue(BASE_INPUT, { env: CONFIGURED_ENV, fetchImpl });

      expect(result.outcome).toBe('created');
      expect(result.url).toBe('https://github.com/owner/repo/issues/99');

      const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const create = calls.find((c) => String(c[0]).endsWith('/issues'));
      expect(create).toBeTruthy();
      const body = JSON.parse((create?.[1] as RequestInit).body as string);
      expect(body.title).toContain('GET /api/tenant/deals');
      expect(body.title).toContain('Failed query');
      expect(body.body).toContain(`${FINGERPRINT_MARKER_PREFIX}${result.fingerprint}`);
      expect(body.labels).toEqual([AUTOMATED_ISSUE_LABEL]);
      // No credentials in the artifact.
      expect(body.body).not.toContain('ghp_test_token');
    });

    it('files the same error only once inside the cooldown', async () => {
      const fetchImpl = fetchDouble();
      const first = await fileErrorIssue(BASE_INPUT, { env: CONFIGURED_ENV, fetchImpl });
      const second = await fileErrorIssue(BASE_INPUT, { env: CONFIGURED_ENV, fetchImpl });

      expect(first.outcome).toBe('created');
      expect(second.outcome).toBe('deduped-in-flight');
      expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2); // search + create
    });

    it('files again once the cooldown has elapsed', async () => {
      const fetchImpl = fetchDouble();
      const now = Date.now();
      await fileErrorIssue(BASE_INPUT, { env: CONFIGURED_ENV, fetchImpl, now });
      const later = await fileErrorIssue(BASE_INPUT, {
        env: CONFIGURED_ENV,
        fetchImpl,
        now: now + DEFAULT_COOLDOWN_MS + 1,
      });
      expect(later.outcome).toBe('created');
    });

    it('recognises an existing open issue by its marker instead of duplicating it', async () => {
      const fingerprint = errorFingerprint({ message: BASE_INPUT.message, context: BASE_INPUT.context });
      const fetchImpl = fetchDouble({
        searchBody: `${FINGERPRINT_MARKER_PREFIX}${fingerprint} -->\n\nbody`,
      });

      const result = await fileErrorIssue(BASE_INPUT, { env: CONFIGURED_ENV, fetchImpl });

      expect(result.outcome).toBe('deduped-existing');
      expect(result.url).toBe('https://github.com/owner/repo/issues/7');
      const urls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.endsWith('/issues'))).toBe(false);
    });

    it('does not treat a word-matching search hit without the marker as the same error', async () => {
      const fetchImpl = fetchDouble({ searchBody: 'some other issue mentioning nucrm-error-fingerprint' });
      const result = await fileErrorIssue(BASE_INPUT, { env: CONFIGURED_ENV, fetchImpl });
      expect(result.outcome).toBe('created');
    });

    it('returns a failure instead of throwing when GitHub rejects the create', async () => {
      const fetchImpl = fetchDouble({ createOk: false, createStatus: 422 });
      const result = await fileErrorIssue(BASE_INPUT, { env: CONFIGURED_ENV, fetchImpl });
      expect(result.outcome).toBe('failed');
      expect(result.error).toContain('422');
    });

    it('returns a failure instead of throwing when the network is down', async () => {
      const fetchImpl = vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof fetch;

      const result = await fileErrorIssue(BASE_INPUT, { env: CONFIGURED_ENV, fetchImpl });

      expect(result.outcome).toBe('failed');
      expect(result.error).toContain('ECONNREFUSED');
      // A failed attempt must not arm the cooldown, or a transient outage would
      // silence the error for the whole window.
      const retry = await fileErrorIssue(BASE_INPUT, { env: CONFIGURED_ENV, fetchImpl: fetchDouble() });
      expect(retry.outcome).toBe('created');
    });

    it('survives a search endpoint that is down', async () => {
      const fetchImpl = fetchDouble({ searchOk: false });
      const result = await fileErrorIssue(BASE_INPUT, { env: CONFIGURED_ENV, fetchImpl });
      expect(result.outcome).toBe('created');
    });
  });

  describe('rendering', () => {
    it('bounds the title and names the route', () => {
      const title = issueTitle({ ...BASE_INPUT, message: 'x'.repeat(500) });
      expect(title.length).toBeLessThanOrEqual(240);
      expect(title.startsWith('[error] GET /api/tenant/deals:')).toBe(true);
    });

    it('falls back to the URL, then to unattributed, when there is no context', () => {
      expect(
        issueTitle({ ...BASE_INPUT, context: undefined, requestUrl: '/api/tenant/deals' }),
      ).toContain('/api/tenant/deals');
      expect(
        issueTitle({ ...BASE_INPUT, context: undefined, requestUrl: undefined }),
      ).toContain('unattributed');
    });

    it('renders the correlation fields and omits an absent stack', () => {
      const body = issueBody(BASE_INPUT, 'abc123');
      expect(body).toContain('req-1');
      expect(body).toContain('GET /api/tenant/deals');
      expect(body).not.toContain('## Stack');
    });

    it('includes the stack when one was captured', () => {
      const body = issueBody({ ...BASE_INPUT, stack: 'Error: boom\n  at x (y.ts:1:1)' }, 'abc123');
      expect(body).toContain('## Stack');
      expect(body).toContain('y.ts:1:1');
    });
  });

  describe('wiring — logError calls it', () => {
    it('forwards to the tracker from the one error funnel', async () => {
      const { readFileSync } = await import('node:fs');
      const source = readFileSync('lib/errors-server.ts', 'utf8');
      expect(source).toContain("import('@/lib/errors/github-issue')");
      expect(source).toContain('await forwardToGitHubIssue({');
      // Inside the external-sink block, so `captureToSentry:false` still quiets it.
      const blockStart = source.indexOf('if (opts.captureToSentry !== false) {');
      const callSite = source.indexOf('await forwardToGitHubIssue({');
      expect(blockStart).toBeGreaterThan(-1);
      expect(callSite).toBeGreaterThan(blockStart);
    });
  });
});
