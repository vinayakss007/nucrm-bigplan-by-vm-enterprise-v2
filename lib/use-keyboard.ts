'use client';
import { useEffect } from 'react';

/**
 * ⌘S Save shortcut hook
 * Usage: useCmdSSave(() => handleSave())
 */
export function useCmdSSave(handler: () => void) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handler();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handler]);
}

/**
 * Escape handler hook
 * Usage: useEscape(() => handleClose())
 */
export function useEscape(handler: () => void) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handler();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handler]);
}

/**
 * Arrow key navigation for tables
 * Usage: useArrowNav(tableRef, items, onSelect)
 */
export function useArrowNav(
  containerRef: React.RefObject<HTMLElement | null>,
  itemCount: number,
  onSelect: (index: number) => void
) {
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;

      const focused = el.querySelector('[data-row-index]') as HTMLElement;
      const currentIdx = focused ? parseInt(focused.dataset['rowIndex'] || '-1') : -1;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = Math.min(currentIdx + 1, itemCount - 1);
        const row = el.querySelector(`[data-row-index="${next}"]`) as HTMLElement;
        row?.focus();
        row?.click();
        onSelect(next);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = Math.max(currentIdx - 1, 0);
        const row = el.querySelector(`[data-row-index="${prev}"]`) as HTMLElement;
        row?.focus();
        row?.click();
        onSelect(prev);
      } else if (e.key === 'Enter' && currentIdx >= 0) {
        e.preventDefault();
        onSelect(currentIdx);
      }
    };

    el.addEventListener('keydown', onKeyDown);
    return () => el.removeEventListener('keydown', onKeyDown);
  }, [containerRef, itemCount, onSelect]);
}
