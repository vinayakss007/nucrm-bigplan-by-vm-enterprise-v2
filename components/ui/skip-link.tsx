'use client';

import { useState, useEffect } from 'react';

/**
 * Skip Navigation Link
 * Appears on focus to allow keyboard users to skip to main content
 */
export function SkipLink({ targetId = 'main-content' }: { targetId?: string }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        setVisible(true);
      }
    };

    const handleClick = () => setVisible(false);

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('click', handleClick);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('click', handleClick);
    };
  }, []);

  return (
    <a
      href={`#${targetId}`}
      className={`fixed top-4 left-4 z-[9999] px-4 py-2 bg-violet-600 text-white font-medium rounded-lg shadow-lg transition-all duration-200 ${
        visible ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0'
      } focus:translate-y-0 focus:opacity-100`}
    >
      Skip to main content
    </a>
  );
}
