// GDPR PII scrubbing for Sentry events.
// Shared by instrumentation-client.ts (the browser entry the bundle actually
// loads), sentry.client.config.ts, sentry.server.config.ts and
// sentry.edge.config.ts. Second layer only: what the SDK may collect at all is
// decided by `dataCollection` in sentry-data-collection.ts.

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const SENSITIVE_HEADERS = ['authorization', 'cookie', 'set-cookie', 'x-api-key', 'x-auth-token', 'proxy-authorization'];
const SENSITIVE_KEYS = /^(password|passwd|secret|token|api[-_]?key|auth(?:orization)?|session[-_]?id|ssn|credit[-_]?card|cvv)$/i;
// Keys whose *whole value* is an identity, wherever a caller put them. Reached through
// `lib/errors-server.ts` -> `forwardToSentry`, which copies `logError({ metadata })` into
// `event.extra` verbatim (measured: `app/api/emergency/recover/route.ts:122` sends
// `{ ip, email }`, `lib/email/service.ts:316` sends `{ subject, recipients }`).
const IDENTITY_KEYS = /^(e-?mail|ip|ip_?address|client_?ip|remote_?addr|forwarded[-_]?for|subject|recipients?|to|from)$/i;
// Any `*url`/`*uri`/`*href` value: a query string there is a caller's own string, not
// `event.request`, so nothing else strips it (`app/api/auth/sso/start/route.ts` logs
// `extra.requestUrl` = the raw `GET /sso/start?email=…`, and scrubbing `event.request.url`
// does not touch that copy).
const URL_KEY = /(url|uri|href)$/i;

function redactString(value: string): string {
  return value.replace(EMAIL_RE, '[redacted-email]');
}

/**
 * Drop the query and fragment from a URL that arrived as a plain string value.
 * `search` returns -1 when there is neither, and `substring(0, -1)` is `''` —
 * the whole URL would vanish instead of just its parameters.
 */
function stripUrlParams(value: string): string {
  const cut = value.search(/[?#]/);
  return cut === -1 ? value : value.substring(0, cut);
}

/**
 * Walk one of Sentry's free-form scope bags (`event.extra`, `event.tags`) and
 * defang it in place. These are the fields our own code writes — `logError()`
 * copies its `metadata` argument straight into `extra` — so nothing in the SDK's
 * `dataCollection` switches controls them, and `beforeSend` is the only place
 * they can be stopped. Depth is capped because the bag is caller-supplied: a
 * self-referencing object would otherwise recurse forever, and a fourth level
 * is already deeper than anything in this repo's call sites.
 */
function scrubBag(bag: unknown, depth = 0): void {
  if (depth > 3 || bag === null || typeof bag !== 'object') return;
  if (Array.isArray(bag)) {
    for (let i = 0; i < bag.length; i++) {
      const item = bag[i];
      // A string member has no key to judge, so mask its emails and move on;
      // `recipients: ['a@b.co']` is the shape `lib/email/service.ts:316` uses.
      if (typeof item === 'string') bag[i] = redactString(item);
      else scrubBag(item, depth + 1);
    }
    return;
  }
  const record = bag as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (typeof value === 'string') {
      if (IDENTITY_KEYS.test(key) || SENSITIVE_KEYS.test(key)) record[key] = '[redacted]';
      // `substring`/`search` rather than `split('?')[0]`: the index read is
      // `string | undefined` under `noUncheckedIndexedAccess`, and a fragment
      // (`#`) carries the same payload risk as a query string.
      else record[key] = redactString(URL_KEY.test(key) ? stripUrlParams(value) : value);
    } else if (value !== null && typeof value === 'object') {
      scrubBag(value, depth + 1);
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function scrubPii(event: any): any {
  if (!event || typeof event !== 'object') return event;

  // Never send user identifiers.
  if (event.user) {
    delete event.user.email;
    delete event.user.ip_address;
    delete event.user.username;
  }

  // Strip query strings (may contain tokens/emails) from URLs.
  const req = event.request;
  if (req && typeof req === 'object') {
    if (typeof req.url === 'string') {
      req.url = redactString(req.url.split('?')[0]);
    }
    // `query_string` is sent as its own field by Sentry's HTTP integration, so dropping
    // the `?` from `url` above does not remove it. Redact rather than blank it: it is
    // often the only clue to what the caller actually asked for.
    if (typeof req.query_string === 'string') {
      req.query_string = redactString(req.query_string);
    }
    // Strings are the shape a real cookie header arrives in (`sid=1; theme=dark`), and
    // this is what the HTTP integration puts here — the array/object branches below are
    // the ones that could ever fire before, so a plain string cookie passed straight
    // through to Sentry with its session id intact.
    if (typeof req.cookies === 'string') req.cookies = '';
    else if (Array.isArray(req.cookies)) req.cookies = [];
    else if (req.cookies && typeof req.cookies === 'object') req.cookies = {};
    if (req.headers && typeof req.headers === 'object') {
      for (const h of Object.keys(req.headers)) {
        if (SENSITIVE_HEADERS.includes(h.toLowerCase())) {
          req.headers[h] = '[redacted]';
        }
      }
    }
  }

  // Our own code writes these three bags, so `dataCollection` cannot stop them.
  // `logError()` (lib/errors-server.ts) copies its `metadata` straight into
  // `extra`, and `captureError()` copies its scope into `tags`.
  scrubBag(event.extra);
  scrubBag(event.tags);
  scrubBag(event.contexts);

  // Redact emails from free-text surfaces.
  if (typeof event.message === 'string') {
    event.message = redactString(event.message);
  }
  if (Array.isArray(event.exception?.values)) {
    for (const ex of event.exception.values) {
      if (typeof ex.value === 'string') ex.value = redactString(ex.value);
       
      if (ex.stacktrace?.frames) {
         
        for (const frame of ex.stacktrace.frames) {
          for (const field of ['filename', 'abs_path', 'function'] as const) {
            if (typeof frame[field] === 'string') frame[field] = redactString(frame[field]);
          }
          if (frame.vars && typeof frame.vars === 'object') {
            for (const k of Object.keys(frame.vars)) {
              if (SENSITIVE_KEYS.test(k)) frame.vars[k] = '[redacted]';
            }
          }
        }
      }
    }
  }
  if (Array.isArray(event.breadcrumbs)) {
     
    for (const bc of event.breadcrumbs) {
      if (typeof bc.message === 'string') bc.message = redactString(bc.message);
      if (bc.data && typeof bc.data === 'object') {
        for (const k of Object.keys(bc.data)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const v = (bc.data as any)[k];
          // Unconditional, not `if (EMAIL_RE.test(v))`: EMAIL_RE is /g, and a global
          // regex carries `lastIndex` between `.test()` calls, so the guard returned
          // false for a value whose email sat before the previous match's end position
          // and let that address go out unredacted. `replace` resets `lastIndex` itself.
          if (typeof v === 'string') bc.data[k] = redactString(v);
          if (SENSITIVE_KEYS.test(k)) bc.data[k] = '[redacted]';
        }
      }
    }
  }

  return event;
}
