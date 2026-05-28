/**
 * NuCRM - Drizzle ORM Relations
 *
 * Defines ORM-level relationships between tables.
 * These do NOT create FK constraints in the database (those already exist).
 * They provide Drizzle's relational query API with knowledge of how tables connect.
 */

import { relations } from 'drizzle-orm';
import { tenants, users } from './core';
import { contacts, companies, deals, leads } from './crm';
import { tasks } from './infra';

// Note: createdBy/updatedBy/deletedBy audit columns are intentionally not mapped
// as relations here. They exist on most tables via the audit() factory but are
// never queried via Drizzle's relational API. Add them per-table if needed.

// ── Tenants Relations ─────────────────────────────────
export const tenantsRelations = relations(tenants, ({ many }) => ({
  contacts: many(contacts),
  companies: many(companies),
  deals: many(deals),
  leads: many(leads),
  tasks: many(tasks),
  users: many(users),
}));

// ── Users Relations ───────────────────────────────────
export const usersRelations = relations(users, () => ({}));

// ── Contacts Relations ────────────────────────────────
export const contactsRelations = relations(contacts, ({ one }) => ({
  tenant: one(tenants, {
    fields: [contacts.tenantId],
    references: [tenants.id],
  }),
  company: one(companies, {
    fields: [contacts.companyId],
    references: [companies.id],
  }),
  assignedUser: one(users, {
    fields: [contacts.assignedTo],
    references: [users.id],
  }),
}));

// ── Companies Relations ───────────────────────────────
export const companiesRelations = relations(companies, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [companies.tenantId],
    references: [tenants.id],
  }),
  contacts: many(contacts),
}));

// ── Deals Relations ───────────────────────────────────
export const dealsRelations = relations(deals, ({ one }) => ({
  tenant: one(tenants, {
    fields: [deals.tenantId],
    references: [tenants.id],
  }),
  contact: one(contacts, {
    fields: [deals.contactId],
    references: [contacts.id],
  }),
  company: one(companies, {
    fields: [deals.companyId],
    references: [companies.id],
  }),
  assignedUser: one(users, {
    fields: [deals.assignedTo],
    references: [users.id],
  }),
}));

// ── Leads Relations ───────────────────────────────────
export const leadsRelations = relations(leads, ({ one }) => ({
  tenant: one(tenants, {
    fields: [leads.tenantId],
    references: [tenants.id],
  }),
  company: one(companies, {
    fields: [leads.companyId],
    references: [companies.id],
  }),
}));

// ── Tasks Relations ───────────────────────────────────
export const tasksRelations = relations(tasks, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tasks.tenantId],
    references: [tenants.id],
  }),
  assignedUser: one(users, {
    fields: [tasks.assignedTo],
    references: [users.id],
  }),
}));
