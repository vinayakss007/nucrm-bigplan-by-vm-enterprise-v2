/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './dialog';
import { Button } from './button';

/* ------------------------------------------------------------------ */
/*  PromptDialog — native window.prompt replacement (#1114)            */
/* ------------------------------------------------------------------ */

interface PromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  message?: string;
  placeholder?: string;
  confirmLabel?: string;
  /** When provided, Apply stays disabled until the value matches (basic format gate) */
  validate?: (value: string) => boolean;
  invalidMessage?: string;
  onConfirm: (value: string) => void | Promise<void>;
}

export function PromptDialog({
  open,
  onOpenChange,
  title,
  message,
  placeholder,
  confirmLabel = 'OK',
  validate,
  invalidMessage,
  onConfirm,
}: PromptDialogProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) { setValue(''); setError(''); }
  }, [open]);

  const submit = async () => {
    if (!value.trim()) return;
    if (validate && !validate(value.trim())) {
      setError(invalidMessage || 'Invalid value');
      return;
    }
    setLoading(true);
    try {
      await onConfirm(value.trim());
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {message && <p className="text-sm text-muted-foreground">{message}</p>}
        </DialogHeader>
        <div className="space-y-2">
          <input
            type="text"
            value={value}
            onChange={(e) => { setValue(e.target.value); setError(''); }}
            placeholder={placeholder}
            autoFocus
            className="w-full px-3 py-2 border border-border rounded-lg bg-card text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!value.trim() || loading} onClick={submit}>
            {loading ? 'Working...' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
