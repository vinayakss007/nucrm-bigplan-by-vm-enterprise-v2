// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useOpenCreateParam } from '@/hooks/use-open-create-param';

// jsdom provides window.location + history. We drive the URL via history and
// assert the hook opens once and strips ?action=.

function setUrl(path: string) {
  window.history.replaceState({}, '', path);
}

describe('useOpenCreateParam', () => {
  beforeEach(() => {
    setUrl('/tenant/contacts');
  });

  it('calls the opener when ?action=create is present', () => {
    setUrl('/tenant/contacts?action=create');
    const open = vi.fn();
    renderHook(() => useOpenCreateParam(open));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('does NOT call the opener without the param', () => {
    setUrl('/tenant/contacts');
    const open = vi.fn();
    renderHook(() => useOpenCreateParam(open));
    expect(open).not.toHaveBeenCalled();
  });

  it('strips ?action= from the URL after opening (no re-trigger on rerender)', () => {
    setUrl('/tenant/deals?action=create');
    const open = vi.fn();
    const { rerender } = renderHook(() => useOpenCreateParam(open));
    expect(window.location.search).toBe('');
    expect(window.location.pathname).toBe('/tenant/deals');
    rerender();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('preserves other query params while removing action', () => {
    setUrl('/tenant/deals?view=kanban&action=create');
    const open = vi.fn();
    renderHook(() => useOpenCreateParam(open));
    expect(open).toHaveBeenCalledTimes(1);
    expect(window.location.search).toContain('view=kanban');
    expect(window.location.search).not.toContain('action=create');
  });

  it('ignores a non-matching action value', () => {
    setUrl('/tenant/contacts?action=export');
    const open = vi.fn();
    renderHook(() => useOpenCreateParam(open));
    expect(open).not.toHaveBeenCalled();
    // URL untouched when it does not match.
    expect(window.location.search).toContain('action=export');
  });

  it('supports a custom param value', () => {
    setUrl('/tenant/contacts?action=import');
    const open = vi.fn();
    renderHook(() => useOpenCreateParam(open, 'import'));
    expect(open).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe('');
  });
});
