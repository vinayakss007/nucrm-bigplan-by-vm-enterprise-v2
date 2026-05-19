'use client';
import { useState } from 'react';
import { Mail, X, CheckCircle, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

export default function EmailVerifyBanner({ email }: { email: string }) {
  const [dismissed, setDismissed] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  if (dismissed) return null;

  const resend = async () => {
    setSending(true);
    const res = await fetch('/api/auth/resend-verification', { method: 'POST' });
    const data = await res.json();
    if (res.ok) { setSent(true); toast.success('Verification email sent!'); }
    else toast.error(data.error || 'Could not send');
    setSending(false);
  };

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-amber-50 dark:bg-amber-950/20 border-b border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 shrink-0">
      <Mail className="w-4 h-4 shrink-0" />
      <p className="flex-1 text-xs font-medium">
        Please verify your email address <span className="font-bold">{email}</span> to keep your account secure.
      </p>
      {sent ? (
        <span className="text-xs font-semibold text-emerald-600 flex items-center gap-1 shrink-0">
          <CheckCircle className="w-3.5 h-3.5" />Sent!
        </span>
      ) : (
        <button onClick={resend} disabled={sending}
          className="text-xs font-semibold underline shrink-0 hover:opacity-70 disabled:opacity-50 flex items-center gap-1">
          {sending && <Loader2 className="w-3 h-3 animate-spin" />}
          {sending ? 'Sending...' : 'Resend email'}
        </button>
      )}
      <button onClick={() => setDismissed(true)} className="shrink-0 opacity-60 hover:opacity-100">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
