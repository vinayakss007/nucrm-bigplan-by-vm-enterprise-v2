'use client';

import { useEffect, useRef, useCallback } from 'react';

/**
 * Move focus to an element, with fallback to document body
 */
export function focusElement(element: HTMLElement | null) {
  if (!element) return;
  element.focus();
  element.setAttribute('tabindex', '-1');
}

/**
 * Hook to manage focus within a component
 */
export function useFocusTrap(containerRef: React.RefObject<HTMLElement | null>, enabled = true) {
  useEffect(() => {
    if (!enabled || !containerRef.current) return;

    const container = containerRef.current;
    const focusableSelectors = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(', ');

    const focusableElements = Array.from(container.querySelectorAll<HTMLElement>(focusableSelectors));
    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0]!;
    const lastElement = focusableElements[focusableElements.length - 1]!;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    container.addEventListener('keydown', handleKeyDown);
    firstElement.focus();

    return () => {
      container.removeEventListener('keydown', handleKeyDown);
    };
  }, [containerRef, enabled]);
}

/**
 * Hook to restore focus to a trigger element when a modal/dialog closes
 */
export function useFocusRestore(triggerRef: React.RefObject<HTMLElement | null>) {
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (triggerRef.current) {
      previousFocusRef.current = document.activeElement as HTMLElement;
    }
  }, [triggerRef]);

  return useCallback(() => {
    if (previousFocusRef.current) {
      previousFocusRef.current.focus();
      previousFocusRef.current = null;
    }
  }, []);
}

/**
 * Generate a unique ID for aria-labelledby/aria-describedby
 */
let idCounter = 0;
export function useId(prefix = 'a11y'): string {
  const ref = useRef<string | null>(null);
  if (ref.current === null) {
    ref.current = `${prefix}-${++idCounter}`;
  }
  return ref.current;
}

/**
 * Announce a message to screen readers via aria-live region
 */
export function useAnnounce() {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const div = document.createElement('div');
    div.setAttribute('aria-live', 'polite');
    div.setAttribute('aria-atomic', 'true');
    div.className = 'sr-only';
    document.body.appendChild(div);
    containerRef.current = div;

    return () => {
      document.body.removeChild(div);
    };
  }, []);

  const announce = useCallback((message: string) => {
    if (containerRef.current) {
      containerRef.current.textContent = '';
      requestAnimationFrame(() => {
        if (containerRef.current) {
          containerRef.current.textContent = message;
        }
      });
    }
  }, []);

  return announce;
}

/**
 * Handle Escape key press
 */
export function useEscapeKey(handler: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handler();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handler, enabled]);
}
