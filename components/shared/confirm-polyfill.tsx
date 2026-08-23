/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState, createContext, useContext, useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';

interface ConfirmState {
  message: string;
  resolve: (value: boolean) => void;
}

const Ctx = createContext<{ confirm: (msg: string) => Promise<boolean> }>({
  confirm: () => Promise.resolve(false),
});

export function useAppConfirm() {
  return useContext(Ctx).confirm;
}

export function ConfirmPolyfill({ children }: { children?: React.ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null);

  const confirm = useCallback((message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({ message, resolve });
    });
  }, []);

  const handle = (value: boolean) => {
    state?.resolve(value);
    setState(null);
  };

  // NOTE: We intentionally do NOT override window.confirm here.
  // window.confirm is synchronous by browser spec, so replacing it with
  // an async Promise-based modal causes it to always return true (the
  // bug reported in #1235). Code should use useAppConfirm() or
  // confirmThen() for async confirmation instead.

  return (
    <Ctx.Provider value={{ confirm }}>
      {children}
      {state && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/40" onClick={() => handle(false)} />
          <div className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm animate-scale-in p-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/20 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="font-semibold text-sm text-foreground">Confirm Action</h3>
                <p className="text-sm text-muted-foreground mt-1">{state.message}</p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => handle(false)}
                className="px-4 py-2 rounded-xl border border-border text-sm font-medium hover:bg-accent transition-colors">
                Cancel
              </button>
              <button onClick={() => handle(true)}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors">
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
