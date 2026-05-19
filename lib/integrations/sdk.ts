/**
 * NuCRM External SDK
 *
 * Use this to integrate NuCRM into your own application.
 *
 * @example
 * import { createNuCRM } from '@/lib/integrations/sdk';
 * const crm = createNuCRM({ apiKey: 'ak_live_...', baseUrl: 'https://yourcrm.com' });
 * await crm.contacts.create({ email: 'user@example.com', first_name: 'Jane' });
 */

import { createHmac } from 'crypto';

export interface NuCRMConfig {
  apiKey: string;
  baseUrl: string;
  tenantId?: string;    // Optional: override tenant context
}

export interface ContactInput {
  email?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  company?: string;
  lead_source?: string;
  lead_status?: string;
  tags?: string[];
  notes?: string;
  custom_fields?: Record<string, any>;
}

export interface DealInput {
  title: string;
  value?: number;
  stage?: string;
  contact_id?: string;
  company_id?: string;
  close_date?: string;
  notes?: string;
}

export interface TaskInput {
  title: string;
  due_date?: string;
  priority?: 'low' | 'medium' | 'high';
  contact_id?: string;
  deal_id?: string;
  description?: string;
}

class NuCRMClient {
  private cfg: NuCRMConfig;

  constructor(config: NuCRMConfig) {
    this.cfg = { ...config, baseUrl: config.baseUrl.replace(/\/$/, '') };
  }

  private async req<T>(path: string, options: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.cfg.baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.cfg.apiKey}`,
        'X-Tenant-ID': this.cfg.tenantId ?? '',
        ...(options.headers ?? {}),
      },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    return data;
  }

  // ── Contacts ────────────────────────────────────────────────
  readonly contacts = {
    list: (params?: { limit?: number; offset?: number; q?: string; lead_status?: string }) => {
      const q = new URLSearchParams(params as any).toString();
      return this.req<{ data: any[]; total: number }>(`/api/tenant/contacts?${q}`);
    },
    get: (id: string) => this.req<{ data: any }>(`/api/tenant/contacts/${id}`),
    create: (body: ContactInput) => this.req<{ data: any }>('/api/tenant/contacts', { method:'POST', body:JSON.stringify(body) }),
    update: (id: string, body: Partial<ContactInput>) => this.req<{ data: any }>(`/api/tenant/contacts/${id}`, { method:'PATCH', body:JSON.stringify(body) }),
    delete: (id: string) => this.req<{ ok: boolean }>(`/api/tenant/contacts/${id}`, { method:'DELETE' }),
    addNote: (id: string, description: string, type = 'note') =>
      this.req<{ data: any }>(`/api/tenant/contacts/${id}/notes`, { method:'POST', body:JSON.stringify({ description, type }) }),
  };

  // ── Deals ───────────────────────────────────────────────────
  readonly deals = {
    list: (params?: { limit?: number; stage?: string }) => {
      const q = new URLSearchParams(params as any).toString();
      return this.req<{ data: any[]; total: number }>(`/api/tenant/deals?${q}`);
    },
    get: (id: string) => this.req<{ data: any }>(`/api/tenant/deals/${id}`),
    create: (body: DealInput) => this.req<{ data: any }>('/api/tenant/deals', { method:'POST', body:JSON.stringify(body) }),
    update: (id: string, body: Partial<DealInput> & { stage?: string }) => this.req<{ data: any }>(`/api/tenant/deals/${id}`, { method:'PATCH', body:JSON.stringify(body) }),
    delete: (id: string) => this.req<{ ok: boolean }>(`/api/tenant/deals/${id}`, { method:'DELETE' }),
  };

  // ── Tasks ───────────────────────────────────────────────────
  readonly tasks = {
    list: (params?: { limit?: number }) => {
      const q = new URLSearchParams(params as any).toString();
      return this.req<{ data: any[] }>(`/api/tenant/tasks?${q}`);
    },
    create: (body: TaskInput) => this.req<{ data: any }>('/api/tenant/tasks', { method:'POST', body:JSON.stringify(body) }),
    complete: (id: string) => this.req<{ data: any }>(`/api/tenant/tasks/${id}`, { method:'PATCH', body:JSON.stringify({ completed:true }) }),
    delete: (id: string) => this.req<{ ok: boolean }>(`/api/tenant/tasks/${id}`, { method:'DELETE' }),
  };

  // ── Companies ───────────────────────────────────────────────
  readonly companies = {
    list: (params?: { q?: string }) => {
      const q = new URLSearchParams(params as any).toString();
      return this.req<{ data: any[] }>(`/api/tenant/companies?${q}`);
    },
    create: (body: { name: string; industry?: string; website?: string; phone?: string }) =>
      this.req<{ data: any }>('/api/tenant/companies', { method:'POST', body:JSON.stringify(body) }),
    update: (id: string, body: any) => this.req<{ data: any }>(`/api/tenant/companies/${id}`, { method:'PATCH', body:JSON.stringify(body) }),
  };

  // ── Search ──────────────────────────────────────────────────
  readonly search = {
    global: (query: string, type = 'all') =>
      this.req<{ contacts:any[]; deals:any[]; companies:any[]; tasks:any[]; total:number }>(`/api/tenant/search?q=${encodeURIComponent(query)}&type=${type}`),
  };

  // ── Webhooks ────────────────────────────────────────────────
  readonly webhooks = {
    list: () => this.req<{ data: any[] }>('/api/tenant/webhooks'),
    create: (name: string, url: string, events: string[]) =>
      this.req<{ data: any }>('/api/tenant/webhooks', { method:'POST', body:JSON.stringify({ name, url, events }) }),
    delete: (id: string) => this.req<{ ok: boolean }>(`/api/tenant/webhooks/${id}`, { method:'DELETE' }),
  };

  // ── Forms ───────────────────────────────────────────────────
  readonly forms = {
    list: () => this.req<{ data: any[] }>('/api/tenant/forms'),
    submit: (formId: string, data: Record<string,any>) =>
      fetch(`${this.cfg.baseUrl}/api/forms/submit`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ form_id: formId, data }),
      }).then(r => r.json()),
  };

  // ── Automation ──────────────────────────────────────────────
  readonly automation = {
    list: () => this.req<{ data: any[] }>('/api/tenant/automations'),
    create: (body: { name:string; trigger_type:string; actions:any[]; is_active?:boolean }) =>
      this.req<{ data: any }>('/api/tenant/automations', { method:'POST', body:JSON.stringify(body) }),
    toggle: (id: string, is_active: boolean) =>
      this.req<{ data: any }>(`/api/tenant/automations/${id}`, { method:'PATCH', body:JSON.stringify({ is_active }) }),
  };

  // ── Test connection ─────────────────────────────────────────
  async ping(): Promise<{ ok: boolean; tenant?: string; error?: string }> {
    try {
      const data = await this.req<any>('/api/tenant/me');
      return { ok: true, tenant: data.tenant_id };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }
}

export function createNuCRM(config: NuCRMConfig): NuCRMClient {
  return new NuCRMClient(config);
}

export default NuCRMClient;

/**
 * Webhook signature verification helper
 * Use on your server to verify incoming webhooks are from NuCRM.
 */
export function verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
  const expected = 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
  // Constant-time comparison
  if (expected.length !== signature.length) return false;
  let result = 0;
  for (let i = 0; i < expected.length; i++) {
    result |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return result === 0;
}
