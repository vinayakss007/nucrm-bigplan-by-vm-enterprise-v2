/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useApiQuery } from '@/lib/query/client';
import { useParams } from 'next/navigation';
import { FileText, CheckCircle, Loader2, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { getFieldIdentity } from '@/lib/forms/field-shape';
import InlineErrorState from '@/components/shared/inline-error-state';

interface PublicForm { name?: string; description?: string; settings?: { success_message?: string }; fields?: PublicFormField[] }
interface PublicFormField {
  // #2287: legacy/builder forms store `key`, API-created forms store `id`;
  // getFieldIdentity resolves the submitted-data key for both shapes.
  key?: string;
  id?: string;
  name?: string;
  label: string;
  type?: string;
  required?: boolean;
  options?: string[];
}

export default function PublicFormPage() {
  const params = useParams();
  const formId = params['id'] as string;
  
  const [submitted, setSubmitted] = useState(false);
  const [values, setValues] = useState<Record<string, unknown>>({});

  // #1328: the public form read goes through TanStack Query.
  const { data: form, isLoading: loading, error, refetch } = useApiQuery<PublicForm>(
    ['forms', 'public', formId],
    `/api/tenant/forms/public/${formId}`,
  );

  // #2872: the read used to have one channel (a four-second toast) and one durable sentence
  // ("may have been deleted"), whichever the server actually answered with. `retry: 2` and
  // `staleTime: 30_000` mean a refresh of a read that already answered leaves `form` in place
  // while `error` fills, so the states are derived from both, not from the flag.
  const failed = !form && !loading;
  const stale = Boolean(error) && Boolean(form);
  const reason = error?.message || 'no response from the server';
  const errorStatus = error?.status ?? null;
  const errorCode = (error?.info as { code?: string } | undefined)?.code ?? null;
  const isNotFound = failed && errorStatus === 404;
  const isUnavailable = failed && errorStatus === 403 && errorCode === 'TENANT_NOT_ACTIVE';

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/forms/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ form_id: formId, values }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error);
    },
    onSuccess: () => { setSubmitted(true); toast.success('Form submitted successfully!'); },
    onError: (err: Error) => toast.error(err.message || 'Failed to submit form'),
  });
  const submitting = submitMutation.isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    submitMutation.mutate();
  };

  const updateValue = (key: string, value: unknown) => {
    setValues((v) => ({ ...v, [key]: value }));
  };

  const inp = "w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-violet-500";

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-violet-600" />
          <p className="text-muted-foreground">Loading form...</p>
        </div>
      </div>
    );
  }

  if (!form) {
    // The route answers 404 for a form that is gone or unpublished
    // (`app/api/tenant/forms/public/[id]/route.ts:15` for an id that is not an entity id, `:36`
    // for the row), and #2119 gave a paused workspace its own 403 + `TENANT_NOT_ACTIVE` code
    // "so visitors get a truthful message". Both are verdicts, so neither gets a retry: asking
    // again cannot un-delete a form or activate a tenant.
    if (isNotFound) {
      return (
        <div className="min-h-screen flex items-center justify-center p-4">
          <div className="text-center space-y-4 max-w-md p-6">
            <AlertCircle className="w-12 h-12 mx-auto text-red-500" />
            <h1 className="text-xl font-bold">Form Not Found</h1>
            <p className="text-muted-foreground">This form may have been deleted or is no longer active.</p>
          </div>
        </div>
      );
    }

    if (isUnavailable) {
      return (
        <div className="min-h-screen flex items-center justify-center p-4">
          <div className="text-center space-y-4 max-w-md p-6">
            <AlertCircle className="w-12 h-12 mx-auto text-amber-500" />
            <h1 className="text-xl font-bold">This form is temporarily unavailable</h1>
            <p className="text-muted-foreground">
              Nothing is wrong with this form or with your link — the organization it belongs to is
              not open for responses right now. Please try again later.
            </p>
          </div>
        </div>
      );
    }

    // Everything else is this session failing to ask the question, which says nothing about the
    // form. No field, no submit button: a stranger must not spend answers on a form definition
    // that never arrived, and they have no other way to ask, so this screen carries the asking.
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full space-y-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center mx-auto">
            <FileText className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-xl font-bold text-center">This form is not on your screen yet</h1>
          <InlineErrorState
            message={`This form could not be read: ${reason}. Not one of its questions has reached you, and none of that is a verdict on the link or the form.`}
            onRetry={refetch}
          />
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-card border border-border rounded-2xl p-8 text-center space-y-4">
          <CheckCircle className="w-16 h-16 mx-auto text-emerald-500" />
          <h1 className="text-2xl font-bold">{form.settings?.success_message || 'Thank you!'}</h1>
          <p className="text-muted-foreground">Your response has been recorded.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 via-white to-indigo-50 dark:from-slate-950 dark:via-slate-900 dark:to-violet-950 flex items-center justify-center p-4">
      <div className="max-w-lg w-full bg-card border border-border rounded-2xl shadow-xl p-6 space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center mx-auto">
            <FileText className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold">{form.name}</h1>
          {form.description && <p className="text-sm text-muted-foreground">{form.description}</p>}
        </div>

        {stale && (
          <InlineErrorState
            message={`Could not refresh, so the questions below are the last read: ${reason}. Which fields exist, which of them are required, and the identities your answers are filed under all came from that read, and the form may have changed since.`}
            onRetry={refetch}
          />
        )}

        {/* Form */}
        <form onSubmit={submit} className="space-y-4">
          {form.fields?.map((field, index) => {
            // #2287: same identity rule as the submit validator.
            const fid = getFieldIdentity(field) ?? `field_${index}`;
            return (
            <div key={index}>
              <label className="block text-sm font-medium mb-1">
                {field.label}
                {field.required && <span className="text-red-500 ml-1">*</span>}
              </label>
              
              {field.type === 'textarea' ? (
                <textarea
                  value={String(values[fid] || '')}
                  onChange={e => updateValue(fid, e.target.value)}
                  className={inp}
                  rows={4}
                  required={field.required}
                />
              ) : field.type === 'select' ? (
                <select
                  value={String(values[fid] || '')}
                  onChange={e => updateValue(fid, e.target.value)}
                  className={inp}
                  required={field.required}
                >
                  <option value="">Select...</option>
                  {field.options?.map((opt: string, i: number) => (
                    <option key={i} value={opt}>{opt}</option>
                  ))}
                </select>
              ) : field.type === 'checkbox' ? (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(values[fid])}
                    onChange={e => updateValue(fid, e.target.checked)}
                    className="w-4 h-4 rounded border-border text-violet-600"
                    required={field.required}
                  />
                  <span className="text-sm">{field.label}</span>
                </label>
              ) : (
                <input
                  type={field.type || 'text'}
                  value={String(values[fid] || '')}
                  onChange={e => updateValue(fid, e.target.value)}
                  className={inp}
                  required={field.required}
                />
              )}
            </div>
            );
          })}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-violet-500/25"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {submitting ? 'Submitting...' : 'Submit'}
          </button>
        </form>

        {/* Footer */}
        <p className="text-xs text-center text-muted-foreground">
          Powered by <span className="font-semibold">NuCRM</span>
        </p>
      </div>
    </div>
  );
}
