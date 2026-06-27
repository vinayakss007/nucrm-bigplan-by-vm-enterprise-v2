'use client';
import { useState } from 'react';
import { BrainCircuit, Loader2, ThumbsUp, ThumbsDown, Minus, Send } from 'lucide-react';
import { cn } from '@/lib/utils';

type SentimentResult = {
  score: number;
  label: 'positive' | 'neutral' | 'negative';
  confidence: number;
  summary: string;
};

export default function SentimentPage() {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SentimentResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const analyze = async () => {
    if (!text.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const r = await fetch('/api/tenant/ai/sentiment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Analysis failed');
      setResult(data.data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const labelConfig = {
    positive: { icon: ThumbsUp, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-950/30', border: 'border-emerald-300' },
    neutral:  { icon: Minus,     color: 'text-amber-600',   bg: 'bg-amber-50 dark:bg-amber-950/30',   border: 'border-amber-300' },
    negative: { icon: ThumbsDown, color: 'text-red-600',    bg: 'bg-red-50 dark:bg-red-950/30',       border: 'border-red-300' },
  };

  const cfg = result ? labelConfig[result.label] : null;
  const LabelIcon = cfg?.icon ?? Minus;

  return (
    <div className="space-y-5 animate-fade-in pb-12">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <BrainCircuit className="w-5 h-5 text-violet-600" /> Sentiment Analysis
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          Analyze the sentiment of any text — email replies, meeting notes, feedback. AI scores it 0–100 and classifies as positive, neutral, or negative.
        </p>
      </div>

      {/* Input */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <label className="text-sm font-semibold">Text to analyze</label>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Paste an email reply, customer feedback, meeting notes, or any text..."
          className="w-full h-32 rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-500"
        />
        <button
          onClick={analyze}
          disabled={loading || !text.trim()}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
            loading || !text.trim()
              ? 'bg-muted text-muted-foreground cursor-not-allowed'
              : 'bg-violet-600 text-white hover:bg-violet-700',
          )}
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {loading ? 'Analyzing...' : 'Analyze Sentiment'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 dark:bg-red-950/30 p-4 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Result */}
      {result && cfg && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center gap-4">
            <div className={cn('w-16 h-16 rounded-2xl flex items-center justify-center', cfg.bg, cfg.border, 'border-2')}>
              <LabelIcon className={cn('w-7 h-7', cfg.color)} />
            </div>
            <div>
              <p className="text-2xl font-black">{result.score}<span className="text-sm font-normal text-muted-foreground">/100</span></p>
              <p className={cn('text-sm font-bold uppercase', cfg.color)}>{result.label}</p>
            </div>
            <div className="ml-auto text-right">
              <p className="text-xs text-muted-foreground">Confidence</p>
              <p className="text-lg font-bold">{result.confidence}%</p>
            </div>
          </div>

          {/* Score bar */}
          <div className="relative h-3 rounded-full bg-muted overflow-hidden">
            <div
              className={cn(
                'absolute inset-y-0 left-0 rounded-full transition-all duration-500',
                result.label === 'positive' ? 'bg-emerald-500' :
                result.label === 'negative' ? 'bg-red-500' : 'bg-amber-500',
              )}
              style={{ width: `${result.score}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>0 — Extremely Negative</span>
            <span>50 — Neutral</span>
            <span>100 — Extremely Positive</span>
          </div>

          {/* Summary */}
          {result.summary && (
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs font-semibold text-muted-foreground mb-1">Summary</p>
              <p className="text-sm">{result.summary}</p>
            </div>
          )}
        </div>
      )}

      {/* Example prompts */}
      {!result && !loading && (
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Try these examples</p>
          <div className="flex flex-wrap gap-2">
            {[
              'Thank you so much for the quick response! The demo was excellent and we\'re very interested in moving forward.',
              'We\'ve decided to go with another vendor. The pricing was too high for our budget this quarter.',
              'Got it, thanks. We\'ll review this internally and get back to you next month.',
            ].map((example, i) => (
              <button
                key={i}
                onClick={() => setText(example)}
                className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-accent transition-colors text-left max-w-xs"
              >
                {example.slice(0, 80)}...
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
