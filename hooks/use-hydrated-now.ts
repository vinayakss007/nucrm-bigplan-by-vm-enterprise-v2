'use client';

import { useEffect, useState } from 'react';

export function useHydratedNow(): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
  }, []);

  return now;
}
