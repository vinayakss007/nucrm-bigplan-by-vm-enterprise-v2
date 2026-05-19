'use client';

import { useState } from 'react';
import { CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

interface LeadFormProps {
  apiUrl: string;
  apiKey: string;
  redirectUrl?: string;
  title?: string;
  submitLabel?: string;
  showCompany?: boolean;
  showPhone?: boolean;
  onSuccess?: () => void;
  onError?: (error: string) => void;
}

export default function LeadCaptureForm({
  apiUrl,
  apiKey,
  redirectUrl,
  title = 'Get in Touch',
  submitLabel = 'Submit',
  showCompany = false,
  showPhone = false,
  onSuccess,
  onError,
}: LeadFormProps) {
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    company: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${apiUrl}/api/tenant/leads`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: JSON.stringify({
          first_name: formData.first_name,
          last_name: formData.last_name,
          email: formData.email,
          phone: showPhone ? formData.phone : undefined,
          company_name: showCompany ? formData.company : undefined,
          lead_source: 'Static Form',
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit');
      }

      setSuccess(true);
      setFormData({ first_name: '', last_name: '', email: '', phone: '', company: '' });

      if (onSuccess) {
        onSuccess();
      }

      if (redirectUrl) {
        setTimeout(() => {
          window.location.href = redirectUrl;
        }, 2000);
      }
    } catch (err: any) {
      setError(err.message);
      if (onError) {
        onError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="p-6 rounded-xl border border-emerald-500/20 bg-emerald-500/5">
        <div className="flex items-center gap-3">
          <CheckCircle className="w-8 h-8 text-emerald-500" />
          <div>
            <h3 className="text-lg font-bold text-emerald-600">Submitted!</h3>
            <p className="text-sm text-emerald-600/70">We'll be in touch soon.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 rounded-xl border border-border bg-card">
      <h3 className="text-lg font-bold mb-4">{title}</h3>
      
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              First Name *
            </label>
            <input
              type="text"
              required
              value={formData.first_name}
              onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-muted/20 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              placeholder="John"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Last Name *
            </label>
            <input
              type="text"
              required
              value={formData.last_name}
              onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-muted/20 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              placeholder="Doe"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Email *
          </label>
          <input
            type="email"
            required
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-border bg-muted/20 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            placeholder="john@example.com"
          />
        </div>

        {showPhone && (
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Phone
            </label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-muted/20 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              placeholder="+1-555-1234"
            />
          </div>
        )}

        {showCompany && (
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Company
            </label>
            <input
              type="text"
              value={formData.company}
              onChange={(e) => setFormData({ ...formData, company: e.target.value })}
              className="w-full px-3 py-2 rounded-lg border border-border bg-muted/20 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              placeholder="Acme Corp"
            />
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-sm text-red-500">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Submitting...
            </>
          ) : (
            submitLabel
          )}
        </button>

        <p className="text-xs text-muted-foreground text-center">
          We respect your privacy. No spam, ever.
        </p>
      </form>
    </div>
  );
}
