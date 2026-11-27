import { describe, expect, it } from 'vitest';
import { BLOCK_DEFAULTS, blocksToHtml, createBlock, type EmailBlock } from '@/components/tenant/email-builder/blocks';

function block(type: EmailBlock['type'], content: unknown): EmailBlock {
  return { id: 'b1', type, content } as unknown as EmailBlock;
}

describe('blocksToHtml output escaping (#4015)', () => {
  it('escapes heading text and rejects injected style values', () => {
    const html = blocksToHtml([block('heading', {
      ...BLOCK_DEFAULTS.heading,
      text: '</h2><script>alert(1)</script>',
      color: 'red;background:url(javascript:alert(1))',
      align: 'left;position:fixed',
    })]);
    expect(html).toContain('&lt;/h2&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('color:#1a1a1a');
    expect(html).toContain('text-align:left');
    expect(html).not.toContain('javascript:');
  });

  it('sanitizes rich text html while keeping safe markup', () => {
    const html = blocksToHtml([block('text', {
      ...BLOCK_DEFAULTS.text,
      html: '<p onclick="steal()">Hello <b>world</b><script>alert(1)</script></p>',
    })]);
    expect(html).toContain('<p>Hello <b>world</b></p>');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('<script>');
  });

  it('rejects javascript: urls in image src and href', () => {
    const html = blocksToHtml([block('image', {
      ...BLOCK_DEFAULTS.image,
      src: 'javascript:alert(1)',
      href: 'javascript:alert(2)',
    })]);
    expect(html).toContain('[Image placeholder]');
    expect(html).not.toContain('javascript:');
  });

  it('escapes quotes in image attributes and allows https urls', () => {
    const html = blocksToHtml([block('image', {
      src: 'https://cdn.example.com/a.png',
      alt: 'a" onerror="alert(1)',
      width: '100%',
      align: 'center',
      href: 'https://example.com/link',
    })]);
    expect(html).toContain('src="https://cdn.example.com/a.png"');
    expect(html).toContain('alt="a&quot; onerror=&quot;alert(1)"');
    expect(html).toContain('href="https://example.com/link"');
    expect(html).not.toContain('onerror="alert');
  });

  it('rejects dangerous button hrefs and escapes button text', () => {
    const html = blocksToHtml([block('button', {
      ...BLOCK_DEFAULTS.button,
      href: 'javascript:alert(1)',
      text: '<img src=x onerror=alert(1)>',
      bgColor: '#7c3aed;position:fixed',
      borderRadius: '8px;background:red',
    })]);
    expect(html).toContain('href="#"');
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('background:#7c3aed');
    expect(html).toContain('border-radius:8px');
  });

  it('sanitizes the raw html block', () => {
    const html = blocksToHtml([block('html', {
      html: '<div><script>alert(1)</script><a href="javascript:alert(2)">x</a><p style="color:red">ok</p></div>',
    })]);
    expect(html).toContain('<p style="color:red">ok</p>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('javascript:');
  });

  it('sanitizes nested column blocks', () => {
    const nested = block('heading', {
      ...BLOCK_DEFAULTS.heading,
      text: '<script>alert(1)</script>Nested',
    });
    const html = blocksToHtml([block('columns', {
      columns: [{ width: '100%', blocks: [nested] }],
    })]);
    expect(html).toContain('Nested');
    expect(html).not.toContain('<script>');
  });

  it('does not throw on malformed input', () => {
    expect(blocksToHtml(undefined as unknown as EmailBlock[])).toBe('');
    expect(blocksToHtml([null as unknown as EmailBlock])).toBe('');
    expect(blocksToHtml([block('columns', { columns: 'not-an-array' })])).toContain('<table');
  });

  it('still renders default blocks unchanged', () => {
    const html = blocksToHtml([
      createBlock('heading'),
      createBlock('text'),
      createBlock('button'),
    ]);
    expect(html).toContain('<h2 style=');
    expect(html).toContain('>Heading</h2>');
    expect(html).toContain('<p>Enter your text here.</p>');
    expect(html).toContain('>Click Here</a>');
  });
});
