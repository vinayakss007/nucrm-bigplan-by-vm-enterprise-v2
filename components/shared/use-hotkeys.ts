/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Global keyboard shortcuts (#1119).
 *
 *  ⌘K / Ctrl+K   — open command palette
 *  ?             — toggle shortcut help dialog
 *  /             — focus search ([data-search] input, if visible)
 *  g c           — go to Contacts        g d — go to Dashboard
 *  g m/p/t/f/s   — Companies / Deals / Tasks / Follow-ups / Settings
 *  n c/d/m/t/e   — new Contact / Deal / Company / Task / Event
 *
 * Mount ONCE in the tenant layout shell.
 */

interface HotkeysOptions {
  onOpenCommandPalette: () => void;
  onToggleShortcutsDialog: () => void;
}

const GO_ROUTES: Record<string, string> = {
  'g d': '/tenant/dashboard',
  'g c': '/tenant/contacts',
  'g m': '/tenant/companies',
  'g p': '/tenant/deals',
  'g t': '/tenant/tasks',
  'g f': '/tenant/follow-ups/missed',
  'g s': '/tenant/settings/general',
};

const NEW_ROUTES: Record<string, string> = {
  'n c': '/tenant/contacts?action=create',
  'n d': '/tenant/deals?action=create',
  'n m': '/tenant/companies?action=create',
  'n t': '/tenant/tasks?action=create',
  'n e': '/tenant/calendar?action=create',
};

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

export function useHotkeys({ onOpenCommandPalette, onToggleShortcutsDialog }: HotkeysOptions) {
  const router = useRouter();
  // Latest-callback refs so the key listener never needs to re-bind
  const openPaletteRef = useRef(onOpenCommandPalette);
  const toggleShortcutsRef = useRef(onToggleShortcutsDialog);
  openPaletteRef.current = onOpenCommandPalette;
  toggleShortcutsRef.current = onToggleShortcutsDialog;

  useEffect(() => {
    let keySequence: string[] = [];
    let sequenceTimer: ReturnType<typeof setTimeout> | null = null;

    const resetSequence = () => {
      keySequence = [];
      if (sequenceTimer) clearTimeout(sequenceTimer);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // ⌘K / Ctrl+K — Command Palette (works even while typing)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openPaletteRef.current();
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // ? — toggle shortcuts help dialog
      if (e.key === '?') {
        if (!isTypingTarget(e.target)) {
          e.preventDefault();
          toggleShortcutsRef.current();
        }
        return;
      }

      if (isTypingTarget(e.target)) return;

      // / — focus visible search input
      if (e.key === '/') {
        e.preventDefault();
        const candidates = document.querySelectorAll<HTMLInputElement>(
          '[data-search]:not([disabled]), [data-testid="search-input"], input[aria-label*="Search" i]'
        );
        for (const el of Array.from(candidates)) {
          const rect = el.getBoundingClientRect();
          const visible = rect.width > 0 && rect.height > 0 &&
            window.getComputedStyle(el).visibility !== 'hidden' &&
            window.getComputedStyle(el).display !== 'none';
          if (visible) { el.focus(); return; }
        }
        return;
      }

      // Start a "g" or "n" sequence
      if (e.key === 'g' || e.key === 'n') {
        e.preventDefault();
        keySequence = [e.key];
        if (sequenceTimer) clearTimeout(sequenceTimer);
        sequenceTimer = setTimeout(resetSequence, 1000);
        return;
      }

      // Complete a two-key sequence
      if (keySequence.length > 0 && e.key.length === 1) {
        const sequence = `${keySequence[0]} ${e.key.toLowerCase()}`;
        const destination = GO_ROUTES[sequence] ?? NEW_ROUTES[sequence];
        if (destination) {
          e.preventDefault();
          resetSequence();
          router.push(destination);
        } else {
          resetSequence();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (sequenceTimer) clearTimeout(sequenceTimer);
    };
  }, [router]);
}
