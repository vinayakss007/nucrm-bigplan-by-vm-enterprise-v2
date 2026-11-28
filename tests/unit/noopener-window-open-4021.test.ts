import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openExternalUrl } from '@/lib/sanitize';

const ROOT = join(import.meta.dirname!, '../..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

describe('openExternalUrl opener isolation (#4021)', () => {
  const openMock = vi.fn();

  afterEach(() => {
    openMock.mockClear();
    vi.unstubAllGlobals();
  });

  it('passes noopener,noreferrer when opening an https url', () => {
    vi.stubGlobal('window', { open: openMock });
    openExternalUrl('https://example.com/download');
    expect(openMock).toHaveBeenCalledWith('https://example.com/download', '_blank', 'noopener,noreferrer');
  });

  it('refuses to open non-http(s) urls', () => {
    vi.stubGlobal('window', { open: openMock });
    openExternalUrl('javascript:alert(1)');
    expect(openMock).not.toHaveBeenCalled();
  });

  it('the two flagged call sites use the safe helper', () => {
    const documents = read('components/documents/documents-panel.tsx');
    const billing = read('app/tenant/settings/billing/subscription/page.tsx');
    for (const source of [documents, billing]) {
      expect(source).toContain("openExternalUrl(");
      expect(source).not.toMatch(/window\.open\([^,]+,\s*'_blank'\)/);
    }
  });
});
