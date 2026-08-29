/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiQuery } from '@/lib/query/client';
import { Loader2, Sparkles, Zap } from 'lucide-react';
import toast from 'react-hot-toast';

interface IndustryTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  modules: string[];
  custom_fields: unknown[];
  pipelines: unknown[];
  automations: unknown[];
}

export default function IndustriesPage() {
  const queryClient = useQueryClient();

  // #1328: list via TanStack Query.
  const { data, isLoading: loading, error } = useApiQuery<{ data?: IndustryTemplate[] }>(
    ['tenant', 'industry-templates'],
    '/api/tenant/industry-templates',
  );
  const templates: IndustryTemplate[] = data?.data ?? [];

  useEffect(() => {
    if (error) toast.error('Could not load industry templates');
  }, [error]);

  // Apply via useMutation; `variables` is the templateId so the button can show
  // a per-row spinner without extra state.
  const applyTemplate = useMutation({
    mutationFn: async (templateId: string) => {
      const res = await fetch('/api/tenant/industry-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Failed to apply template');
      return body as { message?: string };
    },
    onSuccess: (body) => {
      toast.success(body.message || 'Template applied successfully!');
      queryClient.invalidateQueries({ queryKey: ['tenant', 'industry-templates'] });
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to apply template'),
  });

  const handleApply = (templateId: string) => applyTemplate.mutate(templateId);
  const applying = applyTemplate.isPending ? (applyTemplate.variables as string) : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 space-y-8">
      {/* Header */}
      <div className="space-y-2">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 text-xs font-bold uppercase tracking-wider">
          <Sparkles className="w-3 h-3" /> Industry Templates
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Industry Templates</h1>
        <p className="text-muted-foreground">
          Apply a pre-built template to configure your CRM with fields, pipelines, and automations for your industry.
        </p>
      </div>

      {/* Templates List */}
      {templates.length === 0 ? (
        <p className="text-muted-foreground text-center py-12">No templates available.</p>
      ) : (
        <div className="grid gap-4">
          {templates.map((template) => (
            <div
              key={template.id}
              className="flex items-center justify-between p-5 rounded-xl border bg-card hover:shadow-md transition-shadow"
            >
              <div className="space-y-1">
                <h3 className="text-lg font-semibold">{template.name}</h3>
                <p className="text-sm text-muted-foreground">{template.description}</p>
              </div>
              <button
                onClick={() => handleApply(template.id)}
                disabled={applying === template.id}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                {applying === template.id ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Zap className="w-4 h-4" />
                )}
                Apply Template
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
