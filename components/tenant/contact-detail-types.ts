/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
// Wire shapes actually delivered to the contact detail client: the server page
// (app/tenant/contacts/[id]/page.tsx) and the API routes it fetches from.
export interface ContactDetailData {
  id: string;
  tenant_id: string;
  created_by: string | null;
  assigned_to: string | null;
  company_id: string | null;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  country: string | null;
  website: string | null;
  linkedin_url: string | null;
  tags: string[] | null;
  notes: string | null;
  lead_source: string | null;
  lead_status: string | null;
  score: number | null;
  lifecycle_stage: string | null;
  // jsonb columns infer as `unknown` in Drizzle — the client only round-trips
  // this through the PATCH body, it never reads into it.
  custom_fields: unknown;
  is_archived: boolean | null;
  do_not_contact: boolean | null;
  created_at: string;
  updated_at: string;
  company_name: string | null;
  assigned_name: string | null;
  created_by_name: string | null;
}

export interface ActivityRow {
  id: string;
  type: string;
  description: string;
  created_at: string;
  full_name?: string | null;
  user_id?: string | null;
  metadata?: Record<string, unknown> | null;
  source?: string;
  action?: string | null;
  performed_at?: string;
  performed_by_name?: string | null;
}

export interface ContactDeal {
  id: string;
  title: string;
  stage: string | null;
  value: string | number | null;
  close_date: string | Date | null;
  assigned_to: string | null;
  created_at: string | Date | null;
}

export interface ContactTask {
  id: string;
  title: string;
  description?: string | null;
  priority?: string | null;
  status?: string | null;
  due_date?: string | Date | null;
  completed?: boolean | null;
  completed_at?: string | Date | null;
  assignee_name?: string | null;
}

export interface HistoryEntry {
  id: string;
  fieldName: string;
  fieldLabel: string | null;
  oldValue: string | null;
  newValue: string | null;
  userName: string | null;
  userEmail: string | null;
  createdAt: string | Date;
}

export interface ContactLeadRow {
  id: string;
  lead_oid: string | null;
  product_id: string | null;
  lead_status: string | null;
  lifecycle_stage: string | null;
  score: number;
  value: string | number | null;
  budget: string | number | null;
  budget_currency: string | null;
  timeline: string | null;
  need_description: string | null;
  assigned_name: string | null;
  last_activity_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
  offer_total: string | number;
  offer_currency: string;
  offer_count: number;
}

export interface TicketRow {
  id: string;
  subject: string;
  status: string;
  priority: string | null;
  category: string | null;
  createdAt: string | Date;
}

export interface FollowUpRow {
  id: string;
  title: string;
  description: string | null;
  dueDate: string | Date | null;
  status: string;
  missedDays: number | null;
  completedAt: string | Date | null;
  assignee_name: string | null;
}

export interface BillingDoc {
  id: string;
  status: string | null;
  createdAt: string | Date;
  title?: string | null;
  name?: string | null;
  invoiceNumber?: string | null;
  orderNumber?: string | null;
  contractNumber?: string | null;
  quoteNumber?: string | null;
  totalAmount?: string | number | null;
  totalValue?: string | number | null;
  amount?: string | number | null;
}

export interface CallLogRow {
  id: string;
  contactId: string | null;
  direction: string;
  duration: number | null;
  notes: string | null;
  phoneNumber: string | null;
  createdAt: string | Date;
  userName: string | null;
}
