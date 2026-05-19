'use client';

import { useState } from 'react';
import { CheckCircle, AlertCircle, Loader2, Building2, Mail, Phone, User } from 'lucide-react';

export default function LeadCaptureForm() {
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    company: '',
    message: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/leads/public', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...formData,
          source: 'Website Form',
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit');
      }

      setSuccess(true);
      setFormData({
        first_name: '',
        last_name: '',
        email: '',
        phone: '',
        company: '',
        message: '',
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  if (success) {
    return (
      <div className="max-w-md mx-auto p-8 rounded-2xl border border-emerald-500/20 bg-emerald-500/5">
        <div className="flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mb-4">
            <CheckCircle className="w-8 h-8 text-emerald-500" />
          </div>
          <h3 className="text-xl font-bold text-emerald-600 mb-2">Thank You!</h3>
          <p className="text-emerald-600/70">
            We've received your information and will be in touch soon.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto p-6 rounded-2xl border border-border bg-card shadow-xl">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold">Get in Touch</h2>
        <p className="text-sm text-muted-foreground mt-2">
          Fill out the form below and we'll get back to you shortly.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Name Fields */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              First Name *
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                name="first_name"
                value={formData.first_name}
                onChange={handleChange}
                required
                className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-border bg-muted/20 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 transition-all"
                placeholder="John"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Last Name *
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                name="last_name"
                value={formData.last_name}
                onChange={handleChange}
                required
                className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-border bg-muted/20 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 transition-all"
                placeholder="Doe"
              />
            </div>
          </div>
        </div>

        {/* Email */}
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">
            Email Address *
          </label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              required
              className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-border bg-muted/20 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 transition-all"
              placeholder="john@example.com"
            />
          </div>
        </div>

        {/* Phone */}
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">
            Phone Number
          </label>
          <div className="relative">
            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="tel"
              name="phone"
              value={formData.phone}
              onChange={handleChange}
              className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-border bg-muted/20 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 transition-all"
              placeholder="+1-555-1234"
            />
          </div>
        </div>

        {/* Company */}
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">
            Company
          </label>
          <div className="relative">
            <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              name="company"
              value={formData.company}
              onChange={handleChange}
              className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-border bg-muted/20 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 transition-all"
              placeholder="Acme Corp"
            />
          </div>
        </div>

        {/* Message */}
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">
            Message
          </label>
          <textarea
            name="message"
            value={formData.message}
            onChange={handleChange}
            rows={3}
            className="w-full px-3 py-2.5 rounded-lg border border-border bg-muted/20 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 transition-all resize-none"
            placeholder="How can we help you?"
          />
        </div>

        {/* Error Message */}
        {error && (
          <div className="flex items-center gap-2 text-sm text-red-500 bg-red-500/5 p-3 rounded-lg">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2 transition-all shadow-lg shadow-violet-500/25"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Submitting...
            </>
          ) : (
            'Submit'
          )}
        </button>

        {/* Privacy Notice */}
        <p className="text-xs text-muted-foreground text-center">
          We respect your privacy. Your information is safe with us.
        </p>
      </form>
    </div>
  );
}
