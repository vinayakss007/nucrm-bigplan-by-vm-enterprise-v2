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
  | 'company.updated'
  | 'document.created'
  | 'document.updated'
  | 'document.deleted'
  | 'quote.created'
  | 'quote.updated'
  | 'quote.accepted'
  | 'quote.rejected'
  | 'order.created'
  | 'order.updated'
  | 'order.fulfilled'
  | 'order.cancelled'
  | 'contract.created'
  | 'contract.updated'
  | 'contract.signed'
  | 'contract.expired'
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.cancelled'
  | 'subscription.paused'
  | 'subscription.resumed'
  | 'meeting.created'
  | 'meeting.updated'
  | 'meeting.cancelled'
  | 'form.submitted'
  | 'sequence.created'
  | 'sequence.completed'
  | 'sequence.enrolled'
  | 'automation.created'
  | 'automation.triggered'
  | 'automation.completed';

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

export interface Document {
  id: string;
  tenantId: string;
  title: string;
  type: string;
  url: string;
  entityType?: string;
  entityId?: string;
  uploadedBy: string;
  size: number;
  mimeType: string;
  createdAt: string;
  updatedAt: string;
}

export interface QuoteItem {
  description: string;
  quantity: number;
  unitPrice: string;
  total: string;
}

export interface Quote {
  id: string;
  tenantId: string;
  quoteNumber: string;
  dealId?: string;
  contactId?: string;
  status: string;
  totalAmount: string;
  validUntil?: string;
  items: QuoteItem[];
  createdAt: string;
  updatedAt: string;
}

export interface OrderItem {
  description: string;
  quantity: number;
  unitPrice: string;
  total: string;
}

export interface Order {
  id: string;
  tenantId: string;
  orderNumber: string;
  contactId?: string;
  companyId?: string;
  status: string;
  totalAmount: string;
  items: OrderItem[];
  createdAt: string;
  updatedAt: string;
}

export interface Contract {
  id: string;
  tenantId: string;
  title: string;
  contactId?: string;
  companyId?: string;
  status: string;
  startDate?: string;
  endDate?: string;
  value?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Subscription {
  id: string;
  tenantId: string;
  contactId?: string;
  planName: string;
  status: string;
  amount: string;
  interval: string;
  startDate: string;
  nextBillingDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Service {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  price: string;
  duration?: string;
  category?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface Meeting {
  id: string;
  tenantId: string;
  title: string;
  startTime: string;
  endTime: string;
  attendees: string[];
  location?: string;
  status: string;
  dealId?: string;
  contactId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Activity {
  id: string;
  tenantId: string;
  type: string;
  subject: string;
  entityType?: string;
  entityId?: string;
  performedBy: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FormField {
  name: string;
  type: string;
  label: string;
  required?: boolean;
  options?: string[];
}

export interface Form {
  id: string;
  tenantId: string;
  title: string;
  fields: FormField[];
  status: string;
  submissionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface FormSubmission {
  id: string;
  formId: string;
  data: Record<string, unknown>;
  submittedAt: string;
}

export interface SequenceStep {
  type: string;
  delay?: number;
  template?: string;
  config?: Record<string, unknown>;
}

export interface Sequence {
  id: string;
  tenantId: string;
  name: string;
  status: string;
  steps: SequenceStep[];
  enrolledCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationAction {
  type: string;
  config: Record<string, unknown>;
}

export interface Automation {
  id: string;
  tenantId: string;
  name: string;
  trigger: string;
  actions: AutomationAction[];
  status: string;
  runCount: number;
  lastRunAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Report {
  id: string;
  tenantId: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  lastRunAt?: string;
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

export type CreateDocument = Omit<Document, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>;
export type UpdateDocument = Partial<Pick<Document, 'title' | 'type' | 'entityType' | 'entityId'>>;

export type CreateQuote = Omit<Quote, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>;
export type UpdateQuote = Partial<Omit<CreateQuote, 'quoteNumber'>>;

export type CreateOrder = Omit<Order, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>;
export type UpdateOrder = Partial<Omit<CreateOrder, 'orderNumber'>>;

export type CreateContract = Omit<Contract, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>;
export type UpdateContract = Partial<CreateContract>;

export type CreateSubscription = Omit<Subscription, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>;
export type UpdateSubscription = Partial<Pick<Subscription, 'planName' | 'status' | 'amount' | 'interval'>>;

export type CreateService = Omit<Service, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>;
export type UpdateService = Partial<CreateService>;

export type CreateMeeting = Omit<Meeting, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>;
export type UpdateMeeting = Partial<CreateMeeting>;

export type CreateActivity = Omit<Activity, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>;

export type CreateForm = Omit<Form, 'id' | 'tenantId' | 'createdAt' | 'updatedAt' | 'submissionCount'>;
export type UpdateForm = Partial<Pick<Form, 'title' | 'fields' | 'status'>>;

export type CreateSequence = Omit<Sequence, 'id' | 'tenantId' | 'createdAt' | 'updatedAt' | 'enrolledCount'>;
export type UpdateSequence = Partial<Pick<Sequence, 'name' | 'status' | 'steps'>>;

export type CreateAutomation = Omit<Automation, 'id' | 'tenantId' | 'createdAt' | 'updatedAt' | 'runCount' | 'lastRunAt'>;
export type UpdateAutomation = Partial<Pick<Automation, 'name' | 'trigger' | 'actions' | 'status'>>;

export type CreateReport = Omit<Report, 'id' | 'tenantId' | 'createdAt' | 'updatedAt' | 'lastRunAt'>;

// ─── Bulk Operations ────────────────────────────────────────────────────────

export interface BulkCreateResult {
  created: number;
  errors: Array<{ index: number; error: string }>;
}

export interface BulkUpdateResult {
  updated: number;
}

export interface BulkDeleteResult {
  deleted: number;
}

// ─── Search ─────────────────────────────────────────────────────────────────

export type SearchOperator = 'eq' | 'neq' | 'contains' | 'gt' | 'lt' | 'between' | 'in';

export interface SearchFilter {
  field: string;
  operator: SearchOperator;
  value: unknown;
}

export interface SearchResult {
  id: string;
  entityType: string;
  title: string;
  subtitle?: string;
  score: number;
}

export interface SearchOptions {
  entities?: string[];
  limit?: number;
  offset?: number;
}

// ─── File Upload ────────────────────────────────────────────────────────────

export interface FileUploadInput {
  /** File name including extension */
  name: string;
  /**
   * File content as a string. For binary files, this must be base64-encoded.
   * Set `contentEncoding` to 'base64' (the default) so the server knows to decode it.
   */
  content: string;
  /** MIME type of the file (e.g. 'application/pdf', 'image/png') */
  mimeType: string;
  /**
   * Encoding of the content field. Defaults to 'base64'.
   * The server uses this to determine whether to decode the content.
   */
  contentEncoding?: 'base64' | 'utf8';
}

export interface FileUploadResult {
  id: string;
  url: string;
  name: string;
  size: number;
  mimeType: string;
  createdAt: string;
}

export interface FileDownloadResult {
  url: string;
  expiresAt: string;
}

// ─── Realtime Events ────────────────────────────────────────────────────────

export interface RealtimeEvent {
  type: string;
  channel: string;
  data: unknown;
  timestamp: string;
}

export type RealtimeEventHandler = (data: RealtimeEvent) => void;

// ─── Billing / Usage ────────────────────────────────────────────────────────

export interface PlanInfo {
  plan: string;
  limits: Record<string, number>;
  usage: Record<string, number>;
}

export interface LimitCheck {
  allowed: boolean;
  current: number;
  max: number;
}

export interface UsageReport {
  period: string;
  resources: Record<string, { used: number; limit: number }>;
}

// ─── Template / Module ──────────────────────────────────────────────────────

export interface IndustryTemplate {
  id: string;
  name: string;
  description: string;
  modules: string[];
  features: string[];
}

export interface ModuleInfo {
  id: string;
  name: string;
  description: string;
  category: string;
  enabled: boolean;
}

// ─── Internal Request Function Type ─────────────────────────────────────────

export type RequestFn = <T>(
  method: string,
  path: string,
  body?: unknown,
  params?: Record<string, string>
) => Promise<T>;
