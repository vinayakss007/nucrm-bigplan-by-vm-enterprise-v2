'use client';
import { useState, useEffect, useCallback } from 'react';
import { getConfirmDestructivePref } from '@/lib/client-prefs';
import { confirmThen } from '@/components/ui/confirm-dialog';

export function useConfirmDestructive() {
  const [preference, setPreference] = useState<string>('always');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getConfirmDestructivePref().then(pref => {
      setPreference(pref);
      setLoaded(true);
    });
  }, []);

  const confirm = useCallback(async (
    message: string,
    action: () => void | Promise<void>,
    riskLevel: 'always' | 'danger_only' = 'danger_only'
  ): Promise<boolean> => {
    if (preference === 'never') {
      await action();
      return true;
    }
    if (preference === 'danger_only' && riskLevel === 'always') {
      await action();
      return true;
    }
    return confirmThen(message, action, riskLevel);
  }, [preference]);

  return { confirm, preference, loaded };
}
