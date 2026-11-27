/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { eq } from 'drizzle-orm';
import { forms, tenants } from '@/drizzle/schema';
import { withFormLookupContext } from '@/lib/db/form-capture-context';
import { logError } from '@/lib/errors-server';
import { isUuid } from '@/lib/id';
import { BRAND } from '@/lib/marketing/site';
import SimpleLeadForm from '@/components/shared/simple-lead-form';

const MARKETING_TENANT_ID = process.env.NEXT_PUBLIC_MARKETING_TENANT_ID ?? '';

type LeadDestination = { tenantId: string; formId?: string };

async function resolveEmbeddedForm(form: string | string[] | undefined): Promise<LeadDestination | null> {
  const formId = Array.isArray(form) ? form[0] : form;
  if (!formId || !isUuid(formId)) return null;
  try {
    const [row] = await withFormLookupContext(formId, (tx) =>
      tx
        .select({ tenantId: forms.tenantId, isActive: forms.isActive, tenantStatus: tenants.status })
        .from(forms)
        .innerJoin(tenants, eq(tenants.id, forms.tenantId))
        .where(eq(forms.id, formId))
        .limit(1),
    );
    if (!row?.isActive || row.tenantStatus !== 'active') return null;
    return { tenantId: row.tenantId, formId };
  } catch (err) {
    await logError({ error: err, context: 'lead-capture/embedded-form-lookup' });
    return null;
  }
}

export default async function LeadCapturePage({
  searchParams,
}: {
  searchParams: Promise<{ form?: string | string[] }>;
}) {
  const { form } = await searchParams;
  const requestedForm = Array.isArray(form) ? form[0] : form;
  const embedded = Boolean(requestedForm);
  const destination: LeadDestination | null = embedded
    ? await resolveEmbeddedForm(form)
    : MARKETING_TENANT_ID
      ? { tenantId: MARKETING_TENANT_ID }
      : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 via-white to-indigo-50 dark:from-slate-950 dark:via-slate-900 dark:to-violet-950 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/25">
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <div className="text-left">
              <h1 className="text-2xl font-bold bg-gradient-to-r from-violet-700 to-indigo-600 bg-clip-text text-transparent">
                Contact Us
              </h1>
              <p className="text-sm text-muted-foreground">
                We'd love to hear from you
              </p>
            </div>
          </div>
        </div>

        {/* Form */}
        {destination ? (
          <SimpleLeadForm tenantId={destination.tenantId} formId={destination.formId} />
        ) : embedded ? (
          <div className="max-w-md mx-auto p-8 rounded-2xl border border-border bg-card shadow-xl text-center">
            <h2 className="text-xl font-semibold">This form is temporarily unavailable</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              Please contact the organization that shared this form with you.
            </p>
          </div>
        ) : (
          <div className="max-w-md mx-auto p-8 rounded-2xl border border-border bg-card shadow-xl text-center">
            <h2 className="text-xl font-semibold">Email us directly</h2>
            <p className="mt-3 text-sm text-muted-foreground">
              Tell us what you are trying to do and we will get back to you within one working day.
            </p>
            <a
              href={`mailto:${BRAND.email}`}
              className="mt-6 inline-flex items-center justify-center rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-violet-700"
            >
              {BRAND.email}
            </a>
          </div>
        )}

        {/* Features */}
        <div className="mt-8 grid grid-cols-3 gap-4 text-center">
          <div className="p-4 rounded-xl bg-white/50 dark:bg-slate-800/50 backdrop-blur">
            <div className="text-2xl mb-2">🔒</div>
            <p className="text-xs font-medium">Secure</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Your data is protected</p>
          </div>
          <div className="p-4 rounded-xl bg-white/50 dark:bg-slate-800/50 backdrop-blur">
            <div className="text-2xl mb-2">⚡</div>
            <p className="text-xs font-medium">Fast Response</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">We reply within 24 hours</p>
          </div>
          <div className="p-4 rounded-xl bg-white/50 dark:bg-slate-800/50 backdrop-blur">
            <div className="text-2xl mb-2">💯</div>
            <p className="text-xs font-medium">Private</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">No spam, ever</p>
          </div>
        </div>
      </div>
    </div>
  );
}
