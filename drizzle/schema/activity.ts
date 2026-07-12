import { pgTable, uuid, text, index } from 'drizzle-orm/pg-core';
import { users } from './core';
import { contacts, deals, companies } from './crm';
import * as utils from './utils';

export const activities = pgTable('activities', {
  id: utils.pk(),
  tenantId: utils.tenantId(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),

  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),

  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'cascade' }),
  dealId: uuid('deal_id').references(() => deals.id, { onDelete: 'cascade' }),
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }),

  eventType: text('event_type').notNull(),
  action: text('action'),
  description: text('description'),

  metadata: utils.metadata(),

  ...utils.lifecycle(),
}, (table) => {
  return {
    tenantIdx: utils.tenantIdx(table),
    entityIdx: index('idx_activities_entity').on(table.entityType, table.entityId),
    contactIdx: index('idx_activities_contact').on(table.contactId),
    dealIdx: index('idx_activities_deal').on(table.dealId),
    metadataGinIdx: utils.metadataIdx(table),
  };
});
