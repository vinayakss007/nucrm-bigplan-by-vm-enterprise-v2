/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState, useEffect, useCallback } from 'react';
import {
  ChevronRight, ChevronLeft, Sparkles, Send,
  Mail, MessageSquare, Phone, Calendar, Users, Brain, Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// ── Types ──────────────────────────────────────────────────────────────────

type CampaignData = {
  name: string;
  description: string;
  target_filter: Record<string, unknown>;
  event_ids: string[];
  include_birthdays: boolean;
  include_anniversaries: boolean;
  enable_email: boolean;
  enable_whatsapp: boolean;
  enable_sms: boolean;
  ai_generate_messages: boolean;
  ai_tone: string;
  ai_language: string;
  ai_analyze_replies: boolean;
  auto_respond_to_positive: boolean;
  notify_on_positive_intent: boolean;
  max_messages_per_contact_per_month: number;
  cooldown_days: number;
};

type Event = {
  id: string;
  name: string;
  event_type: string;
  event_month: number | null;
  event_day: number | null;
  channels: string[];
  is_system: boolean;
};

type Step = 'basics' | 'audience' | 'ai' | 'schedule';

const STEPS: { key: Step; label: string; icon: typeof Users }[] = [
  { key: 'basics', label: 'Basics', icon: Users },
  { key: 'audience', label: 'Audience', icon: Calendar },
  { key: 'ai', label: 'AI Settings', icon: Brain },
  { key: 'schedule', label: 'Schedule', icon: Send },
];

const TONE_OPTIONS = [
  { value: 'warm_professional', label: 'Warm & Professional' },
  { value: 'casual_friendly', label: 'Casual & Friendly' },
  { value: 'formal', label: 'Formal' },
  { value: 'festive', label: 'Festive' },
];

const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'Hindi' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'auto', label: 'Auto-detect' },
];

// ── Component ──────────────────────────────────────────────────────────────

type Props = {
  onCreated: () => void;
  onClose: () => void;
};

export function CampaignBuilder({ onCreated, onClose }: Props) {
  const [step, setStep] = useState<Step>('basics');
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CampaignData>({
    name: '',
    description: '',
    target_filter: {},
    event_ids: [],
    include_birthdays: true,
    include_anniversaries: false,
    enable_email: true,
    enable_whatsapp: true,
    enable_sms: false,
    ai_generate_messages: true,
    ai_tone: 'warm_professional',
    ai_language: 'en',
    ai_analyze_replies: true,
    auto_respond_to_positive: false,
    notify_on_positive_intent: true,
    max_messages_per_contact_per_month: 4,
    cooldown_days: 7,
  });

  useEffect(() => {
    fetch('/api/tenant/lead-warming/events')
      .then(r => r.ok ? r.json() : { data: [] })
      .then(d => setEvents(d.data ?? []))
      .catch(() => {});
  }, []);

  const update = useCallback(<K extends keyof CampaignData>(key: K, value: CampaignData[K]) => {
    setData(prev => ({ ...prev, [key]: value }));
  }, []);

  const stepIdx = STEPS.findIndex(s => s.key === step);
  const canNext = stepIdx < STEPS.length - 1;
  const canPrev = stepIdx > 0;
  const isLast = step === 'schedule';

  const handleSubmit = async () => {
    if (!data.name.trim()) {
      setError('Campaign name is required');
      setStep('basics');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/tenant/lead-warming/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to create campaign');
      onCreated();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Step indicators */}
        <div className="flex items-center gap-1 px-6 pt-5 pb-3">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const active = s.key === step;
            const done = i < stepIdx;
            return (
              <div key={s.key} className="flex items-center gap-1 flex-1">
                <button
                  onClick={() => setStep(s.key)}
                  className={cn(
                    'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors',
                    active ? 'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300' :
                    done ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300' :
                    'text-muted-foreground hover:bg-accent',
                  )}
                >
                  {done ? <Check className="w-3 h-3" /> : <Icon className="w-3 h-3" />}
                  <span className="hidden sm:inline">{s.label}</span>
                </button>
                {i < STEPS.length - 1 && <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />}
              </div>
            );
          })}
        </div>

        {/* Step content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {step === 'basics' && (
            <BasicsStep data={data} update={update} />
          )}
          {step === 'audience' && (
            <AudienceStep data={data} update={update} events={events} />
          )}
          {step === 'ai' && (
            <AiStep data={data} update={update} />
          )}
          {step === 'schedule' && (
            <ScheduleStep data={data} update={update} />
          )}
          {error && (
            <p className="text-sm text-red-600 bg-red-50 dark:bg-red-950/30 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border">
          <div>
            {canPrev ? (
              <Button variant="ghost" size="sm" onClick={() => { const prev = STEPS[stepIdx - 1]; if (prev) setStep(prev.key); }}>
                <ChevronLeft className="w-4 h-4 mr-1" /> Back
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            )}
          </div>
          <div className="flex gap-2">
            {canNext && (
              <Button size="sm" onClick={() => { const next = STEPS[stepIdx + 1]; if (next) setStep(next.key); }}>
                Next <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            )}
            {isLast && (
              <Button
                size="sm"
                isLoading={loading}
                onClick={handleSubmit}
                leftIcon={<Send className="w-4 h-4" />}
              >
                Launch Campaign
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Step 1: Basics ─────────────────────────────────────────────────────────

function BasicsStep({ data, update }: { data: CampaignData; update: <K extends keyof CampaignData>(key: K, val: CampaignData[K]) => void }) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-bold mb-1">Campaign Name</h3>
        <Input
          placeholder="e.g. Diwali 2026 Warm-Up"
          value={data.name}
          onChange={e => update('name', e.target.value)}
        />
      </div>
      <div>
        <h3 className="text-sm font-bold mb-1">Description <span className="text-muted-foreground font-normal">(optional)</span></h3>
        <textarea
          className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          placeholder="What is this campaign about?"
          value={data.description}
          onChange={e => update('description', e.target.value)}
        />
      </div>
    </div>
  );
}

// ── Step 2: Audience ───────────────────────────────────────────────────────

function AudienceStep({ data, update, events }: { data: CampaignData; update: <K extends keyof CampaignData>(key: K, val: CampaignData[K]) => void; events: Event[] }) {
  const toggleEvent = (id: string) => {
    const ids = data.event_ids.includes(id)
      ? data.event_ids.filter(e => e !== id)
      : [...data.event_ids, id];
    update('event_ids', ids);
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-bold mb-2">Events</h3>
        <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto">
          {events.map(ev => (
            <button
              key={ev.id}
              onClick={() => toggleEvent(ev.id)}
              className={cn(
                'flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs border transition-colors text-left',
                data.event_ids.includes(ev.id)
                  ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/30 text-violet-700'
                  : 'border-border hover:bg-accent',
              )}
            >
              <span className="truncate">{ev.name}</span>
              {ev.is_system && <span className="text-[9px] opacity-50 shrink-0">SYS</span>}
            </button>
          ))}
          {events.length === 0 && (
            <p className="text-xs text-muted-foreground col-span-2">No events available. Create events first.</p>
          )}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-bold mb-2">Include</h3>
        <div className="flex flex-wrap gap-2">
          <ToggleChip
            label="Birthdays"
            active={data.include_birthdays}
            onClick={() => update('include_birthdays', !data.include_birthdays)}
          />
          <ToggleChip
            label="Anniversaries"
            active={data.include_anniversaries}
            onClick={() => update('include_anniversaries', !data.include_anniversaries)}
          />
        </div>
      </div>

      <div>
        <h3 className="text-sm font-bold mb-2">Channels</h3>
        <div className="flex gap-2">
          <ChannelToggle icon={Mail} label="Email" active={data.enable_email} onClick={() => update('enable_email', !data.enable_email)} />
          <ChannelToggle icon={MessageSquare} label="WhatsApp" active={data.enable_whatsapp} onClick={() => update('enable_whatsapp', !data.enable_whatsapp)} />
          <ChannelToggle icon={Phone} label="SMS" active={data.enable_sms} onClick={() => update('enable_sms', !data.enable_sms)} />
        </div>
      </div>
    </div>
  );
}

// ── Step 3: AI Settings ────────────────────────────────────────────────────

function AiStep({ data, update }: { data: CampaignData; update: <K extends keyof CampaignData>(key: K, val: CampaignData[K]) => void }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm font-bold">
        <Sparkles className="w-4 h-4 text-violet-600" /> AI Message Generation
      </div>

      <ToggleChip
        label="AI-generated personalized messages"
        active={data.ai_generate_messages}
        onClick={() => update('ai_generate_messages', !data.ai_generate_messages)}
      />

      {data.ai_generate_messages && (
        <>
          <div>
            <h3 className="text-sm font-bold mb-1">Tone</h3>
            <div className="flex flex-wrap gap-1.5">
              {TONE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => update('ai_tone', opt.value)}
                  className={cn(
                    'px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors',
                    data.ai_tone === opt.value
                      ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/30 text-violet-700'
                      : 'border-border hover:bg-accent',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-bold mb-1">Language</h3>
            <div className="flex flex-wrap gap-1.5">
              {LANGUAGE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => update('ai_language', opt.value)}
                  className={cn(
                    'px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors',
                    data.ai_language === opt.value
                      ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/30 text-violet-700'
                      : 'border-border hover:bg-accent',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="border-t border-border pt-3 space-y-2">
        <div className="flex items-center gap-2 text-sm font-bold">
          <Sparkles className="w-4 h-4 text-violet-600" /> Reply Handling
        </div>
        <ToggleChip
          label="AI-analyze incoming replies"
          active={data.ai_analyze_replies}
          onClick={() => update('ai_analyze_replies', !data.ai_analyze_replies)}
        />
        <ToggleChip
          label="Auto-respond to positive replies"
          active={data.auto_respond_to_positive}
          onClick={() => update('auto_respond_to_positive', !data.auto_respond_to_positive)}
        />
        <ToggleChip
          label="Notify on positive intent"
          active={data.notify_on_positive_intent}
          onClick={() => update('notify_on_positive_intent', !data.notify_on_positive_intent)}
        />
      </div>
    </div>
  );
}

// ── Step 4: Schedule ───────────────────────────────────────────────────────

function ScheduleStep({ data, update }: { data: CampaignData; update: <K extends keyof CampaignData>(key: K, val: CampaignData[K]) => void }) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold">Rate Limiting</h3>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Max messages/contact/month</label>
          <Input
            type="number"
            min={1}
            max={20}
            value={data.max_messages_per_contact_per_month}
            onChange={e => update('max_messages_per_contact_per_month', Number(e.target.value) || 4)}
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Cooldown between messages (days)</label>
          <Input
            type="number"
            min={1}
            max={90}
            value={data.cooldown_days}
            onChange={e => update('cooldown_days', Number(e.target.value) || 7)}
          />
        </div>
      </div>

      <div className="rounded-xl bg-muted/50 p-4 space-y-2 text-xs">
        <h4 className="font-bold text-sm">Summary</h4>
        <p><span className="font-semibold">Name:</span> {data.name || '(unnamed)'}</p>
        <p><span className="font-semibold">Events:</span> {data.event_ids.length} selected{data.include_birthdays ? ' + birthdays' : ''}{data.include_anniversaries ? ' + anniversaries' : ''}</p>
        <p>
          <span className="font-semibold">Channels:</span>{' '}
          {data.enable_email ? 'Email ' : ''}{data.enable_whatsapp ? 'WhatsApp ' : ''}{data.enable_sms ? 'SMS' : ''}
        </p>
        <p><span className="font-semibold">AI:</span> {data.ai_generate_messages ? `On (${data.ai_tone})` : 'Off'}</p>
        <p><span className="font-semibold">Limits:</span> {data.max_messages_per_contact_per_month}/mo, {data.cooldown_days}d cooldown</p>
      </div>
    </div>
  );
}

// ── Shared mini-components ─────────────────────────────────────────────────

function ToggleChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors',
        active
          ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/30 text-violet-700'
          : 'border-border text-muted-foreground hover:bg-accent',
      )}
    >
      <span className={cn('w-3 h-3 rounded-sm border flex items-center justify-center', active ? 'bg-violet-500 border-violet-500' : 'border-muted-foreground/30')}>
        {active && <Check className="w-2 h-2 text-white" />}
      </span>
      {label}
    </button>
  );
}

function ChannelToggle({ icon: Icon, label, active, onClick }: { icon: typeof Mail; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors',
        active
          ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/30 text-violet-700'
          : 'border-border text-muted-foreground hover:bg-accent',
      )}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}
