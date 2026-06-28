'use client';
import { useEffect, useState } from 'react';
import {
  Heart, Loader2, Mail, MessageSquare, Phone, ArrowRight,
  ThumbsUp, Clock, CheckCircle2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type WarmingStats = {
  campaigns: { total: number; active: number };
  messages: { total: number; sent: number; queued: number; failed: number; emailCount: number; whatsappCount: number };
  replies: { total: number; interested: number; notInterested: number; askLater: number; question: number; positiveSocial: number; unsubscribe: number; replyRate: number; positiveRate: number };
};

type Reply = {
  id: string;
  channel: string;
  replyContent: string;
  receivedAt: string;
  intent: string;
  intentConfidence: number;
  sentiment: string;
  sentimentScore: number;
  aiSummary: string;
  aiSuggestedAction: string;
  requiresFollowUp: boolean;
  contactName: string;
};

const INTENT_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  interested:       { label: 'Interested',      color: 'text-emerald-700', bg: 'bg-emerald-50 dark:bg-emerald-950/30' },
  not_interested:   { label: 'Not Interested',  color: 'text-red-700',     bg: 'bg-red-50 dark:bg-red-950/30' },
  ask_later:        { label: 'Ask Later',       color: 'text-amber-700',   bg: 'bg-amber-50 dark:bg-amber-950/30' },
  question:         { label: 'Question',        color: 'text-blue-700',    bg: 'bg-blue-50 dark:bg-blue-950/30' },
  complaint:        { label: 'Complaint',       color: 'text-red-700',     bg: 'bg-red-50 dark:bg-red-950/30' },
  out_of_office:    { label: 'Out of Office',   color: 'text-slate-700',   bg: 'bg-slate-50 dark:bg-slate-950/30' },
  unsubscribe:      { label: 'Unsubscribe',     color: 'text-red-700',     bg: 'bg-red-50 dark:bg-red-950/30' },
  positive_social:  { label: 'Social',          color: 'text-violet-700',  bg: 'bg-violet-50 dark:bg-violet-950/30' },
  unknown:          { label: 'Unknown',         color: 'text-gray-700',    bg: 'bg-gray-50 dark:bg-gray-950/30' },
};

const CHANNEL_ICONS: Record<string, typeof Mail> = { email: Mail, whatsapp: MessageSquare, sms: Phone };

export default function LeadWarmingPage() {
  const [stats, setStats] = useState<WarmingStats | null>(null);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    Promise.all([
      fetch('/api/tenant/lead-warming/stats').then(r => r.ok ? r.json() : null),
      fetch('/api/tenant/lead-warming/replies?limit=50').then(r => r.ok ? r.json() : null),
    ]).then(([statsData, repliesData]) => {
      if (statsData) setStats(statsData);
      if (repliesData?.data) setReplies(repliesData.data);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const filtered = filter === 'all' ? replies : replies.filter(r => r.intent === filter);
  const intentCounts = replies.reduce((acc, r) => { acc[r.intent] = (acc[r.intent] || 0) + 1; return acc; }, {} as Record<string, number>);

  if (loading) {
    return <div className="flex items-center justify-center h-48"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-5 animate-fade-in pb-12">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Heart className="w-5 h-5 text-rose-600" /> Lead Warming
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          AI-powered reply analysis and personalized festival/birthday messages. Classifies intent, extracts entities, and suggests next actions.
        </p>
      </div>

      {/* Stats grid */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2">
          <StatCard icon={Mail} label="Messages (30d)" value={stats.messages.sent} />
          <StatCard icon={MessageSquare} label="Replies" value={stats.replies.total} />
          <StatCard icon={ThumbsUp} label="Interested" value={stats.replies.interested} accent="emerald" />
          <StatCard icon={Clock} label="Ask Later" value={stats.replies.askLater} accent="amber" />
          <StatCard icon={CheckCircle2} label="Reply Rate" value={`${stats.replies.replyRate}%`} />
          <StatCard icon={Heart} label="Positive Rate" value={`${stats.replies.positiveRate}%`} accent="emerald" />
        </div>
      )}

      {/* Intent filter pills */}
      <div className="flex flex-wrap gap-1.5">
        <FilterPill label="All" count={replies.length} active={filter === 'all'} onClick={() => setFilter('all')} />
        {Object.entries(intentCounts).sort((a, b) => b[1] - a[1]).map(([intent, count]) => {
          const cfg = INTENT_CONFIG[intent] ?? INTENT_CONFIG.unknown;
          return (
            <FilterPill
              key={intent}
              label={cfg.label}
              count={count}
              active={filter === intent}
              onClick={() => setFilter(intent)}
            />
          );
        })}
      </div>

      {/* Replies list */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground text-sm">
            No replies found. Lead warming replies will appear here once campaigns start receiving responses.
          </div>
        ) : (
          filtered.map(reply => {
            const intentCfg = INTENT_CONFIG[reply.intent] ?? INTENT_CONFIG.unknown;
            const ChannelIcon = CHANNEL_ICONS[reply.channel] ?? Mail;
            return (
              <div key={reply.id} className="rounded-xl border border-border bg-card p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <ChannelIcon className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="text-sm font-semibold truncate">{reply.contactName}</span>
                    <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-bold uppercase', intentCfg.bg, intentCfg.color)}>
                      {intentCfg.label}
                    </span>
                    {reply.requiresFollowUp && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-bold">Follow-up</span>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {new Date(reply.receivedAt).toLocaleDateString()}
                  </span>
                </div>

                <p className="text-xs text-muted-foreground line-clamp-2">{reply.replyContent}</p>

                {reply.aiSummary && (
                  <div className="rounded-lg bg-muted/50 px-3 py-2">
                    <p className="text-xs"><span className="font-semibold">AI:</span> {reply.aiSummary}</p>
                  </div>
                )}

                {reply.aiSuggestedAction && (
                  <div className="flex items-center gap-1.5 text-xs text-violet-600">
                    <ArrowRight className="w-3 h-3" />
                    <span>{reply.aiSuggestedAction}</span>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, accent }: { icon: typeof Mail; label: string; value: number | string; accent?: 'emerald' | 'amber' }) {
  return (
    <div className={cn(
      'rounded-xl border-2 p-3 shadow-sm',
      accent === 'emerald' ? 'border-emerald-300/80 bg-emerald-50/40 dark:bg-emerald-950/20' :
      accent === 'amber' ? 'border-amber-300/80 bg-amber-50/40 dark:bg-amber-950/20' :
      'border-border/80 bg-card',
    )}>
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/80">
        <Icon className="w-3 h-3" /> <span className="truncate">{label}</span>
      </div>
      <p className="text-2xl font-black tabular-nums mt-1">{value}</p>
    </div>
  );
}

function FilterPill({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors',
        active
          ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300'
          : 'border-border text-muted-foreground hover:bg-accent',
      )}
    >
      {label}
      <span className="text-[10px] opacity-60">{count}</span>
    </button>
  );
}
