/**
 * Module Registry — central hub for NuCRM modules.
 * Modules are self-contained services (WhatsApp, AI, Forms, etc.)
 * that plug in without touching core CRM tables.
 */
import { db } from '@/drizzle/db';
import { tenantModules, modules } from '@/drizzle/schema/modules';
import { tenants } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import type { ModuleManifest } from '@/types';

export const BUILTIN_MODULES: ModuleManifest[] = [
  {
    id: 'core-crm', name: 'Core CRM', version: '1.0.0',
    description: 'Contacts, companies, deals, tasks, calendar, reports',
    author: 'NuCRM', category: 'utility', icon: '📋', minCrmVersion: '1.0.0',
    pricing: { free:{enabled:true},starter:{enabled:true},pro:{enabled:true},enterprise:{enabled:true} },
    features: ['Contacts','Companies','Deals (Kanban)','Tasks','Calendar','Reports','CSV Import/Export'],
    permissions: [],
  },
  {
    id: 'automation-basic', name: 'Basic Automation', version: '1.0.0',
    description: '5 pre-built one-click workflows',
    author: 'NuCRM', category: 'automation', icon: '⚡', minCrmVersion: '1.0.0',
    pricing: { free:{enabled:true},starter:{enabled:true},pro:{enabled:true},enterprise:{enabled:true} },
    features: ['Welcome email','Task reminders','Deal stage alerts','Lead assignment notify','Trial expiry warnings'],
    permissions: ['automations.view','automations.manage'],
  },
  {
    id: 'automation-pro', name: 'Automation Pro', version: '1.0.0',
    description: 'Visual workflow builder, multi-step sequences, conditional branching',
    author: 'NuCRM', category: 'automation', icon: '🚀', minCrmVersion: '1.0.0',
    pricing: { free:{enabled:false},starter:{enabled:true,price:29},pro:{enabled:true,price:29},enterprise:{enabled:true,price:0} },
    features: ['Visual drag-drop builder','Unlimited automations','Conditional logic','Multi-step sequences','Delay actions','Branching'],
    permissions: ['automations.view','automations.manage'],
    pages: ['/tenant/automation/builder','/tenant/sequences'],
    webhooks: ['automation.triggered','sequence.step_completed'],
  },
  {
    id: 'whatsapp-bot', name: 'WhatsApp Automation', version: '1.0.0',
    description: 'WhatsApp Business API — send messages, auto-replies, campaigns',
    author: 'NuCRM', category: 'messaging', icon: '💬', minCrmVersion: '1.0.0',
    pricing: { free:{enabled:false},starter:{enabled:true,price:19},pro:{enabled:true,price:19},enterprise:{enabled:true,price:0} },
    features: ['WhatsApp Business API','Template messages','Auto-replies','Bulk campaigns','Analytics'],
    permissions: ['automations.manage'],
    settings_schema: [
      { key:'phone_number_id', label:'Phone Number ID', type:'text', required:true },
      { key:'access_token', label:'Access Token', type:'password', required:true },
      { key:'verify_token', label:'Webhook Verify Token', type:'text', required:false },
    ],
    webhooks: ['whatsapp.message_received','whatsapp.message_delivered'],
  },
  {
    id: 'email-sync', name: 'Email Sync', version: '1.0.0',
    description: 'Gmail & Outlook 2-way sync — read/send email in CRM, auto-log to contacts',
    author: 'NuCRM', category: 'integration', icon: '📧', minCrmVersion: '1.0.0',
    pricing: { free:{enabled:false},starter:{enabled:true,price:15},pro:{enabled:true,price:15},enterprise:{enabled:true,price:0} },
    features: ['Gmail OAuth','Outlook OAuth','2-way sync','Auto-log to contacts','Email open tracking','Click tracking'],
    permissions: [],
    settings_schema: [
      { key:'provider', label:'Provider', type:'select', required:true,
        options:[{value:'gmail',label:'Gmail'},{value:'outlook',label:'Outlook'}] },
    ],
  },
  {
    id: 'ai-assistant', name: 'AI Assistant', version: '1.0.0',
    description: 'Claude AI — draft emails, score leads, predict deals, enrich contacts',
    author: 'NuCRM', category: 'ai', icon: '🤖', minCrmVersion: '1.0.0',
    pricing: { free:{enabled:false},starter:{enabled:false},pro:{enabled:true,price:25},enterprise:{enabled:true,price:0} },
    features: ['AI email drafting','Lead scoring (0-100)','Deal win prediction','Contact enrichment','Smart follow-ups'],
    permissions: [],
    settings_schema: [
      { key:'anthropic_api_key', label:'Anthropic API Key', type:'password', required:false,
        help:'Leave blank to use platform key' },
    ],
  },
  {
    id: 'forms-builder', name: 'Forms Builder', version: '1.0.0',
    description: 'Build custom lead capture forms — drag-drop, conditional logic, embeddable anywhere',
    author: 'NuCRM', category: 'utility', icon: '📝', minCrmVersion: '1.0.0',
    pricing: { free:{enabled:false},starter:{enabled:true,price:10},pro:{enabled:true,price:10},enterprise:{enabled:true,price:0} },
    features: ['Visual builder','Custom fields','Conditional logic','Multi-step','Embed script','Spam protection'],
    permissions: [],
    pages: ['/tenant/forms','/tenant/forms/builder'],
  },
  {
    id: 'calculated-fields', name: 'Calculated Fields', version: '1.0.0',
    description: 'Dynamic formula-based fields for any entity — math, logic, and string manipulation',
    author: 'NuCRM', category: 'utility', icon: '🧮', minCrmVersion: '1.0.0',
    pricing: { free:{enabled:false},starter:{enabled:false},pro:{enabled:true,price:15},enterprise:{enabled:true,price:0} },
    features: ['Formula engine','Dynamic math','Logic expressions','Automatic re-calculation'],
    permissions: [],
    pages: ['/tenant/settings/custom-fields'],
  },
  {
    id: 'industry-templates', name: 'Industry Templates', version: '1.0.0',
    description: 'One-click niche CRM setup — pre-configured pipelines, fields, and automations',
    author: 'NuCRM', category: 'utility', icon: '🪄', minCrmVersion: '1.0.0',
    pricing: { free:{enabled:false},starter:{enabled:false},pro:{enabled:true,price:20},enterprise:{enabled:true,price:0} },
    features: ['One-click setup','Real Estate','SaaS / Software','Consulting & Services','Recruitment & HR','Insurance','Healthcare & Clinics','Education & Training','E-Commerce & Retail','Legal & Law Firms','Fitness & Wellness','Travel & Tourism','Automotive & Dealerships','Financial Services'],
    permissions: [],
    pages: ['/tenant/settings/industry-templates'],
  },
  {
    id: 'analytics-pro', name: 'Analytics Pro', version: '1.0.0',
    description: 'Custom report builder, PDF export, scheduled reports, funnel charts',
    author: 'NuCRM', category: 'analytics', icon: '📊', minCrmVersion: '1.0.0',
    pricing: { free:{enabled:false},starter:{enabled:false},pro:{enabled:true,price:15},enterprise:{enabled:true,price:0} },
    features: ['Custom report builder','Funnel analytics','PDF export','Scheduled email reports','Revenue forecasting'],
    permissions: ['reports.view','reports.export'],
  },
  {
    id: 'service-helpdesk', name: 'Helpdesk (Beta)', version: '1.0.0',
    description: 'Manage customer support requests, track resolution times, and improve service quality',
    author: 'NuCRM', category: 'utility', icon: '🎧', minCrmVersion: '1.0.0',
    pricing: { free:{enabled:false},starter:{enabled:true,price:19},pro:{enabled:true,price:19},enterprise:{enabled:true,price:0} },
    features: ['Ticket management','Status tracking','Internal notes','Assign to team','Customer notifications'],
    permissions: ['tickets.view','tickets.manage'],
    pages: ['/tenant/tickets'],
  },
  {
    id: 'sales-quotes', name: 'Quotes & Proposals', version: '1.0.0',
    description: 'Professional PDF quote generator for deals',
    author: 'NuCRM', category: 'utility', icon: '📄', minCrmVersion: '1.0.0',
    pricing: { free:{enabled:false},starter:{enabled:true,price:15},pro:{enabled:true,price:15},enterprise:{enabled:true,price:0} },
    features: ['PDF generation','Template selection','Line items','Send via email','Track views'],
    permissions: ['quotes.view','quotes.manage'],
    pages: ['/tenant/deals'],
  },
  {
    id: 'compliance', name: 'Compliance Suite', version: '1.0.0',
    description: 'GDPR data export/deletion, SOC 2 reports, and data retention policies',
    author: 'NuCRM', category: 'utility', icon: '🛡️', minCrmVersion: '1.0.0',
    pricing: { free:{enabled:false},starter:{enabled:false},pro:{enabled:true,price:29},enterprise:{enabled:true,price:0} },
    features: ['GDPR Data Export','Right to Deletion','SOC 2 Reports','Data Retention Policies','Audit Trail'],
    permissions: ['compliance.view','compliance.manage'],
    pages: ['/tenant/settings/compliance'],
  },
  {
    id: 'marketing-segments', name: 'Smart Segments', version: '1.0.0',
    description: 'Advanced contact segmentation and dynamic lists',
    author: 'NuCRM', category: 'messaging', icon: '🎯', minCrmVersion: '1.0.0',
    pricing: { free:{enabled:false},starter:{enabled:true,price:19},pro:{enabled:true,price:19},enterprise:{enabled:true,price:0} },
    features: ['Dynamic lists','Custom filters','Saved segments','Sync with sequences'],
    permissions: ['segments.view','segments.manage'],
    pages: ['/tenant/contacts'],
  },
  {
    id: 'lead-warming', name: 'Lead Warming (Premium)', version: '1.0.0',
    description: 'Auto-send personalized emails + WhatsApp on festivals, birthdays, and events. AI understands reply intent.',
    author: 'NuCRM', category: 'messaging', icon: '🔥', minCrmVersion: '1.0.0',
    pricing: { free:{enabled:false},starter:{enabled:false},pro:{enabled:true,price:35},enterprise:{enabled:true,price:0} },
    features: [
      'Auto festival greetings (Diwali, Christmas, Holi, New Year, 20+ events)',
      'Birthday & anniversary auto-messages',
      'AI-generated personalized messages',
      'Multi-channel: Email + WhatsApp + SMS',
      'AI reply intent analysis (interested/not interested/ask later)',
      'Auto-create follow-up tasks from positive replies',
      'Contact cooldown & rate limiting',
      'Custom event calendar',
      'Reply sentiment scoring',
      'Campaign analytics dashboard',
    ],
    permissions: ['automations.view','automations.manage'],
    settings_schema: [
      { key:'ai_tone', label:'Default AI Tone', type:'select', required:false,
        options:[
          {value:'warm_professional',label:'Warm Professional'},
          {value:'casual_friendly',label:'Casual Friendly'},
          {value:'formal',label:'Formal'},
          {value:'festive',label:'Festive'},
        ] },
      { key:'default_language', label:'Default Language', type:'select', required:false,
        options:[
          {value:'en',label:'English'},
          {value:'hi',label:'Hindi'},
          {value:'es',label:'Spanish'},
          {value:'fr',label:'French'},
        ] },
    ],
    pages: ['/tenant/lead-warming'],
    webhooks: ['lead_warming.message_sent','lead_warming.reply_received','lead_warming.positive_intent'],
  },
];

export class ModuleRegistry {
  static getAll() { return BUILTIN_MODULES; }

  static get(moduleId: string): ModuleManifest | null {
    return BUILTIN_MODULES.find(m => m.id === moduleId) ?? null;
  }

  static async getTenantModules(tenantId: string): Promise<any[]> {
    const rows = await db
      .select({
        moduleId: tenantModules.moduleId,
        status: tenantModules.status,
        settings: tenantModules.settings,
        installedAt: tenantModules.installedAt,
        lastUsedAt: tenantModules.lastUsedAt,
        name: modules.name,
        description: modules.description,
        category: modules.category,
        icon: modules.icon,
      })
      .from(tenantModules)
      .innerJoin(modules, eq(modules.id, tenantModules.moduleId))
      .where(eq(tenantModules.tenantId, tenantId));

    // Merge DB data with manifest
    return rows.map(r => ({
      ...r,
      module_id: r.moduleId, // Match legacy property name for API compatibility
      installed_at: r.installedAt,
      manifest: ModuleRegistry.get(r.moduleId) ?? {},
    }));
  }

  static async hasModule(tenantId: string, moduleId: string): Promise<boolean> {
    const row = await db.query.tenantModules.findFirst({
      where: and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.moduleId, moduleId)),
      columns: { status: true }
    });
    return row?.status === 'active';
  }

  static async hasFeature(tenantId: string, moduleId: string, featureKey: string): Promise<boolean> {
    const row = await db.query.tenantModules.findFirst({
      where: and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.moduleId, moduleId)),
      columns: { status: true, enabledFeatures: true }
    });
    if (row?.status !== 'active') return false;
    
    const enabledFeatures = (row.enabledFeatures as string[]) ?? [];
    return enabledFeatures.includes(featureKey);
  }

  static async getTenantPlan(tenantId: string): Promise<string> {
    const row = await db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: { planId: true }
    });
    return row?.planId || 'free';
  }

  static async checkPlanGate(tenantId: string, moduleId: string): Promise<{ok:boolean; error?:string}> {
    const manifest = ModuleRegistry.get(moduleId);
    if (!manifest) return { ok: false, error: 'Module not found' };

    // Check super admin override first
    const existing = await db.query.tenantModules.findFirst({
      where: and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.moduleId, moduleId)),
      columns: { forceEnabled: true }
    });
    if (existing?.forceEnabled) return { ok: true };

    // Check DB-stored pricing (saved by super admin)
    const dbModule = await db.query.modules.findFirst({
      where: eq(modules.id, moduleId),
      columns: { manifest: true }
    });
    const savedPricing = (dbModule?.manifest as any)?.pricing;
    const pricing = savedPricing || manifest.pricing;

    // Check tenant's plan
    const plan = await ModuleRegistry.getTenantPlan(tenantId);
    const planConfig = pricing?.[plan];

    if (!planConfig?.enabled) {
      return { ok: false, error: `Module not available on your ${plan} plan. Upgrade to access ${manifest.name}.` };
    }
    return { ok: true };
  }

  static async install(tenantId: string, moduleId: string, installedBy: string, settings: Record<string,any> = {}): Promise<{ok:boolean;error?:string}> {
    const manifest = ModuleRegistry.get(moduleId);
    if (!manifest) return { ok: false, error: 'Module not found' };

    // Check plan gate (skip for super admin)
    const gate = await ModuleRegistry.checkPlanGate(tenantId, moduleId);
    if (!gate.ok) return gate;
    
    try {
      await db.transaction(async (tx) => {
        await tx.insert(modules).values({
          id: moduleId,
          name: manifest.name,
          version: manifest.version,
          description: manifest.description,
          category: manifest.category,
          icon: manifest.icon,
          manifest: manifest,
        }).onConflictDoNothing();

        await tx.insert(tenantModules).values({
          tenantId,
          moduleId,
          status: 'active',
          settings,
          installedBy,
        }).onConflictDoUpdate({
          target: [tenantModules.tenantId, tenantModules.moduleId],
          set: {
            status: 'active',
            settings,
            installedBy,
            updatedAt: new Date(),
          }
        });
      });
      return { ok: true };
    } catch (err: any) {
      console.error('[ModuleRegistry] install error:', err);
      return { ok: false, error: err.message };
    }
  }

  static async disable(tenantId: string, moduleId: string): Promise<void> {
    await db.update(tenantModules)
      .set({ status: 'disabled', updatedAt: new Date() })
      .where(and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.moduleId, moduleId)));
  }

  static async getSettings(tenantId: string, moduleId: string): Promise<Record<string,any>> {
    const row = await db.query.tenantModules.findFirst({
      where: and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.moduleId, moduleId)),
      columns: { settings: true }
    });
    return (row?.settings as Record<string, any>) ?? {};
  }

  static async updateSettings(tenantId: string, moduleId: string, settings: Record<string,any>): Promise<void> {
    await db.update(tenantModules)
      .set({ 
        settings, 
        lastUsedAt: new Date(),
        updatedAt: new Date()
      })
      .where(and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.moduleId, moduleId)));
  }
}

export default ModuleRegistry;
