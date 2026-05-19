'use client';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { FileText, CheckCircle, Loader2, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';

export default function PublicFormPage() {
  const params = useParams();
  const formId = params['id'] as string;
  
  const [form, setForm] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [values, setValues] = useState<Record<string, any>>({});

  useEffect(() => {
    loadForm();
  }, [formId]);

  const loadForm = async () => {
    try {
      const res = await fetch(`/api/tenant/forms/public/${formId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setForm(data);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load form');
    } finally {
      setLoading(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    
    try {
      const res = await fetch('/api/forms/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ form_id: formId, values }),
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      
      setSubmitted(true);
      toast.success('Form submitted successfully!');
    } catch (err: any) {
      toast.error(err.message || 'Failed to submit form');
    } finally {
      setSubmitting(false);
    }
  };

  const updateValue = (key: string, value: any) => {
    setValues(v => ({ ...v, [key]: value }));
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
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4 max-w-md p-6">
          <AlertCircle className="w-12 h-12 mx-auto text-red-500" />
          <h1 className="text-xl font-bold">Form Not Found</h1>
          <p className="text-muted-foreground">This form may have been deleted or is no longer active.</p>
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

        {/* Form */}
        <form onSubmit={submit} className="space-y-4">
          {form.fields?.map((field: any, index: number) => (
            <div key={index}>
              <label className="block text-sm font-medium mb-1">
                {field.label}
                {field.required && <span className="text-red-500 ml-1">*</span>}
              </label>
              
              {field.type === 'textarea' ? (
                <textarea
                  value={values[field.key] || ''}
                  onChange={e => updateValue(field.key, e.target.value)}
                  className={inp}
                  rows={4}
                  required={field.required}
                />
              ) : field.type === 'select' ? (
                <select
                  value={values[field.key] || ''}
                  onChange={e => updateValue(field.key, e.target.value)}
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
                    checked={values[field.key] || false}
                    onChange={e => updateValue(field.key, e.target.checked)}
                    className="w-4 h-4 rounded border-border text-violet-600"
                    required={field.required}
                  />
                  <span className="text-sm">{field.label}</span>
                </label>
              ) : (
                <input
                  type={field.type || 'text'}
                  value={values[field.key] || ''}
                  onChange={e => updateValue(field.key, e.target.value)}
                  className={inp}
                  required={field.required}
                />
              )}
            </div>
          ))}

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
