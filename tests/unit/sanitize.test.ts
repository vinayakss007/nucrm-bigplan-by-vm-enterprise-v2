import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sanitizeHTMLServer } from '@/lib/sanitize';

describe('sanitizeHTMLServer', () => {
  it('strips all HTML tags', () => {
    expect(sanitizeHTMLServer('<b>bold</b>')).toBe('bold');
    expect(sanitizeHTMLServer('<script>alert("xss")</script>')).toBe('alert("xss")');
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

  it('uses server-side fallback when no window and no windowRef', async () => {
    const { sanitizeHTML } = await import('@/lib/sanitize');

    const result = sanitizeHTML('<b>bold</b><script>evil</script>');

    expect(result).toBe('boldevil');
  });

  it('returns empty for empty html server-side', async () => {
    const { sanitizeHTML } = await import('@/lib/sanitize');

    expect(sanitizeHTML('')).toBe('');
  });

  it('returns plain text unchanged server-side', async () => {
    const { sanitizeHTML } = await import('@/lib/sanitize');

    expect(sanitizeHTML('just text')).toBe('just text');
  });
});

describe('sanitizeHTML with DOMPurify', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mock('dompurify', () => ({
      default: vi.fn(() => ({
        sanitize: vi.fn((html: string) => `<p>${html}</p>`),
      })),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('sanitizes HTML using DOMPurify when window is available', async () => {
    vi.stubGlobal('window', {});

    const { sanitizeHTML } = await import('@/lib/sanitize');

    const result = sanitizeHTML('<b>safe</b>');

    expect(result).toBe('<p><b>safe</b></p>');
  });

  it('sanitizes HTML using provided windowRef', async () => {
    const { sanitizeHTML } = await import('@/lib/sanitize');

    const fakeWindow = {} as Window;
    const result = sanitizeHTML('<i>italic</i>', fakeWindow);

    expect(result).toBe('<p><i>italic</i></p>');
  });
});
