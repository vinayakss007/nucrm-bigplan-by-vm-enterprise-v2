// GDPR PII scrubbing for Sentry events.
// Shared by instrumentation-client.ts (the browser entry the bundle actually
// loads), sentry.client.config.ts, sentry.server.config.ts and
// sentry.edge.config.ts. Second layer only: what the SDK may collect at all is
// decided by `dataCollection` in sentry-data-collection.ts.

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const SENSITIVE_HEADERS = ['authorization', 'cookie', 'set-cookie', 'x-api-key', 'x-auth-token', 'proxy-authorization'];
const SENSITIVE_KEYS = /^(password|passwd|secret|token|api[-_]?key|auth(?:orization)?|session[-_]?id|ssn|credit[-_]?card|cvv)$/i;

function redactString(value: string): string {
  return value.replace(EMAIL_RE, '[redacted-email]');
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
