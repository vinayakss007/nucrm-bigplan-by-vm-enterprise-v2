'use client';
import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './dialog';
import { Button } from './button';
import { AlertTriangle } from 'lucide-react';
import { getConfirmDestructivePref } from '@/lib/client-prefs';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  message: string;
  confirmLabel?: string;
  variant?: 'danger' | 'warning' | 'default';
  onConfirm: () => void;
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
            {loading ? 'Deleting...' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import toast from 'react-hot-toast';
import { captureError } from '@/lib/capture-error';

export async function confirmThen(message: string, action: () => void | Promise<void>, riskLevel: 'always' | 'danger_only' = 'danger_only'): Promise<boolean> {
  const pref = await getConfirmDestructivePref();
  if (pref === 'never') {
    await action();
    return true;
  }
  if (pref === 'danger_only' && riskLevel === 'always') {
    await action();
    return true;
  }
  return new Promise((resolve) => {
    toast((t) => (
      <div className="flex items-center gap-3">
        <span className="text-sm">{message}</span>
        <div className="flex gap-1.5">
          <button
            onClick={() => { toast.dismiss(t.id); resolve(false); }}
            className="px-2.5 py-1 text-xs font-medium rounded-lg border border-border hover:bg-accent transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={async () => {
              toast.dismiss(t.id);
              try { await action(); } catch (e) { captureError(e, 'confirmThen'); toast.error('Action failed'); }
              resolve(true);
            }}
            className="px-2.5 py-1 text-xs font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    ), { duration: 8000 });
  });
}

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
