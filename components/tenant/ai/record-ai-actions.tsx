/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Lightbulb, Mail, MessageSquare, Loader2, X } from 'lucide-react';
import { fetchJsonOrThrow } from '@/lib/fetch-json';
import { cn } from '@/lib/utils';

type EntityType = 'contact' | 'deal';

type Result = {
  kind: 'insights' | 'summary' | 'draft';
  title: string;
  body: string;
};

type Props = {
  entityType: EntityType;
  entityId: string;
  canEdit?: boolean;
};

const BUTTONS = [
  { kind: 'insights', label: 'AI insights', icon: Lightbulb },
  { kind: 'summary', label: 'Summarize', icon: MessageSquare },
  { kind: 'draft', label: 'Draft email', icon: Mail },
] as const;

type Kind = typeof BUTTONS[number]['kind'];

export default function RecordAiActions({ entityType, entityId, canEdit = false }: Props) {
  const [error, setError] = useState<string | null>(null);

  const action = useMutation({
    mutationFn: async (kind: Kind): Promise<Result> => {
      if (kind === 'insights') {
        const data = await fetchJsonOrThrow<{ insights: { title: string; content: string }[] }>('/api/tenant/ai/insights', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entity_type: entityType, entity_id: entityId }),
        });
        return {
          kind,
          title: 'AI insights',
          body: data.insights.length
            ? data.insights.map(i => `• ${i.title}: ${i.content}`).join('\n')
            : 'No signals found for this record yet.',
        };
      }
      if (kind === 'summary') {
        const data = await fetchJsonOrThrow<{ summary: string }>('/api/tenant/ai/summarize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entity_type: entityType, entity_id: entityId }),
        });
        return { kind, title: 'Summary', body: data.summary };
      }
      const payload = {
        purpose: 'follow_up',
        ...(entityType === 'contact' ? { contact_id: entityId } : { deal_id: entityId }),
      };
      const data = await fetchJsonOrThrow<{ subject: string; body: string }>('/api/tenant/ai/email-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return { kind, title: data.subject, body: data.body };
    },
    onMutate: () => setError(null),
    onError: (e: Error) => setError(e.message),
  });

  const result = action.data ?? null;
  const running = action.isPending;

  return (
    <div className="mb-4 rounded-xl border border-violet-200 bg-violet-50/40 dark:border-violet-900/50 dark:bg-violet-950/10 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-widest text-violet-700 dark:text-violet-300">AI actions</span>
        {BUTTONS.filter(b => b.kind !== 'draft' || canEdit).map(({ kind, label, icon: Icon }) => (
          <button key={kind} type="button" onClick={() => action.mutate(kind)} disabled={running}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50',
              action.variables === kind
                ? 'border-violet-500 bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-200'
                : 'border-border bg-background hover:bg-muted',
            )}>
            {running && action.variables === kind ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
            {label}
          </button>
        ))}
        {result && (
          <button type="button" onClick={() => action.reset()} aria-label="Close AI result" className="ml-auto text-muted-foreground hover:text-foreground">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400 mt-2">{error}</p>}
      {result && (
        <div className="mt-3 rounded-lg border bg-card px-3 py-2">
          <p className="text-xs font-semibold">{result.title}</p>
          <p className="text-xs text-muted-foreground whitespace-pre-wrap mt-1">{result.body}</p>
          {result.kind === 'draft' && (
            <p className="text-[10px] text-muted-foreground mt-2">Saved as a draft — review it before sending.</p>
          )}
        </div>
      )}
    </div>
  );
}
