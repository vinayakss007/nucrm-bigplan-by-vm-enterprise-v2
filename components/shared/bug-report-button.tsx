/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { Bug, X, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { clientLogError } from '@/lib/client-logger';

type Status = 'idle' | 'sending' | 'sent' | 'error';

const SEVERITIES = [
  { value: 'cosmetic', label: 'Cosmetic' },
  { value: 'minor', label: 'Minor' },
  { value: 'major', label: 'Major' },
  { value: 'blocker', label: 'Blocker' },
] as const;

export default function BugReportButton() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<string>('minor');
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [issueUrl, setIssueUrl] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const reset = useCallback(() => {
    setTitle(''); setDescription(''); setSeverity('minor');
    setStatus('idle'); setMessage(null); setIssueUrl(null);
  }, []);

  const submit = async () => {
    setStatus('sending'); setMessage(null);
    try {
      const res = await fetch('/api/bug-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description,
          severity,
          pageUrl: typeof window !== 'undefined' ? window.location.href : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus('error');
        setMessage(data.error ?? `Something went wrong (HTTP ${res.status})`);
        return;
      }
      setStatus('sent');
      setIssueUrl(typeof data.url === 'string' ? data.url : null);
    } catch (error) {
      clientLogError('bug-report:submit', error);
      setStatus('error');
      setMessage('Could not reach the server — check your connection and retry.');
    }
  };

  const tooShort = title.trim().length < 5 || description.trim().length < 10;

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => { setOpen(s => !s); if (open) reset(); }}
        type="button"
        aria-label="Report a bug"
        aria-expanded={open}
        className="min-h-11 min-w-11 flex items-center justify-center rounded-lg hover:bg-accent transition-colors text-muted-foreground"
      >
        <Bug className="w-4 h-4" aria-hidden="true" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-80 bg-card border border-border rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-muted/20">
            <p className="text-sm font-bold flex items-center gap-2"><Bug className="w-3.5 h-3.5 text-violet-600" aria-hidden="true" />Report a bug</p>
            <button type="button" aria-label="Close bug report" onClick={() => { setOpen(false); reset(); }}
              className="min-h-11 min-w-11 -mr-3 flex items-center justify-center text-muted-foreground hover:text-foreground">
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>

          {status === 'sent' ? (
            <div className="px-4 py-6 text-center">
              <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" aria-hidden="true" />
              <p className="text-sm font-semibold">Thanks — report sent!</p>
              <p className="text-xs text-muted-foreground mt-1">It went straight to the team inbox.</p>
              {issueUrl && (
                <a href={issueUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-block text-xs font-bold text-violet-600 hover:underline mt-2">
                  View your report ↗
                </a>
              )}
              <button type="button" onClick={reset}
                className="block mx-auto mt-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground">
                Report another
              </button>
            </div>
          ) : (
            <div className="p-4 space-y-3">
              <div>
                <label htmlFor="bug-title" className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-1">What&apos;s broken?</label>
                <input
                  id="bug-title" value={title} onChange={e => setTitle(e.target.value)} maxLength={200}
                  placeholder="e.g. Import button spins forever"
                  className="w-full px-3 py-2 text-sm bg-muted/40 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>

              <div>
                <label htmlFor="bug-severity" className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-1">Impact</label>
                <select
                  id="bug-severity" value={severity} onChange={e => setSeverity(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-muted/40 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
                >
                  {SEVERITIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>

              <div>
                <label htmlFor="bug-desc" className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-1">Details</label>
                <textarea
                  id="bug-desc" value={description} onChange={e => setDescription(e.target.value)} maxLength={5000} rows={4}
                  placeholder="What did you do, what happened, what did you expect?"
                  className="w-full px-3 py-2 text-sm bg-muted/40 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
                />
                <p className="text-[10px] text-muted-foreground mt-1">This page&apos;s address is attached automatically.</p>
              </div>

              {status === 'error' && message && (
                <p role="alert" className="flex items-start gap-1.5 text-xs text-red-600 font-medium">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />{message}
                </p>
              )}

              <button
                type="button"
                onClick={submit}
                disabled={tooShort || status === 'sending'}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-bold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
              >
                {status === 'sending' && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
                {status === 'sending' ? 'Sending…' : 'Send report'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
