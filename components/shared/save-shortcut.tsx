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
import { useEffect, useCallback } from 'react';

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
 * 
 * FIXED: Returns a cleanup function to remove the listener,
 * preventing memory leaks from repeated calls.
 */
let _cmdSHandler: ((e: KeyboardEvent) => void) | null = null;

export function setupCmdSSave(): () => void {
  if (typeof window === 'undefined') return () => {};

  // Remove previous listener to prevent duplicates
  if (_cmdSHandler) {
    window.removeEventListener('keydown', _cmdSHandler);
  }

  _cmdSHandler = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      const btn = document.querySelector('button[type="submit"]') as HTMLButtonElement;
      btn?.click();
    }
  };

  window.addEventListener('keydown', _cmdSHandler);

  // Return cleanup function
  return () => {
    if (_cmdSHandler) {
      window.removeEventListener('keydown', _cmdSHandler);
      _cmdSHandler = null;
    }
  };
}
