import { db } from '@/drizzle/db';
import { forms, tenants } from '@/drizzle/schema';
import { eq, and } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import PublicFormClient from './public-form-client';

export default async function PublicFormPage({ params }: any) {
  const { id } = await params;

  // Fetch form with basic tenant branding
  const [form] = await db.select({
    id: forms.id,
    tenantId: forms.tenantId,
    name: forms.name,
    description: forms.description,
    fields: forms.fields,
    isActive: forms.isActive,
    successMessage: forms.successMessage,
    redirectUrl: forms.redirectUrl,
    // Tenant branding
    tenant_name: tenants.name,
    primary_color: tenants.primaryColor,
    logo_url: tenants.logoUrl,
  })
  .from(forms)
  .innerJoin(tenants, eq(tenants.id, forms.tenantId))
  .where(and(
    eq(forms.id, id),
    eq(forms.isActive, true)
  ))
  .limit(1);

  if (!form) {
    return notFound();
  }

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <div className="w-full max-w-xl">
        {form.logo_url && (
          <div className="flex justify-center mb-8">
            <img src={form.logo_url} alt={form.tenant_name} className="h-12 object-contain" />
          </div>
        )}
        
        <div className="bg-card border border-border rounded-3xl shadow-2xl overflow-hidden animate-fade-in">
          <div className="p-8 border-b border-border bg-gradient-to-br from-violet-50/50 to-transparent">
            <h1 className="text-2xl font-bold text-center">{form.name}</h1>
            {form.description && (
              <p className="text-sm text-muted-foreground text-center mt-2">{form.description}</p>
            )}
          </div>
          
          <div className="p-8">
            <PublicFormClient form={form as any} />
          </div>
        </div>
        
        <p className="text-center text-[10px] text-muted-foreground mt-8 uppercase tracking-widest">
          Powered by abetworks.in — NuCRM
        </p>
      </div>
    </div>
  );
}
