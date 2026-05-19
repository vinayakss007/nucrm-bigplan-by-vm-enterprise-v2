'use client';
import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';

export default function OfflineDetector() {
  const [offline, setOffline] = useState(false);
  const [wasOffline, setWasOffline] = useState(false);

  useEffect(() => {
    const goOffline = () => { setOffline(true); setWasOffline(true); };
    const goOnline  = () => { setOffline(false); };
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    // Check initial state
    if (!navigator.onLine) goOffline();
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  if (!offline && !wasOffline) return null;

  return (
    <div
      className={`fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-2.5 px-4 py-2.5 rounded-xl shadow-lg transition-all duration-300 ${
        offline
          ? 'bg-red-600 text-white translate-y-0 opacity-100'
          : 'bg-emerald-600 text-white translate-y-0 opacity-100'
      }`}
      style={{ pointerEvents: 'none' }}
    >
      <WifiOff className="w-4 h-4" />
      <span className="text-sm font-medium">
        {offline ? 'No connection — changes will not save' : 'Connection restored'}
      </span>
    </div>
  );
}
