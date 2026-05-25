/**
 * NuCRM SDK - Shared Types
 *
 * Types for all CRM resources, pagination, errors, and webhook events.
 */

// ─── Pagination ─────────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface ListOptions {
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
  search?: string;
  filters?: Record<string, unknown>;
}

// ─── Error ──────────────────────────────────────────────────────────────────

export interface ApiError {
  error: string;
  code?: string;
  status: number;
  details?: Record<string, unknown>;
}

// ─── Webhook ────────────────────────────────────────────────────────────────

export type WebhookEventType =
  | 'contact.created'
  | 'contact.updated'
  | 'contact.deleted'
  | 'deal.created'
  | 'deal.updated'
  | 'deal.won'
  | 'deal.lost'
  | 'lead.created'
  | 'lead.converted'
  | 'task.created'
  | 'task.completed'
  | 'ticket.created'
  | 'ticket.resolved'
  | 'invoice.created'
  | 'invoice.paid'
  | 'company.created'
  | 'company.updated';

export interface WebhookPayload<T = unknown> {
  event: WebhookEventType;
  timestamp: string;
  tenant_id: string;
  data: T;
  previous_data?: T;
}

// ─── Resource Types ─────────────────────────────────────────────────────────

export interface Contact {
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  companyId?: string;
  assignedTo?: string;
  leadSource?: string;
  leadStatus?: string;
  lifecycleStage?: string;
  score?: number;
  tags?: string[];
  customFields?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Deal {
  id: string;
  tenantId: string;
  title: string;
  amount?: string;
  contactId?: string;
  companyId?: string;
  pipelineId?: string;
  stageId: string;
  assignedTo?: string;
  closeDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Lead {
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  companyName?: string;
  source?: string;
  leadStatus: string;
  score: number;
  assignedTo?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Company {
  id: string;
  tenantId: string;
  name: string;
  domain?: string;
  industry?: string;
  companySize?: string;
  website?: string;
  phone?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  tenantId: string;
  title: string;
  description?: string;
  priority: string;
  status: string;
  dueDate?: string;
  assignedTo?: string;
  contactId?: string;
  dealId?: string;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Ticket {
  id: string;
  tenantId: string;
  subject: string;
  description?: string;
  status: string;
  priority: string;
  contactId?: string;
  assignedTo?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Invoice {
  id: string;
  tenantId: string;
  invoiceNumber: string;
  contactId?: string;
  companyId?: string;
  status: string;
  totalAmount: string;
  amountPaid: string;
  balanceDue: string;
  issueDate: string;
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Create/Update Types ────────────────────────────────────────────────────

export type CreateContact = Omit<Contact, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>;
export type UpdateContact = Partial<CreateContact>;

export type CreateDeal = Omit<Deal, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>;
export type UpdateDeal = Partial<CreateDeal>;

export type CreateLead = Omit<Lead, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>;
export type UpdateLead = Partial<CreateLead>;

export type CreateCompany = Omit<Company, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>;
export type UpdateCompany = Partial<CreateCompany>;

export type CreateTask = Omit<Task, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>;
export type UpdateTask = Partial<CreateTask>;

export type CreateTicket = Omit<Ticket, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>;
export type UpdateTicket = Partial<CreateTicket>;

export type CreateInvoice = Omit<Invoice, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>;
export type UpdateInvoice = Partial<CreateInvoice>;

// ─── Internal Request Function Type ─────────────────────────────────────────

export type RequestFn = <T>(
  method: string,
  path: string,
  body?: unknown,
  params?: Record<string, string>
) => Promise<T>;
