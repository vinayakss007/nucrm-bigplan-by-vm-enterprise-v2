/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState } from 'react';
import { useParams } from 'next/navigation';
import { Check, MessageSquare } from 'lucide-react';
import { useApiQuery } from '@/lib/query/client';
import InlineErrorState from '@/components/shared/inline-error-state';

export default function CSATResponsePage() {
  const params = useParams();
  const token = params['token'] as string;
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { data, isLoading, error: readError, refetch } = useApiQuery<{ data?: { respondedAt?: string }; error?: string }>(
    ['csat', token],
    `/api/public/csat/${token}`,
    { enabled: !!token, retry: false },
  );
  const loading = isLoading;

  // #2872: every outcome of this read used to be funnelled into one local string and printed as a
  // verdict on the link — including the 400 `app/api/public/csat/[token]/route.ts:52` returns for
  // a survey this person already answered and the 429 its own view throttle at `:30` raises before
  // it looks anything up. The states are derived from the record and the status now, and the local
  // `error` is left to the write it always described.
  const failed = !data && !loading;
  const stale = Boolean(readError) && Boolean(data);
  const reason = readError?.message || 'no response from the server';
  const status = readError?.status ?? null;
  const isNotFound = failed && status === 404;
  const isResponded = failed && status === 400;
  // The same two answers can also arrive as a 2xx: the row saying it was answered, or the body
  // carrying its own refusal.
  const answeredInBody = Boolean(data?.data?.respondedAt);
  const bodyRefusal = typeof data?.error === 'string' && data.error ? data.error : null;

  const emojis = ['😞', '😕', '😐', '😊', '😄'];
  const labels = ['Very Poor', 'Poor', 'Average', 'Good', 'Excellent'];

  const submit = async () => {
    if (!score) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/public/csat/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score, comment: comment || undefined }),
      });
      const d = await res.json();
      if (res.ok) setSubmitted(true);
      else setError(d.error || 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-violet-50 to-blue-50 dark:from-violet-950/20 dark:to-blue-950/20">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // Two verdicts. The route answered both of these questions, so neither gets an alert and neither
  // gets a retry: asking again cannot un-answer a survey or match a token to a row it does not match.
  if (isResponded || answeredInBody) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-violet-50 to-blue-50 dark:from-violet-950/20 dark:to-blue-950/20">
        <div className="bg-card rounded-2xl border border-border p-8 max-w-md w-full text-center">
          <p className="text-muted-foreground">You have already responded to this survey</p>
        </div>
      </div>
    );
  }

  if (isNotFound || bodyRefusal) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-violet-50 to-blue-50 dark:from-violet-950/20 dark:to-blue-950/20">
        <div className="bg-card rounded-2xl border border-border p-8 max-w-md w-full text-center">
          <p className="text-muted-foreground">{bodyRefusal ?? 'Survey not found'}</p>
        </div>
      </div>
    );
  }

  // Anything else is this visit failing to ask the question, which says nothing about the link.
  // No faces, no comment box, no submit: nobody spends a rating on a survey this session could not
  // read, and this visitor has no other way to ask.
  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-violet-50 to-blue-50 dark:from-violet-950/20 dark:to-blue-950/20 p-4">
        <div className="max-w-md w-full space-y-3">
          <div className="w-12 h-12 rounded-xl bg-violet-100 dark:bg-violet-950/40 flex items-center justify-center mx-auto">
            <MessageSquare className="w-6 h-6 text-violet-600" />
          </div>
          <h1 className="text-lg font-bold text-center">This survey is not on your screen yet</h1>
          <InlineErrorState
            message={`This survey could not be read: ${reason}. Whether it was still open for you is unanswered, and none of that is a verdict on your link.`}
            onRetry={refetch}
          />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-violet-50 to-blue-50 dark:from-violet-950/20 dark:to-blue-950/20">
        <div className="bg-card rounded-2xl border border-border p-8 max-w-md w-full text-center">
          <p className="text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-violet-50 to-blue-50 dark:from-violet-950/20 dark:to-blue-950/20">
        <div className="bg-card rounded-2xl border border-border p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-950/40 flex items-center justify-center mx-auto mb-4">
            <Check className="w-8 h-8 text-emerald-600" />
          </div>
          <h2 className="text-xl font-bold mb-2">Thank you!</h2>
          <p className="text-muted-foreground">Your feedback has been recorded. It helps us improve our support quality.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-violet-50 to-blue-50 dark:from-violet-950/20 dark:to-blue-950/20 p-4">
      <div className="bg-card rounded-2xl border border-border p-8 max-w-md w-full">
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-violet-100 dark:bg-violet-950/40 flex items-center justify-center mx-auto mb-3">
            <MessageSquare className="w-6 h-6 text-violet-600" />
          </div>
          <h1 className="text-xl font-bold">How was your experience?</h1>
          <p className="text-sm text-muted-foreground mt-1">Your feedback helps us improve</p>
        </div>

        {stale && (
          <InlineErrorState
            message={`Could not refresh, so whether this survey was still open comes from the last read: ${reason}. The faces below are still yours to click and your answer still posts — it is only the confirmation that nobody has answered yet that may be behind.`}
            onRetry={refetch}
          />
        )}

        <div className="flex justify-center gap-2 mb-6">
          {emojis.map((emoji, i) => (
            <button
              key={i}
              onClick={() => setScore(i + 1)}
              className={`text-4xl p-2 rounded-xl transition-all ${
                score === i + 1
                  ? 'bg-violet-100 dark:bg-violet-950/40 scale-110'
                  : 'hover:bg-muted'
              }`}
              title={labels[i]}
            >
              {emoji}
            </button>
          ))}
        </div>
        {score && (
          <p className="text-center text-sm font-medium text-muted-foreground mb-4">{labels[score - 1]}</p>
        )}

        <div className="mb-6">
          <label className="block text-sm font-medium text-muted-foreground mb-1">Optional comment</label>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="Tell us more about your experience..."
            rows={3}
            className="w-full px-3 py-2 rounded-lg border border-border bg-transparent text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
          />
        </div>

        <button
          onClick={submit}
          disabled={!score || submitting}
          className="w-full py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? 'Submitting...' : 'Submit Feedback'}
        </button>
      </div>
    </div>
  );
}
