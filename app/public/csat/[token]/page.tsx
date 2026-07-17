'use client';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Check, MessageSquare } from 'lucide-react';

export default function CSATResponsePage() {
  const params = useParams();
  const token = params['token'] as string;
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch(`/api/public/csat/${token}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error);
        else if (d.data?.respondedAt) setError('You have already responded to this survey');
      })
      .catch(() => setError('Invalid survey link'))
      .finally(() => setLoading(false));
  }, [token]);

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
