/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * NuCRM SDK — core CRM entities (contacts, deals, leads, companies, tasks,
 * tickets, meetings, activities) and their Create/Update projections.
 */

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

export type CreateMeeting = Omit<Meeting, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>;
export type UpdateMeeting = Partial<CreateMeeting>;

export type CreateActivity = Omit<Activity, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>;
