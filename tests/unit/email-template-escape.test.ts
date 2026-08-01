import { describe, it, expect } from 'vitest';
import { escapeHtml } from '@/lib/email/escape-html';

describe('Email Template HTML Escape', () => {
  it('escapes < to &lt;', () => {
    expect(escapeHtml('<')).toBe('&lt;');
  });

  it('escapes > to &gt;', () => {
    expect(escapeHtml('>')).toBe('&gt;');
  });

  it('escapes & to &amp;', () => {
    expect(escapeHtml('&')).toBe('&amp;');
  });

  it('escapes " to &quot;', () => {
    expect(escapeHtml('"')).toBe('&quot;');
  });

  it("escapes ' to &#39;", () => {
    expect(escapeHtml("'")).toBe('&#39;');
  });

  it('a string with mixed HTML characters escapes all of them', () => {
    const input = `<script>alert("xss" & 'injection')</script>`;
    const expected = '&lt;script&gt;alert(&quot;xss&quot; &amp; &#39;injection&#39;)&lt;/script&gt;';
    expect(escapeHtml(input)).toBe(expected);
  });

  it('leaves safe strings unchanged', () => {
    expect(escapeHtml('Hello World')).toBe('Hello World');
  });

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });
});
