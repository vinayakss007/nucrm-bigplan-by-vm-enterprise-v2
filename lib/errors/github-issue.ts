/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * #3269 — route runtime errors become GitHub issues.
 *
 * `logError` (`lib/errors-server.ts`) is the one funnel every structured server
 * error flows through, and it already fans out to three "assist" views: the
 * `error_logs` row, Sentry, and Loki. None of them puts the error somewhere a
 * human is *queued to act on*: a Sentry issue is dashboard-only (and
 * `SENTRY_AUTH_TOKEN` cannot even read issues — #2125), and a Loki line is
 * grep-only. So the error → issue → fix → redeploy loop had a missing arrow,
 * and the arrow it was missing is the one that lives in the tracker.
 *
 * This module is that arrow, with three constraints taken from the issue:
 *
 * 1. **Off by default, opt-in by env.** Filing needs `GITHUB_ISSUES_TOKEN` +
 *    `GITHUB_ISSUES_REPO` — the same pair `app/api/bug-report/route.ts` already
 *    uses for beta feedback, so there is one GitHub credential story, not two.
 *    Unset means a genuine no-op: no request, no log noise.
 * 2. **It can never affect the caller.** Every path is guarded; `logError`
 *    already treats its sinks as best-effort and this one is no different. A
 *    failed file is a `console.warn`, never a throw and never a delay past the
 *    HTTP timeout below.
 * 3. **One issue per distinct error, not one per occurrence.** A broken route
 *    answers hundreds of requests. The fingerprint (below) is stable across
 *    occurrences of the same error at the same context, an in-process cooldown
 *    absorbs a burst, and the issue body carries the fingerprint marker so a
 *    second app instance — or a human — can find the existing issue instead of
 *    opening a duplicate.
 *
 * What it deliberately does NOT do: post algedonic comments on every
 * recurrence. An issue whose timeline is a copy of Loki is a worse tracker; the
 * cooldown plus the occurrence count in the body is the compromise.
 */

/** Marker embedded in every filed issue body. Greppable, and stable across restarts. */
export const FINGERPRINT_MARKER_PREFIX = '<!-- nucrm-error-fingerprint:';
export const FINGERPRINT_MARKER_SUFFIX = ' -->';

/** Issues filed by this module carry this label so they are triageable as a set. */
export const AUTOMATED_ISSUE_LABEL = 'automated-error';

/** Hard cap on the HTTP round trip. Filing must never sit in a request's path. */
export const GITHUB_ISSUE_TIMEOUT_MS = 8_000;

/**
 * Burst absorber: the same fingerprint is not filed again for this long, in
 * this process. Twelve hours is long enough that a hot loop files once and
 * short enough that a daily regression surfaces the next day if the first
 * issue was closed as fixed.
 */
export const DEFAULT_COOLDOWN_MS = 12 * 60 * 60 * 1000;

export type IssueLevel = 'warning' | 'error' | 'fatal';

export interface RouteErrorIssueInput {
  /** Already redacted + truncated by `logError` (`truncateForStore`). */
  message: string;
  level: IssueLevel;
  context?: string;
  requestId?: string;
  requestUrl?: string;
  requestMethod?: string;
  /** Already redacted + truncated by `logError`. */
  stack?: string;
  tenantId?: string;
  userId?: string;
}

export interface FileIssueResult {
  /** What happened, so the caller (and its tests) can assert on it. */
  outcome: 'created' | 'deduped-in-flight' | 'deduped-existing' | 'disabled' | 'level-filtered' | 'failed';
  /** Set when GitHub answered 201 and gave a URL. */
  url?: string;
  /** Set when the outcome was failure, for the warn line. */
  error?: string;
  fingerprint?: string;
}

interface EnvLike {
  [key: string]: string | undefined;
}

/**
 * Stable id for "this error, at this place".
 *
 * Deliberately NOT the stack: stack frames carry line numbers, so the day a
 * function moves the fingerprint changes and every open issue stops matching
 * new occurrences (that is the same line-citation rot #3412 measures in the
 * docs). Message + context is what a human reads to decide "same bug?".
 *
 * Implemented without `crypto.subtle` so it is identical in the Node runtime,
 * the edge runtime, and a unit test: FNV-1a over UTF-16 code units, rendered as
 * 16 hex characters. It is a dedupe key, not a security primitive.
 */
export function errorFingerprint(input: { message: string; context?: string }): string {
  const text = `${input.context ?? ''}\u0000${input.message}`;
  // Two independent 32-bit passes with different offsets so a collision needs
  // two simultaneous FNV collisions rather than one.
  const fnv1a = (seed: number): string => {
    let hash = seed;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  };
  return `${fnv1a(0x811c9dc5)}${fnv1a(0x01000193)}`;
}

/** The GitHub config, or null when filing is not configured. Never returns the token in a loggable shape by accident. */
export function readIssueFilingConfig(env: EnvLike = process.env): { token: string; repo: string; minLevel: IssueLevel } | null {
  const token = env['GITHUB_ISSUES_TOKEN']?.trim();
  const repo = env['GITHUB_ISSUES_REPO']?.trim();
  if (!token || !repo) return null;
  // `owner/repo` — a repo name with the owner missing would 404 on every error,
  // which is worse than not filing, so refuse it up front.
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) return null;
  const raw = (env['GITHUB_ISSUES_MIN_LEVEL'] ?? 'error').trim().toLowerCase();
  const minLevel: IssueLevel = raw === 'warning' || raw === 'fatal' ? raw : 'error';
  return { token, repo, minLevel };
}

const LEVEL_RANK: Record<IssueLevel, number> = { warning: 0, error: 1, fatal: 2 };

/** True when this level is at or above the configured floor. */
export function meetsLevelFloor(level: IssueLevel, minLevel: IssueLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[minLevel];
}

/** In-process cooldown, keyed by fingerprint. Exported for tests. */
const lastFiledAt = new Map<string, number>();

/** Test hook: forget every cooldown so a single test process can re-file. */
export function resetIssueCooldown(): void {
  lastFiledAt.clear();
}

/**
 * The fingerprint of a *closed* issue should not suppress a new one forever, so
 * the cooldown is time-based rather than "seen once, silenced". A 12h window
 * means a regression that returns a week later is filed again.
 */
function isCoolingDown(fingerprint: string, now: number, cooldownMs: number): boolean {
  const last = lastFiledAt.get(fingerprint);
  if (last === undefined) return false;
  if (now - last >= cooldownMs) return false;
  return true;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * Issue title: the context, then the message. Context first because the
 * issue list is read top-down and "which route broke" is the routing decision.
 * Bounded so a pathological message cannot produce an unreadable title.
 */
export function issueTitle(input: RouteErrorIssueInput): string {
  const where = input.context?.trim() || input.requestUrl?.trim() || 'unattributed';
  const level = input.level === 'fatal' ? 'fatal' : 'error';
  return truncate(`[${level}] ${where}: ${input.message}`, 240);
}

export function issueBody(input: RouteErrorIssueInput, fingerprint: string): string {
  const lines = [
    `${FINGERPRINT_MARKER_PREFIX}${fingerprint}${FINGERPRINT_MARKER_SUFFIX}`,
    '',
    'A route raised this at runtime. Filed automatically by `logError` (#3269) — the same error is',
    'also in `error_logs`, and in Sentry/Loki when those sinks are on.',
    '',
    `| | |`,
    `| --- | --- |`,
    `| Level | \`${input.level}\` |`,
    `| Context | \`${input.context ?? '(none)'}\` |`,
    `| Route | \`${input.requestMethod ?? '?'} ${input.requestUrl ?? '(unknown)'}\` |`,
    `| Request id | \`${input.requestId ?? '(none)'}\` |`,
    `| Tenant | \`${input.tenantId ?? '(none)'}\` |`,
    '',
    '## Message',
    '',
    '```',
    truncate(input.message, 4_000),
    '```',
  ];
  if (input.stack) {
    lines.push('', '## Stack', '', '```', truncate(input.stack, 8_000), '```');
  }
  lines.push(
    '',
    '_The fingerprint above identifies this error. Identical errors are not filed again while this',
    'issue is open and the filing cooldown has not elapsed — check for an existing issue carrying the',
    'same marker before opening a new one._',
  );
  return lines.join('\n');
}

/** Find an open issue already carrying this fingerprint, so restarts do not duplicate. */
async function findExistingIssue(
  repo: string,
  token: string,
  fingerprint: string,
  fetchImpl: typeof fetch,
): Promise<{ number: number; url: string } | null> {
  const marker = `${FINGERPRINT_MARKER_PREFIX}${fingerprint}`;
  const query = encodeURIComponent(`repo:${repo} is:issue is:open "${marker}"`);
  const res = await fetchImpl(`https://api.github.com/search/issues?q=${query}&per_page=1`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(GITHUB_ISSUE_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as
    | { items?: Array<{ number?: number; html_url?: string; body?: string }> }
    | null;
  const item = data?.items?.[0];
  if (!item?.number) return null;
  // The search API matches words, not exact substrings, so confirm the marker is
  // really in the body before treating this as the same error.
  if (typeof item.body === 'string' && !item.body.includes(marker)) return null;
  return { number: item.number, url: item.html_url ?? '' };
}

/**
 * File (or recognise) the issue for one error. Never throws.
 *
 * `fetchImpl` and `now` are injectable so the behaviour is testable without a
 * network or a fake clock global.
 */
export async function fileErrorIssue(
  input: RouteErrorIssueInput,
  options: {
    env?: EnvLike;
    fetchImpl?: typeof fetch;
    now?: number;
    cooldownMs?: number;
  } = {},
): Promise<FileIssueResult> {
  const env = options.env ?? process.env;
  // #2128: a vitest run must never file production issues. The tests that
  // exercise this module pass an explicit env, so they are unaffected.
  if (env['VITEST'] === 'true' || env['NODE_ENV'] === 'test') {
    if (!options.env) return { outcome: 'disabled' };
  }

  const config = readIssueFilingConfig(env);
  if (!config) return { outcome: 'disabled' };
  if (!meetsLevelFloor(input.level, config.minLevel)) return { outcome: 'level-filtered' };

  const fingerprint = errorFingerprint({ message: input.message, context: input.context });
  const now = options.now ?? Date.now();
  const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;

  if (isCoolingDown(fingerprint, now, cooldownMs)) {
    return { outcome: 'deduped-in-flight', fingerprint };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const existing = await findExistingIssue(config.repo, config.token, fingerprint, fetchImpl);
    if (existing) {
      // Remember the suppression so the next N occurrences do not each pay for
      // a search round trip.
      lastFiledAt.set(fingerprint, now);
      return { outcome: 'deduped-existing', url: existing.url, fingerprint };
    }

    const res = await fetchImpl(`https://api.github.com/repos/${config.repo}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        title: issueTitle(input),
        body: issueBody(input, fingerprint),
        // `automated-error` may not exist on a fresh fork; GitHub ignores an
        // unknown label rather than rejecting the issue.
        labels: [AUTOMATED_ISSUE_LABEL],
      }),
      signal: AbortSignal.timeout(GITHUB_ISSUE_TIMEOUT_MS),
    });

    if (!res.ok) {
      return { outcome: 'failed', error: `HTTP ${res.status}`, fingerprint };
    }
    const data = (await res.json().catch(() => null)) as { html_url?: string } | null;
    lastFiledAt.set(fingerprint, now);
    return { outcome: 'created', url: data?.html_url, fingerprint };
  } catch (err) {
    return {
      outcome: 'failed',
      error: err instanceof Error ? err.message : String(err),
      fingerprint,
    };
  }
}
