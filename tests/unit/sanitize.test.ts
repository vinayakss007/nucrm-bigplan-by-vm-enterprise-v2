import { describe, it, expect, vi, afterEach } from 'vitest';
import { sanitizeHTMLServer, sanitizeHTML } from '@/lib/sanitize';
import { readFileSync } from 'fs';
import { join } from 'path';

// #CRIT-1: dompurify < 3.2.6 has HIGH-severity XSS bypass advisories
// (selectedcontent re-clone; cross-realm IN_PLACE sanitization). The whole
// dangerouslySetInnerHTML surface (email templates/builder, TOTP QR) relies on
// this package, so guard against an accidental downgrade below the patched line.
describe('dompurify version guard (#CRIT-1)', () => {
  it('resolves a patched dompurify (>= 3.2.6)', () => {
    // dompurify's exports map blocks importing ./package.json, so read it from
    // the installed module directory directly.
    const pkgPath = join(process.cwd(), 'node_modules', 'dompurify', 'package.json');
    const { version } = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
    const [major, minor, patch] = version.split('.').map((n) => parseInt(n, 10));
    const patched =
      major > 3 ||
      (major === 3 && minor > 2) ||
      (major === 3 && minor === 2 && patch >= 6);
    expect(patched, `dompurify ${version} is below the patched 3.2.6`).toBe(true);
  });
});

describe('sanitizeHTMLServer', () => {
  it('strips all HTML tags', () => {
    expect(sanitizeHTMLServer('<b>bold</b>')).toBe('bold');
    // DOMPurify correctly scrubs <script> entirely rather than leaving its contents
    expect(sanitizeHTMLServer('<script>alert("xss")</script>')).toBe('');
    expect(sanitizeHTMLServer('<a href="evil.com">click</a>')).toBe('click');
  });

  it('returns empty string for empty input', () => {
    expect(sanitizeHTMLServer('')).toBe('');
  });

  it('preserves plain text', () => {
    expect(sanitizeHTMLServer('hello world')).toBe('hello world');
  });

  it('strips nested tags', () => {
    expect(sanitizeHTMLServer('<div><p>text</p></div>')).toBe('text');
  });

  it('handles malformed HTML', () => {
    expect(sanitizeHTMLServer('<b>unclosed')).toBe('unclosed');
  });

  it('removes tags with attributes', () => {
    expect(sanitizeHTMLServer('<a onclick="evil()">link</a>')).toBe('link');
  });

  it('handles self-closing tags', () => {
    expect(sanitizeHTMLServer('<br />text<br>')).toBe('text');
  });

  it('handles multiple lines', () => {
    expect(sanitizeHTMLServer('<div>\n<p>line1</p>\n<p>line2</p>\n</div>')).toBe('\nline1\nline2\n');
  });
});

describe('sanitizeHTML', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('sanitizes properly on the server side instead of insecure regex fallback', async () => {
    const { sanitizeHTML } = await import('@/lib/sanitize');
    const result = sanitizeHTML('<b>bold</b><script>evil</script>');
    expect(result).toBe('<b>bold</b>');
  });

  it('returns empty for empty html server-side', async () => {
    const { sanitizeHTML } = await import('@/lib/sanitize');
    expect(sanitizeHTML('')).toBe('');
  });

  it('returns plain text unchanged server-side', async () => {
    const { sanitizeHTML } = await import('@/lib/sanitize');
    expect(sanitizeHTML('just text')).toBe('just text');
  });

  it('sanitizes properly bypassing window checks', async () => {
    const { sanitizeHTML } = await import('@/lib/sanitize');
    const result = sanitizeHTML('<b>safe</b>');
    expect(result).toBe('<b>safe</b>');
  });

  it('sanitizes HTML using provided windowRef gracefully', async () => {
    const { sanitizeHTML } = await import('@/lib/sanitize');
    const fakeWindow = {} as Window;
    const result = sanitizeHTML('<i>italic</i>', fakeWindow);
    expect(result).toBe('<i>italic</i>');
  });
});
