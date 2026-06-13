'use client';
import { useEffect } from 'react';

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      const handler = () => {
        navigator.serviceWorker.register('/sw.js', { scope: '/' })
          .then(reg => {
            console.log('[PWA] SW registered:', reg.scope);
          })
          .catch(err => {
            console.error('[PWA] SW registration failed:', err);
          });
      };
      window.addEventListener('load', handler);
      return () => window.removeEventListener('load', handler);
    }
  }, []);

  return null;
}
