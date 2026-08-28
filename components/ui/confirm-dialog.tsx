/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './dialog';
import { Button } from './button';
import { AlertTriangle } from 'lucide-react';
import { getConfirmDestructivePref } from '@/lib/client-prefs';
import toast from 'react-hot-toast';
import { captureError } from '@/lib/capture-error';

/* ------------------------------------------------------------------ */
/*  ConfirmDialog — declarative Radix Dialog (use inside JSX)         */
/* ------------------------------------------------------------------ */

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  message: string;
  confirmLabel?: string;
  variant?: 'danger' | 'warning' | 'default';
  onConfirm: () => void | Promise<void>;
  skip?: boolean;
}

export function ConfirmDialog({ open, onOpenChange, title, message, confirmLabel = 'Delete', variant = 'danger', onConfirm, skip }: ConfirmDialogProps) {
  const [loading, setLoading] = useState(false);
  const [shouldSkip, setShouldSkip] = useState(false);

  useEffect(() => {
    if (skip !== undefined) {
      setShouldSkip(skip);
    } else if (open) {
      getConfirmDestructivePref().then(pref => {
        setShouldSkip(pref === 'never');
      });
    }
  }, [open, skip]);

  useEffect(() => {
    if (open && shouldSkip) {
      onConfirm();
      onOpenChange(false);
    }
  }, [open, shouldSkip, onConfirm, onOpenChange]);

  if (shouldSkip) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/20 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <DialogTitle>{title}</DialogTitle>
              <p className="text-sm text-muted-foreground mt-1">{message}</p>
            </div>
          </div>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant={variant === 'danger' ? 'destructive' : 'default'}
            disabled={loading}
            onClick={async () => {
              setLoading(true);
              try { await onConfirm(); } finally { setLoading(false); onOpenChange(false); }
            }}
          >
            {loading ? 'Processing...' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/*  ConfirmWithInput — Radix Dialog with typed confirmation           */
/* ------------------------------------------------------------------ */

interface ConfirmWithInputProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  message: string;
  confirmLabel?: string;
  confirmText: string;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmWithInput({ open, onOpenChange, title, message, confirmLabel = 'Delete', confirmText, onConfirm }: ConfirmWithInputProps) {
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState('');
  const disabled = input !== confirmText;

  useEffect(() => {
    if (open) { setInput(''); }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/20 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <DialogTitle>{title}</DialogTitle>
              <p className="text-sm text-muted-foreground mt-1">{message}</p>
            </div>
          </div>
        </DialogHeader>
        <div className="space-y-2">
          <label className="text-sm font-medium">Type <span className="font-mono text-red-600">{confirmText}</span> to confirm</label>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm font-mono"
            placeholder={confirmText}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !disabled) {
                e.preventDefault();
                setLoading(true);
                Promise.resolve(onConfirm()).finally(() => { setLoading(false); onOpenChange(false); });
              }
            }}
          />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="destructive"
            disabled={disabled || loading}
            onClick={async () => {
              setLoading(true);
              try { await onConfirm(); } finally { setLoading(false); onOpenChange(false); }
            }}
          >
            {loading ? 'Processing...' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/*  confirmThen — imperative confirmation via styled DOM overlay      */
/*  Returns true if confirmed, false if cancelled.                    */
/*  Respects user's confirm_destructive preference.                   */
/* ------------------------------------------------------------------ */

let activeOverlay: HTMLDivElement | null = null;

function removeOverlay() {
  if (activeOverlay) {
    activeOverlay.remove();
    activeOverlay = null;
  }
}

export async function confirmThen(
  message: string,
  action: () => void | Promise<void>,
  riskLevel: 'always' | 'danger_only' = 'danger_only',
  confirmLabel = 'Delete'
): Promise<boolean> {
  const pref = await getConfirmDestructivePref();
  if (pref === 'never') {
    await action();
    return true;
  }
  if (pref === 'danger_only' && riskLevel === 'always') {
    await action();
    return true;
  }

  removeOverlay();

  return new Promise<boolean>((resolve) => {
    const overlay = document.createElement('div');
    overlay.id = 'confirm-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:1rem';
    activeOverlay = overlay;

    const backdrop = document.createElement('div');
    backdrop.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.6)';
    backdrop.dataset.role = 'backdrop';

    const card = document.createElement('div');
    card.style.cssText = 'position:relative;background:hsl(var(--card));border:1px solid hsl(var(--border));border-radius:1rem;box-shadow:0 25px 50px -12px rgba(0,0,0,0.25);max-width:400px;width:100%;padding:1.5rem;z-index:1';

    // #1303: build the card with a STATIC innerHTML template (no user input)
    // and inject the dynamic `message` / `confirmLabel` via textContent. The
    // previous approach interpolated hand-escaped strings into innerHTML, which
    // only escaped & < > (not quotes) and is a fragile XSS surface. textContent
    // cannot inject markup, removing the injection risk entirely.
    card.innerHTML = `
      <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:1rem">
        <div style="width:2.5rem;height:2.5rem;border-radius:9999px;background:hsl(var(--destructive)/0.1);display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="hsl(var(--destructive))" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
        </div>
        <div>
          <h2 style="font-weight:700;font-size:1rem;margin:0;color:hsl(var(--foreground))">Confirm Action</h2>
          <p data-role="message" style="font-size:0.875rem;color:hsl(var(--muted-foreground));margin:0.25rem 0 0;line-height:1.5"></p>
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:0.5rem">
        <button data-action="cancel" style="padding:0.5rem 1rem;font-size:0.875rem;font-weight:500;border-radius:0.5rem;border:1px solid hsl(var(--border));background:transparent;cursor:pointer;color:hsl(var(--foreground))">Cancel</button>
        <button data-action="confirm" style="padding:0.5rem 1rem;font-size:0.875rem;font-weight:500;border-radius:0.5rem;border:none;background:hsl(var(--destructive));color:hsl(var(--destructive-foreground));cursor:pointer"></button>
      </div>
    `;

    // Inject user-controlled text safely (no markup can be interpreted).
    const messageEl = card.querySelector('[data-role="message"]');
    if (messageEl) messageEl.textContent = message;
    const confirmBtn = card.querySelector('[data-action="confirm"]');
    if (confirmBtn) confirmBtn.textContent = confirmLabel;

    overlay.appendChild(backdrop);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    let handled = false;
    const cleanup = () => { handled = true; removeOverlay(); };
    const doCancel = () => { if (!handled) { cleanup(); resolve(false); } };
    const doConfirm = async () => {
      if (handled) return;
      cleanup();
      try { await action(); } catch (e) { captureError(e, 'confirmThen'); toast.error('Action failed'); }
      resolve(true);
    };

    backdrop.addEventListener('click', doCancel);
    card.querySelector('[data-action="cancel"]')?.addEventListener('click', doCancel);
    card.querySelector('[data-action="confirm"]')?.addEventListener('click', doConfirm);

    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { doCancel(); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);
  });
}

/* ------------------------------------------------------------------ */
/*  toastWithUndo — inline undo toast                                 */
/* ------------------------------------------------------------------ */

export function toastWithUndo(message: string, undoAction: () => void, duration = 5000) {
  const toastId = toast(
    (t) => (
      <div className="flex items-center gap-3">
        <span className="text-sm">{message}</span>
        <button
          onClick={() => { toast.dismiss(t.id); undoAction(); }}
          className="px-2.5 py-1 text-xs font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-700 transition-colors shrink-0"
        >
          Undo
        </button>
      </div>
    ),
    { duration }
  );
  return toastId;
}
