/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * NuCRM SDK — sales & billing entities (invoices, documents, quotes, orders,
 * contracts, subscriptions, services) and their Create/Update projections.
 */

// ─── Resource Types ─────────────────────────────────────────────────────────

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

// ─── Create/Update Types ────────────────────────────────────────────────────

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
