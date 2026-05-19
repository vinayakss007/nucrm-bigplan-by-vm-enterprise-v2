/**
 * ⌘S Save Shortcut Provider
 * 
 * Wrap any form with this and ⌘S will trigger submission.
 * Usage:
 * <SaveShortcut onSave={handleSave}>
 *   <form>...</form>
 * </SaveShortcut>
 */
'use client';
import { useEffect, useCallback, useRef } from 'react';

interface Props {
  onSave: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}

export function SaveShortcut({ onSave, children, disabled }: Props) {
  const handler = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      if (!disabled) onSave();
    }
  }, [onSave, disabled]);

  useEffect(() => {
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handler]);

  return <>{children}</>;
}

/**
 * Find the nearest submit button and click it on ⌘S
 * Usage: <form onSubmit={handleSubmit} data-cmd-save />
 * The shell's global shortcut handler will find and click it
 */
export function setupCmdSSave() {
  if (typeof window === 'undefined') return;
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      // Find the nearest button[type=submit] in a form with data-cmd-save
      const btn = document.querySelector('button[type="submit"]') as HTMLButtonElement;
      btn?.click();
    }
  });
}
