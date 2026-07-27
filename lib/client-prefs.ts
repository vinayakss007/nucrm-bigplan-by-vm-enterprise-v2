import { logError } from '@/lib/errors-client';

let cachedPrefs: Record<string, unknown> | null = null;
let prefsPromise: Promise<Record<string, unknown> | null> | null = null;

async function fetchPrefs(): Promise<Record<string, unknown>> {
  if (cachedPrefs) return cachedPrefs;
  if (!prefsPromise) {
    prefsPromise = fetch('/api/user/preferences')
      .then(r => r.ok ? r.json() : { preferences: {} })
      .then(d => {
        cachedPrefs = d.preferences ?? {};
        return cachedPrefs;
      })
      .catch((err) => {
        // Falling back to empty prefs is the right UX (the app stays usable and
        // callers apply their own defaults), but a fetch failure here previously
        // left no trace at all, so a broken /api/user/preferences looked
        // identical to "user has configured nothing".
        logError({ error: err, context: 'client-prefs:fetchPrefs' });
        cachedPrefs = {};
        return cachedPrefs;
      });
  }
  const result = await prefsPromise;
  return result ?? {};
}

export async function getConfirmDestructivePref(): Promise<string> {
  const prefs = await fetchPrefs();
  const val = prefs.confirm_destructive;
  if (val === 'never' || val === 'danger_only') return val as string;
  return 'always';
}

export function clearPrefsCache(): void {
  cachedPrefs = null;
  prefsPromise = null;
}

export async function getPref(key: string): Promise<unknown> {
  const prefs = await fetchPrefs();
  return prefs[key];
}
