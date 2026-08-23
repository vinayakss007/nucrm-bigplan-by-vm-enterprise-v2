/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
'use client';

import { useState } from 'react';
import { Icon } from './icon';

/**
 * Marketing contact form.
 *
 * This posts to the existing public lead-capture endpoint, which requires a
 * destination workspace id. That id is supplied by the server component from
 * NEXT_PUBLIC_MARKETING_TENANT_ID — meaning enquiries from this page land in
 * abetworks' own NuCRM workspace as real leads, which is the correct dogfooding
 * outcome.
 *
 * If the variable is not configured, the form is not rendered at all and the
 * page falls back to direct email contact. A form that silently fails is worse
 * than no form.
 */
export function ContactForm({ tenantId }: { tenantId: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    company: '',
    message: '',
    interest: 'Product enquiry',
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState('sending');
    setError('');
    try {
      const res = await fetch('/api/leads/public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: form.first_name,
          last_name: form.last_name,
          email: form.email,
          phone: form.phone,
          company: form.company,
          // Keep the enquiry type in the message so it survives regardless of
          // which custom fields the receiving workspace has configured.
          message: `[${form.interest}]\n\n${form.message}`,
          source: 'Website — contact page',
          tenant_id: tenantId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Something went wrong. Please email us instead.');
      setState('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setState('error');
    }
  };

  if (state === 'done') {
    return (
      <div className="mk-card flex flex-col items-center justify-center p-10 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-400/25 bg-emerald-500/12">
          <Icon name="Check" className="h-7 w-7 text-emerald-400" strokeWidth={2.4} />
        </span>
        <h3 className="mk-h3 mt-5 text-white">Thanks — that reached us</h3>
        <p className="mk-body mt-2 max-w-sm">
          A real person will reply, usually within one working day. If it is urgent, reply to the confirmation email and
          say so.
        </p>
      </div>
    );
  }

  const field =
    'w-full rounded-xl border border-white/[0.1] bg-white/[0.03] px-3.5 py-3 text-[14px] text-white placeholder:text-slate-600 transition-colors focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/20';

  return (
    <form onSubmit={submit} className="mk-card p-6 sm:p-7">
      <div className="grid gap-3.5 sm:grid-cols-2">
        <label className="block">
          <span className="mk-tiny mb-1.5 block uppercase tracking-wider">First name</span>
          <input required value={form.first_name} onChange={set('first_name')} className={field} placeholder="Priya" />
        </label>
        <label className="block">
          <span className="mk-tiny mb-1.5 block uppercase tracking-wider">Last name</span>
          <input required value={form.last_name} onChange={set('last_name')} className={field} placeholder="Raman" />
        </label>
        <label className="block sm:col-span-2">
          <span className="mk-tiny mb-1.5 block uppercase tracking-wider">Work email</span>
          <input
            required
            type="email"
            value={form.email}
            onChange={set('email')}
            className={field}
            placeholder="priya@company.com"
          />
        </label>
        <label className="block">
          <span className="mk-tiny mb-1.5 block uppercase tracking-wider">Company</span>
          <input value={form.company} onChange={set('company')} className={field} placeholder="Company name" />
        </label>
        <label className="block">
          <span className="mk-tiny mb-1.5 block uppercase tracking-wider">Phone (optional)</span>
          <input value={form.phone} onChange={set('phone')} className={field} placeholder="+44 7700 900000" />
        </label>
        <label className="block sm:col-span-2">
          <span className="mk-tiny mb-1.5 block uppercase tracking-wider">What is this about?</span>
          <select value={form.interest} onChange={set('interest')} className={field}>
            {[
              'Product enquiry',
              'Enterprise / procurement',
              'Migration from another CRM',
              'Security review or documentation',
              'Partnership',
              'Support (existing customer)',
              'Something else',
            ].map((o) => (
              <option key={o} value={o} className="bg-[#0b0b16]">
                {o}
              </option>
            ))}
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className="mk-tiny mb-1.5 block uppercase tracking-wider">Message</span>
          <textarea
            required
            rows={5}
            value={form.message}
            onChange={set('message')}
            className={`${field} resize-y`}
            placeholder="Tell us what you are trying to fix. The more specific you are, the more useful our first reply will be."
          />
        </label>
      </div>

      {state === 'error' && (
        <p className="mt-4 flex items-start gap-2 rounded-xl border border-rose-400/25 bg-rose-500/10 p-3 text-[13px] text-rose-200">
          <Icon name="AlertTriangle" className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}

      <button type="submit" disabled={state === 'sending'} className="mk-btn mk-btn-primary mt-5 w-full disabled:opacity-60">
        {state === 'sending' ? 'Sending…' : 'Send message'}
        {state !== 'sending' && <Icon name="ArrowRight" className="h-4 w-4" strokeWidth={2.2} />}
      </button>
      <p className="mk-tiny mt-3.5 text-center">
        We use what you send here to reply to you, and nothing else. No sequence, no newsletter you did not ask for.
      </p>
    </form>
  );
}
