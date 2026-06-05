import { uniqueIndex, pgTable, uuid, text, timestamp, jsonb, decimal, integer, boolean, index, date } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import * as utils from './utils';
import { tenants as _tenants, users as _users } from './core';
import { companies as _companies, contacts as _contacts } from './crm';

// Aliases to match existing references in table definitions
const tenants = _tenants;
const users = _users;
const companies = _companies;
const contacts = _contacts;

// ── SERVICES MODULE ─────────────────────────────────────
export const services = pgTable('services', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'set null' }),
  
  name: text('name').notNull(),
  description: text('description'),
  category: text('category'),
  
  pricingType: text('pricing_type').notNull().default('fixed'),
  unitPrice: decimal('unit_price', { precision: 15, scale: 2 }),
  hourlyRate: decimal('hourly_rate', { precision: 15, scale: 2 }),
  monthlyPrice: decimal('monthly_price', { precision: 15, scale: 2 }),
  yearlyPrice: decimal('yearly_price', { precision: 15, scale: 2 }),
  
  taxRate: decimal('tax_rate', { precision: 5, scale: 2 }).default('0'),
  taxable: boolean('taxable').default(true),
  currency: text('currency').default('USD'),
  
  isActive: boolean('is_active').default(true),
  isFeatured: boolean('is_featured').default(false),
  
  durationMinutes: integer('duration_minutes'),
  durationHours: integer('duration_hours'),
  imageUrl: text('image_url'),
  
  timesUsed: integer('times_used').default(0),
  totalRevenue: decimal('total_revenue', { precision: 15, scale: 2 }).default('0'),
  
  tags: text('tags').array().default(sql`'{}'`),
  customFields: jsonb('custom_fields').default({}),
  metadata: utils.metadata(),
  
  ...utils.audit(),
}, (table) => ({
  tenantIdx: utils.tenantIdx(table),
  nameIdx: index('idx_services_name').on(table.name),
  categoryIdx: index('idx_services_category').on(table.category),
  contactIdx: index('idx_services_contact').on(table.contactId),
  companyIdx: index('idx_services_company').on(table.companyId),
  activeIdx: utils.activeIdx(table),
}));

export const serviceCategories = pgTable('service_categories', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  name: text('name').notNull(),
  description: text('description'),
  color: text('color').default('#6366f1'),
  icon: text('icon'),
  sortOrder: integer('sort_order').default(0),
  ...utils.audit(),
}, (table) => ({
  tenantIdx: utils.tenantIdx(table),
  nameIdx: index('idx_service_categories_name').on(table.name),
}));

// ── INVOICES MODULE ─────────────────────────────────────
export const invoices = pgTable('invoices', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'set null' }),
  
  invoiceNumber: text('invoice_number').notNull(),
  title: text('title'),
  status: text('status').notNull().default('draft'),
  
  issueDate: date('issue_date').notNull(),
  dueDate: date('due_date'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  
  subtotal: decimal('subtotal', { precision: 15, scale: 2 }).notNull().default('0'),
  discountType: text('discount_type').default('percentage'),
  discountValue: decimal('discount_value', { precision: 15, scale: 2 }).default('0'),
  discountAmount: decimal('discount_amount', { precision: 15, scale: 2 }).default('0'),
  taxAmount: decimal('tax_amount', { precision: 15, scale: 2 }).default('0'),
  taxRate: decimal('tax_rate', { precision: 5, scale: 2 }).default('0'),
  totalAmount: decimal('total_amount', { precision: 15, scale: 2 }).notNull().default('0'),
  amountPaid: decimal('amount_paid', { precision: 15, scale: 2 }).default('0'),
  balanceDue: decimal('balance_due', { precision: 15, scale: 2 }).default('0'),
  
  currency: text('currency').default('USD'),
  
  notes: text('notes'),
  terms: text('terms'),
  footer: text('footer'),
  
  quoteId: uuid('quote_id'),
  orderId: uuid('order_id'),
  
  paymentMethod: text('payment_method'),
  paymentReference: text('payment_reference'),
  
  isRecurring: boolean('is_recurring').default(false),
  recurringFrequency: text('recurring_frequency'),
  nextBillingDate: date('next_billing_date'),
  parentInvoiceId: uuid('parent_invoice_id'),
  
  sentReminder: boolean('sent_reminder').default(false),
  metadata: utils.metadata(),
  
  ...utils.audit(),
}, (table) => ({
  tenantIdx: utils.tenantIdx(table),
  invoiceNumberIdx: uniqueIndex('idx_invoices_number').on(table.tenantId, table.invoiceNumber),
  contactIdx: index('idx_invoices_contact').on(table.contactId),
  companyIdx: index('idx_invoices_company').on(table.companyId),
  statusIdx: index('idx_invoices_status').on(table.tenantId, table.status),
  dueDateIdx: index('idx_invoices_due_date').on(table.dueDate),
  activeIdx: utils.activeIdx(table),
}));

export const invoiceLineItems = pgTable('invoice_line_items', {
  id: utils.pk(),
  invoiceId: uuid('invoice_id').notNull(),
  productId: uuid('product_id'),
  serviceId: uuid('service_id'),
  description: text('description').notNull(),
  itemType: text('item_type').notNull(),
  quantity: decimal('quantity', { precision: 15, scale: 4 }).notNull().default('1'),
  unitPrice: decimal('unit_price', { precision: 15, scale: 2 }).notNull(),
  discountType: text('discount_type').default('percentage'),
  discountValue: decimal('discount_value', { precision: 15, scale: 2 }).default('0'),
  discountAmount: decimal('discount_amount', { precision: 15, scale: 2 }).default('0'),
  taxRate: decimal('tax_rate', { precision: 5, scale: 2 }).default('0'),
  taxAmount: decimal('tax_amount', { precision: 15, scale: 2 }).default('0'),
  total: decimal('total', { precision: 15, scale: 2 }).notNull(),
  sortOrder: integer('sort_order').default(0),
  ...utils.lifecycle(),
}, (table) => ({
  invoiceIdx: index('idx_invoice_line_items_invoice').on(table.invoiceId),
}));

export const invoicePayments = pgTable('invoice_payments', {
  id: utils.pk(),
  invoiceId: uuid('invoice_id').notNull(),
  amount: decimal('amount', { precision: 15, scale: 2 }).notNull(),
  paymentDate: date('payment_date').notNull(),
  paymentMethod: text('payment_method'),
  reference: text('reference'),
  notes: text('notes'),
  recordedBy: uuid('recorded_by'),
  ...utils.audit(),
}, (table) => ({
  invoiceIdx: index('idx_invoice_payments_invoice').on(table.invoiceId),
  dateIdx: index('idx_invoice_payments_date').on(table.paymentDate),
}));

// ── ORDERS MODULE ─────────────────────────────────────
export const orders = pgTable('orders', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'set null' }),
  
  orderNumber: text('order_number').notNull(),
  title: text('title'),
  status: text('status').notNull().default('draft'),
  
  orderDate: date('order_date').notNull(),
  expectedDeliveryDate: date('expected_delivery_date'),
  shippedAt: timestamp('shipped_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  
  subtotal: decimal('subtotal', { precision: 15, scale: 2 }).notNull().default('0'),
  discountAmount: decimal('discount_amount', { precision: 15, scale: 2 }).default('0'),
  taxAmount: decimal('tax_amount', { precision: 15, scale: 2 }).default('0'),
  shippingAmount: decimal('shipping_amount', { precision: 15, scale: 2 }).default('0'),
  totalAmount: decimal('total_amount', { precision: 15, scale: 2 }).notNull().default('0'),
  
  shippingAddress: text('shipping_address'),
  shippingCity: text('shipping_city'),
  shippingState: text('shipping_state'),
  shippingCountry: text('shipping_country'),
  shippingPostalCode: text('shipping_postal_code'),
  trackingNumber: text('tracking_number'),
  shippingCarrier: text('shipping_carrier'),
  
  billingAddress: text('billing_address'),
  billingCity: text('billing_city'),
  billingState: text('billing_state'),
  billingCountry: text('billing_country'),
  billingPostalCode: text('billing_postal_code'),
  
  notes: text('notes'),
  customerNotes: text('customer_notes'),
  
  quoteId: uuid('quote_id'),
  invoiceId: uuid('invoice_id'),
  
  metadata: utils.metadata(),
  ...utils.audit(),
}, (table) => ({
  tenantIdx: utils.tenantIdx(table),
  orderNumberIdx: uniqueIndex('idx_orders_number').on(table.tenantId, table.orderNumber),
  contactIdx: index('idx_orders_contact').on(table.contactId),
  companyIdx: index('idx_orders_company').on(table.companyId),
  statusIdx: index('idx_orders_status').on(table.tenantId, table.status),
  activeIdx: utils.activeIdx(table),
}));

export const orderLineItems = pgTable('order_line_items', {
  id: utils.pk(),
  orderId: uuid('order_id').notNull(),
  productId: uuid('product_id'),
  serviceId: uuid('service_id'),
  description: text('description').notNull(),
  itemType: text('item_type').notNull(),
  quantity: decimal('quantity', { precision: 15, scale: 4 }).notNull().default('1'),
  unitPrice: decimal('unit_price', { precision: 15, scale: 2 }).notNull(),
  total: decimal('total', { precision: 15, scale: 2 }).notNull(),
  sortOrder: integer('sort_order').default(0),
  ...utils.lifecycle(),
}, (table) => ({
  orderIdx: index('idx_order_line_items_order').on(table.orderId),
}));

// ── CONTRACTS MODULE ────────────────────────────────────
export const contracts = pgTable('contracts', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'set null' }),
  
  title: text('title').notNull(),
  contractNumber: text('contract_number'),
  contractType: text('contract_type').notNull(),
  status: text('status').notNull().default('draft'),
  
  startDate: date('start_date').notNull(),
  endDate: date('end_date'),
  signedAt: timestamp('signed_at', { withTimezone: true }),
  renewedAt: timestamp('renewed_at', { withTimezone: true }),
  
  totalValue: decimal('total_value', { precision: 15, scale: 2 }),
  billingFrequency: text('billing_frequency'),
  
  terms: text('terms'),
  notes: text('notes'),
  documentUrl: text('document_url'),
  
  parentContractId: uuid('parent_contract_id'),
  
  metadata: utils.metadata(),
  ...utils.audit(),
}, (table) => ({
  tenantIdx: utils.tenantIdx(table),
  contactIdx: index('idx_contracts_contact').on(table.contactId),
  companyIdx: index('idx_contracts_company').on(table.companyId),
  statusIdx: index('idx_contracts_status').on(table.tenantId, table.status),
  activeIdx: utils.activeIdx(table),
}));

// ── SUBSCRIPTIONS MODULE ───────────────────────────────
// Renamed: Was conflicting with infra.subscriptions
// This table tracks service/product subscriptions (e.g., monthly hosting)
export const serviceSubscriptions = pgTable('service_subscriptions', {
  id: utils.pk(),
  tenantId: utils.tenantId(),

  contactId: uuid('contact_id'),
  companyId: uuid('company_id'),

  name: text('name').notNull(),
  planName: text('plan_name'),
  status: text('status').notNull().default('active'),

  startDate: date('start_date').notNull(),
  currentPeriodStart: date('current_period_start'),
  currentPeriodEnd: date('current_period_end'),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  trialEndDate: date('trial_end_date'),

  amount: decimal('amount', { precision: 15, scale: 2 }).notNull(),
  currency: text('currency').default('USD'),
  billingFrequency: text('billing_frequency').notNull(),

  autoRenew: boolean('auto_renew').default(true),
  paymentMethod: text('payment_method'),
  last4: text('last4'),

  metadata: utils.metadata(),
  ...utils.audit(),
}, (table) => ({
  tenantIdx: utils.tenantIdx(table),
  contactIdx: index('idx_service_subscriptions_contact').on(table.contactId),
  companyIdx: index('idx_service_subscriptions_company').on(table.companyId),
  statusIdx: index('idx_service_subscriptions_status').on(table.tenantId, table.status),
  activeIdx: utils.activeIdx(table),
}));