/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { 
  Home, Laptop, Handshake, Check, ArrowRight, Loader2, 
  Sparkles, ShieldCheck, Zap, Layout
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useApiQuery } from '@/lib/query/client';
import InlineErrorState from '@/components/shared/inline-error-state';
import toast from 'react-hot-toast';
import { useRouter } from 'next/navigation';

interface TemplateCard {
  id: string;
  slug: string | null;
  name: string;
  description: string | null;
  icon: string | null;
  modules: string[];
  custom_fields: unknown[];
  pipelines: unknown[];
  automations: unknown[];
}

export default function IndustryTemplatesPage() {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // #2633: the gallery reads product_templates via the API (DB is the single
  // source of truth), so superadmin-created/edited templates appear here.
  // #1328: the read moves onto useApiQuery. #2872: it had no failure branch at
  // all, so an outage rendered as a blank gallery — indistinguishable from "no
  // template exists" — and a refused refresh wiped the cards a visitor was
  // already choosing from.
  const templatesQuery = useApiQuery<{ data?: TemplateCard[] }>(
    ['industry-templates'],
    '/api/tenant/industry-templates',
  );
  const { error: templatesError, data: templatesBody, refetch: refetchTemplates } = templatesQuery;
  const templates = templatesBody?.data ?? [];
  const failed = Boolean(templatesError) && !templatesBody;
  const stale = Boolean(templatesError) && Boolean(templatesBody);
  const reason = templatesError?.message || 'no response from the server';

  // #1328: apply via useMutation (was raw fetch + useState applying flag).
  const applyMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/tenant/industry-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: selectedId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to apply template');
      return data;
    },
    onSuccess: () => {
      toast.success('Template applied successfully!');
      router.push('/tenant/dashboard');
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to apply template'),
  });
  const applying = applyMutation.isPending;

  const handleApply = () => {
    if (!selectedId) return;
    applyMutation.mutate();
  };

  const getIcon = (icon: string) => {
    switch (icon) {
      case '🏠': return <Home className="w-6 h-6" />;
      case '💻': return <Laptop className="w-6 h-6" />;
      case '🤝': return <Handshake className="w-6 h-6" />;
      default: return <Sparkles className="w-6 h-6" />;
    }
  };

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 space-y-12">
      {/* Header */}
      <div className="text-center space-y-4">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 text-xs font-bold uppercase tracking-wider">
          <Sparkles className="w-3 h-3" /> Industry Templates
        </div>
        <h1 className="text-4xl font-extrabold tracking-tight">Setup your CRM in seconds</h1>
        <p className="text-xl text-muted-foreground mx-auto">
          Choose an industry template to pre-configure your fields, pipelines, and automations. 
          Eradicate "Blank Screen Syndrome" and start selling today.
        </p>
      </div>

      {/* Template Grid */}
      {failed && (
        <InlineErrorState
          className="max-w-3xl mx-auto"
          message={`Failed to load industry templates: ${reason}. An empty gallery would mean no template is published; this message means the request never answered.`}
          onRetry={() => void refetchTemplates()}
        />
      )}
      {stale && (
        <div
          role="alert"
          className="mx-auto flex max-w-3xl items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
        >
          <span>
            The template gallery could not be refreshed, so what is below is the last read: {reason}.
            Those templates are real — they may just not be the current set.
          </span>
          <button
            type="button"
            onClick={() => void refetchTemplates()}
            className="shrink-0 text-xs font-semibold underline"
          >
            Try again
          </button>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {templates.map((template) => (
          <button
            key={template.id}
            onClick={() => setSelectedId(template.id)}
            className={cn(
              "relative group text-left p-6 rounded-3xl border-2 transition-all duration-300",
              selectedId === template.id 
                ? "border-violet-600 bg-violet-50/50 dark:bg-violet-950/20 shadow-xl shadow-violet-500/10" 
                : "border-border bg-card hover:border-violet-400 hover:shadow-lg"
            )}
          >
            {selectedId === template.id && (
              <div className="absolute top-4 right-4 w-6 h-6 rounded-full bg-violet-600 flex items-center justify-center text-white">
                <Check className="w-4 h-4" />
              </div>
            )}
            
            <div className={cn(
              "w-12 h-12 rounded-2xl flex items-center justify-center mb-6 transition-colors",
              selectedId === template.id ? "bg-violet-600 text-white" : "bg-muted group-hover:bg-violet-100 group-hover:text-violet-600"
            )}>
              {getIcon(template.icon ?? '')}
            </div>
            
            <h3 className="text-xl font-bold mb-2">{template.name}</h3>
            <p className="text-sm text-muted-foreground mb-6">{template.description}</p>
            
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Layout className="w-3.5 h-3.5" /> {template.custom_fields?.length ?? 0} Custom Fields
              </div>
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Zap className="w-3.5 h-3.5" /> {template.automations?.length ?? 0} Automations
              </div>
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <ShieldCheck className="w-3.5 h-3.5" /> {template.pipelines?.length ?? 0} Pipelines
              </div>
            </div>
          </button>
        ))}
      </div>

      {templates.length === 0 && !failed && !templatesQuery.isLoading && (
        <p className="text-center text-sm text-muted-foreground">
          No industry templates are published yet — a superadmin adds them from the templates console.
        </p>
      )}

      {/* Action Footer */}
      <div className={cn(
        "fixed bottom-8 left-1/2 -translate-x-1/2 w-full max-w-md px-4 transition-all duration-500",
        selectedId ? "opacity-100 translate-y-0" : "opacity-0 translate-y-12 pointer-events-none"
      )}>
        <div className="bg-card border border-border rounded-2xl p-4 shadow-2xl flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Selected</p>
            <p className="font-bold truncate">{templates.find(t => t.id === selectedId)?.name}</p>
          </div>
          <button
            onClick={handleApply}
            disabled={applying}
            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-bold transition-all disabled:opacity-50"
          >
            {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            Apply Setup
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
      
      <div className="h-24" /> {/* Spacer */}
    </div>
  );
}
