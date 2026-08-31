/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiQuery } from '@/lib/query/client';
import {
  Heart, Loader2, Mail, MessageSquare, Phone, ArrowRight,
  ThumbsUp, Clock, CheckCircle2, Plus, Pause, Play, Archive, Trash2, FileText,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { CampaignBuilder } from '@/components/lead-warming/campaign-builder';

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

type Campaign = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  enableEmail: boolean;
  enableWhatsapp: boolean;
  enableSms: boolean;
  aiGenerateMessages: boolean;
  aiTone: string;
  totalSent: number;
  totalReplies: number;
  totalPositiveIntent: number;
  createdAt: string;
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: typeof Play }> = {
  active:   { label: 'Active',   color: 'text-emerald-700', bg: 'bg-emerald-50 dark:bg-emerald-950/30', icon: Play },
  paused:   { label: 'Paused',   color: 'text-amber-700',   bg: 'bg-amber-50 dark:bg-amber-950/30',     icon: Pause },
  draft:    { label: 'Draft',    color: 'text-slate-700',   bg: 'bg-slate-50 dark:bg-slate-950/30',     icon: FileText },
  archived: { label: 'Archived', color: 'text-gray-700 dark:text-gray-300',    bg: 'bg-gray-50 dark:bg-gray-950/30',       icon: Archive },
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
  unknown:          { label: 'Unknown',         color: 'text-gray-700 dark:text-gray-300',    bg: 'bg-gray-50 dark:bg-gray-950/30' },
};

const CHANNEL_ICONS: Record<string, typeof Mail> = { email: Mail, whatsapp: MessageSquare, sms: Phone };

type Tab = 'campaigns' | 'replies';

export default function LeadWarmingPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState('all');
  const [tab, setTab] = useState<Tab>('campaigns');
  const [showBuilder, setShowBuilder] = useState(false);

  // #1328: reads via TanStack Query (were parallel raw fetch + useEffect).
  const { data: statsData, isLoading: statsLoading } = useApiQuery<WarmingStats>(
    ['tenant', 'lead-warming', 'stats'],
    '/api/tenant/lead-warming/stats',
  );
  const { data: repliesData, isLoading: repliesLoading } = useApiQuery<{ data?: Reply[] }>(
    ['tenant', 'lead-warming', 'replies'],
    '/api/tenant/lead-warming/replies?limit=50',
  );
  const { data: campaignsData, isLoading: campaignsLoading } = useApiQuery<{ data?: Campaign[] }>(
    ['tenant', 'lead-warming', 'campaigns'],
    '/api/tenant/lead-warming/campaigns',
  );
  const stats = statsData ?? null;
  const replies: Reply[] = repliesData?.data ?? [];
  const campaigns: Campaign[] = campaignsData?.data ?? [];
  const loading = statsLoading || repliesLoading || campaignsLoading;

  const loadData = () => {
    queryClient.invalidateQueries({ queryKey: ['tenant', 'lead-warming'] });
  };

  const toggleMutation = useMutation({
    mutationFn: async ({ id, currentStatus }: { id: string; currentStatus: string }) => {
      const newStatus = currentStatus === 'active' ? 'paused' : 'active';
      await fetch(`/api/tenant/lead-warming/campaigns/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
    },
    onSuccess: () => loadData(),
  });
  const toggleCampaignStatus = (id: string, currentStatus: string) => toggleMutation.mutate({ id, currentStatus });

  const archiveMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/tenant/lead-warming/campaigns/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => loadData(),
  });
  const archiveCampaign = (id: string) => archiveMutation.mutate(id);

  const filtered = filter === 'all' ? replies : replies.filter(r => r.intent === filter);
  const intentCounts = replies.reduce((acc, r) => { acc[r.intent] = (acc[r.intent] || 0) + 1; return acc; }, {} as Record<string, number>);

  if (loading) {
    return <div className="flex items-center justify-center h-48"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-5 animate-fade-in pb-12">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Heart className="w-5 h-5 text-rose-600" /> Lead Warming
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            AI-powered reply analysis and personalized festival/birthday messages. Classifies intent, extracts entities, and suggests next actions.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowBuilder(true)} leftIcon={<Plus className="w-4 h-4" />}>
          New Campaign
        </Button>
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

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        <button
          onClick={() => setTab('campaigns')}
          className={cn(
            'px-3 py-2 text-xs font-medium border-b-2 transition-colors -mb-px',
            tab === 'campaigns' ? 'border-violet-500 text-violet-700' : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          Campaigns ({campaigns.length})
        </button>
        <button
          onClick={() => setTab('replies')}
          className={cn(
            'px-3 py-2 text-xs font-medium border-b-2 transition-colors -mb-px',
            tab === 'replies' ? 'border-violet-500 text-violet-700' : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          Replies ({replies.length})
        </button>
      </div>

      {/* Campaigns tab */}
      {tab === 'campaigns' && (
        <div className="space-y-2">
          {campaigns.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground text-sm">
              No campaigns yet. Create your first warming campaign to start sending personalized messages.
            </div>
          ) : (
            campaigns.map(campaign => {
              const statusCfg = STATUS_CONFIG[campaign.status] ?? STATUS_CONFIG.draft!;
              const StatusIcon = statusCfg.icon;
              return (
                <div key={campaign.id} className="rounded-xl border border-border bg-card p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold truncate">{campaign.name}</span>
                        <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-bold uppercase', statusCfg.bg, statusCfg.color)}>
                          {StatusIcon && <StatusIcon className="w-2.5 h-2.5 inline mr-0.5" />}
                          {statusCfg.label}
                        </span>
                      </div>
                      {campaign.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{campaign.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {campaign.status !== 'archived' && (
                        <>
                          <button
                            onClick={() => toggleCampaignStatus(campaign.id, campaign.status)}
                            className="p-1.5 rounded-lg hover:bg-accent transition-colors"
                            title={campaign.status === 'active' ? 'Pause' : 'Activate'}
                          >
                            {campaign.status === 'active' ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            onClick={() => archiveCampaign(campaign.id)}
                            className="p-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground hover:text-red-600"
                            title="Archive"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
                    <span>Sent: <span className="font-bold text-foreground">{campaign.totalSent}</span></span>
                    <span>Replies: <span className="font-bold text-foreground">{campaign.totalReplies}</span></span>
                    <span>Positive: <span className="font-bold text-foreground">{campaign.totalPositiveIntent}</span></span>
                    <span className="ml-auto">{new Date(campaign.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Replies tab */}
      {tab === 'replies' && (
        <>
          {/* Intent filter pills */}
          <div className="flex flex-wrap gap-1.5">
            <FilterPill label="All" count={replies.length} active={filter === 'all'} onClick={() => setFilter('all')} />
            {Object.entries(intentCounts).sort((a, b) => b[1] - a[1]).map(([intent, count]) => {
              const cfg = INTENT_CONFIG[intent] ?? INTENT_CONFIG.unknown!;
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
                const intentCfg = INTENT_CONFIG[reply.intent] ?? INTENT_CONFIG.unknown!;
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
        </>
      )}

      {/* Campaign builder modal */}
      {showBuilder && (
        <CampaignBuilder
          onCreated={() => { setShowBuilder(false); loadData(); }}
          onClose={() => setShowBuilder(false)}
        />
      )}
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
