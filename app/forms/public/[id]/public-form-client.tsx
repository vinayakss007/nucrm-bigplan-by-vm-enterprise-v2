'use client';

import { useState, useEffect, useRef } from 'react';
import { Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function PublicFormClient({ form }: { form: any }) {
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState<Record<string, any>>({});
  const containerRef = useRef<HTMLFormElement>(null);

  // Resize reporting for iframes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height;
      if (height && window.parent !== window) {
        window.parent.postMessage({ 
          type: 'nucrm-resize', 
          formId: form.id, 
          height: height + 64 // extra padding
        }, '*');
      }
    });
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [form.id, success]);

  const fields = Array.isArray(form.fields) ? form.fields : [];
  const settings = form.settings || {};

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/forms/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          form_id: form.id,
          data: formData,
        }),
      });

      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed to submit');

      setSuccess(true);
      
      // Notify parent about success
      if (window.parent !== window) {
        window.parent.postMessage({ type: 'nucrm-submit-success', formId: form.id }, '*');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (key: string, value: any) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  if (success) {
    return (
      <div className="text-center py-8 space-y-4 animate-in fade-in zoom-in duration-300">
        <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
          <CheckCircle className="w-10 h-10 text-emerald-600" />
        </div>
        <h2 className="text-2xl font-bold text-foreground">Done!</h2>
        <p className="text-muted-foreground max-w-sm mx-auto">
          {settings.success_message || 'Your submission has been received.'}
        </p>
        <button 
          onClick={() => setSuccess(false)}
          className="text-sm font-medium text-violet-600 hover:underline"
        >
          Submit another response
        </button>
      </div>
    );
  }

  return (
    <form ref={containerRef} onSubmit={handleSubmit} className="space-y-5">
      {fields.map((field: any) => (
        <div key={field.id}>
          <label className="block text-sm font-semibold mb-1.5">
            {field.label} {field.required && <span className="text-red-500">*</span>}
          </label>
          
          {field.type === 'textarea' ? (
            <textarea
              required={field.required}
              placeholder={field.placeholder}
              value={formData[field.key] || ''}
              onChange={(e) => handleChange(field.key, e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-border bg-muted/20 focus:outline-none focus:ring-2 focus:ring-violet-500 transition-all min-h-[120px]"
            />
          ) : field.type === 'select' ? (
            <select
              required={field.required}
              value={formData[field.key] || ''}
              onChange={(e) => handleChange(field.key, e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-border bg-muted/20 focus:outline-none focus:ring-2 focus:ring-violet-500 transition-all"
            >
              <option value="">Select an option...</option>
              {(field.options || []).map((opt: string) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          ) : (
            <input
              type={field.type}
              required={field.required}
              placeholder={field.placeholder}
              value={formData[field.key] || ''}
              onChange={(e) => handleChange(field.key, e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-border bg-muted/20 focus:outline-none focus:ring-2 focus:ring-violet-500 transition-all"
            />
          )}
        </div>
      ))}

      {error && (
        <div className="flex items-center gap-2 p-4 rounded-xl bg-red-50 text-red-600 text-sm animate-shake">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        style={{ backgroundColor: settings.theme_color || '#7c3aed' }}
        className="w-full py-4 rounded-2xl text-white font-bold shadow-lg shadow-violet-500/25 hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
      >
        {loading && <Loader2 className="w-5 h-5 animate-spin" />}
        {settings.submit_button_text || 'Submit'}
      </button>

      <p className="text-[10px] text-center text-muted-foreground uppercase tracking-widest pt-4">
        Your data is secure and encrypted
      </p>
    </form>
  );
}
