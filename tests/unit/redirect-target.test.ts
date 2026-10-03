import { describe, it, expect } from 'vitest';
import { safeRedirectTarget } from '@/lib/security/redirect-target';
import { readClickLinkDestination, CLICK_LINKS_METADATA_KEY } from '@/lib/email/tracking';

describe('safeRedirectTarget (#2218)', () => {
  it('accepts absolute http(s) targets and returns them unchanged', () => {
    for (const ok of ['https://example.com/a?b=1#c', 'http://example.com/', 'https://sub.domain.co.in']) {
      expect(safeRedirectTarget(ok)).toBe(ok);
    }
  });

  const refused: [unknown, string][] = [
    ['javascript:alert(1)', 'script scheme'],
    ['  javascript:alert(1)  ', 'script scheme padded'],
    ['java\tscript:alert(1)', 'script scheme split by a tab'],
    ['data:text/html;base64,PHNjcmlwdD4=', 'data scheme'],
    ['vbscript:msgbox(1)', 'vbscript scheme'],
    ['//evil.example.com/x', 'protocol-relative'],
    ['/relative/path', 'relative path'],
    ['evil.example.com/x', 'schemeless host'],
    ['https://169.254.169.254/', 'link-local IP'],
    ['https://10.0.0.5/', 'private IP'],
    ['https://127.0.0.1:3000/', 'loopback'],
    ['https://admin:pw@example.com/', 'embedded credentials'],
    ['https://metadata.google.internal/', 'blocked hostname'],
    ['', 'empty string'],
    ['https://example.com/' + 'x'.repeat(4096), 'over-long'],
    [null, 'null'],
    [undefined, 'undefined'],
    [42, 'number'],
    [{ href: 'https://example.com' }, 'object'],
  ];
  it.each(refused)('refuses %s (%s)', (raw) => {
    expect(safeRedirectTarget(raw)).toBeNull();
  });
});

describe('readClickLinkDestination (#2218 metadata contract)', () => {
  const links = { a: 'https://a.example.com/', b: 'https://b.example.com/' };

  it('reads the URL registered under the requested link id', () => {
    expect(readClickLinkDestination({ [CLICK_LINKS_METADATA_KEY]: links }, 'b')).toBe(
      'https://b.example.com/'
    );
  });

  it('reads the only registered URL when no link id is given', () => {
    expect(readClickLinkDestination({ [CLICK_LINKS_METADATA_KEY]: { a: links.a } }, null)).toBe(links.a);
  });

  it('refuses to choose when several links exist and the request named none', () => {
    expect(readClickLinkDestination({ [CLICK_LINKS_METADATA_KEY]: links }, null)).toBeNull();
  });

  it('refuses an unknown or oddly-shaped link id instead of guessing', () => {
    const meta = { [CLICK_LINKS_METADATA_KEY]: links };
    expect(readClickLinkDestination(meta, 'nope')).toBeNull();
    expect(readClickLinkDestination(meta, '../../etc/passwd')).toBeNull();
    expect(readClickLinkDestination(meta, 'a'.repeat(65))).toBeNull();
    expect(readClickLinkDestination(meta, '__proto__')).toBeNull();
    expect(readClickLinkDestination(meta, 'constructor')).toBeNull();
  });

  it('returns null for absent or malformed metadata rather than throwing', () => {
    for (const meta of [null, undefined, {}, [], 'string', { clickLinks: null }, { clickLinks: [] }, { clickLinks: { a: 42 } }]) {
      expect(readClickLinkDestination(meta, 'a')).toBeNull();
    }
  });
});
