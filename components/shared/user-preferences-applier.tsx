'use client';
/**
 * UserPreferencesApplier
 * On mount: fetch /api/user/preferences and apply font_size, ui_density,
 * accent_color, reduce_motion, high_contrast as data-* attributes on <html>.
 * Listens for window event "nucrm:prefs-changed" so the Preferences page can
 * trigger a refresh without a full reload.
 */
import { useEffect } from 'react';

const KEYS = ['font_size', 'ui_density', 'accent_color', 'reduce_motion', 'high_contrast', 'sidebar_default'] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyToHtml(prefs: any) {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;

  if (prefs.font_size)     html.setAttribute('data-font-size', String(prefs.font_size));
  if (prefs.ui_density)    html.setAttribute('data-density',   String(prefs.ui_density));
  if (prefs.accent_color)  html.setAttribute('data-accent',    String(prefs.accent_color));

  // Boolean prefs always written so toggling off clears them
  html.setAttribute('data-reduce-motion', prefs.reduce_motion === true ? 'true' : 'false');
  html.setAttribute('data-high-contrast', prefs.high_contrast === true ? 'true' : 'false');

  // Sidebar default — applied ONCE per session if user hasn't manually toggled
  try {
    if (prefs.sidebar_default && !sessionStorage.getItem('nucrm.sidebar.touched')) {
      const wantCollapsed = prefs.sidebar_default === 'collapsed';
      localStorage.setItem('sidebar_collapsed', String(wantCollapsed));
    }
  } catch { /* Fallback to default on corrupted storage data */ }
}

async function fetchAndApply() {
  try {
    const res = await fetch('/api/user/preferences', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    applyToHtml(data.preferences ?? {});
    // Cache a tiny copy so reload feels instant before the next fetch
    try { sessionStorage.setItem('nucrm.prefs.cache', JSON.stringify(data.preferences ?? {})); } catch { /* Fallback to default on corrupted storage data */ }
  } catch { /* Fallback to default on corrupted storage data */ }
}

export default function UserPreferencesApplier() {
  useEffect(() => {
    // Apply cached prefs immediately to avoid a flash
    try {
      const cached = sessionStorage.getItem('nucrm.prefs.cache');
      if (cached) applyToHtml(JSON.parse(cached));
    } catch { /* Fallback to default on corrupted storage data */ }

    fetchAndApply();

    const handler = () => fetchAndApply();
    window.addEventListener('nucrm:prefs-changed', handler);
    return () => window.removeEventListener('nucrm:prefs-changed', handler);
  }, []);

  return null;
}
