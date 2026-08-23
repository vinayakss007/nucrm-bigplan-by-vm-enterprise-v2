/**
 * Resolve the public app URL with a production guard (#1261).
 *
 * A silent `localhost:3000` fallback in production breaks password-reset
 * emails, OAuth redirects and invites. In development the localhost default
 * is kept for convenience; anywhere else a missing NEXT_PUBLIC_APP_URL is a
 * hard error so misconfiguration surfaces immediately.
 */
export function getAppUrl(): string {
  const url = process.env['NEXT_PUBLIC_APP_URL'];
  if (url) return url.replace(/\/+$/, '');
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error(
      '[config] NEXT_PUBLIC_APP_URL is required in production — refusing to fall back to localhost (emails/OAuth/invites would break).',
    );
  }
  return 'http://localhost:3000';
}
