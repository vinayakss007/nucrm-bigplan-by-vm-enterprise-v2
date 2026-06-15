'use client';
import { useEffect, useState, createContext, useContext, useCallback } from 'react';
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

export function ConfirmPolyfill({ children }: { children: React.ReactNode }) {
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

  // Override window.confirm so all existing confirm() calls show our modal
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const original = window.confirm;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).confirm = (msg: string) => {
      confirm(msg);
      return true; // Prevent native — modal handles it
    };
    return () => { window.confirm = original; };
  }, [confirm]);

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
