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
});
