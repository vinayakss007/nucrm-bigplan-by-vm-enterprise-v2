// GDPR PII scrubbing for Sentry events.
// Shared by sentry.client.config.ts, sentry.server.config.ts, sentry.edge.config.ts.

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
    for (const key of ['url', 'query_string']) {
      if (typeof req[key] === 'string') {
        req[key] = req[key].split('?')[0];
      }
    }
    if (Array.isArray(req.cookies)) req.cookies = [];
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
          if (typeof v === 'string' && EMAIL_RE.test(v)) bc.data[k] = redactString(v);
          if (SENSITIVE_KEYS.test(k)) bc.data[k] = '[redacted]';
        }
      }
    }
  }

  return event;
}
