import { pgTable, uuid, text, index, uniqueIndex, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import * as utils from './utils';

/**
 * Arbitrary "related to" associations between any two records.
 *
 * WHY BOTH THIS AND REAL FK COLUMNS
 * ---------------------------------
 * Relationships in this CRM fall into two groups, and they want different
 * storage:
 *
 *   Domain-core        e.g. task -> company, ticket -> deal, invoice -> deal.
 *                      These are queried constantly, drive reporting, and must
 *                      be enforced by the database. They get real nullable FK
 *                      columns on the owning table.
 *
 *   Incidental         e.g. "this ticket also relates to that document", "this
 *                      meeting relates to those three deals". Open-ended, sparse,
 *                      and unbounded in kind. Modelling each as its own column
 *                      would mean a schema migration every time someone wants a
 *                      new pairing.
 *
 * Adding columns for everything gives ~20 more nullable columns today and a
 * migration per relationship forever. Making everything polymorphic throws away
 * referential integrity on the paths that matter most. So: columns for the
 * former, this table for the latter — the same split Salesforce and HubSpot use.
 *
 * TRADE-OFF, STATED PLAINLY
 * The endpoints here cannot carry foreign keys, because a single column cannot
 * reference several tables. Integrity is therefore enforced by:
 *   - an entity-type allowlist (CHECK), so a typo cannot invent an entity kind
 *   - tenant scoping, so links can never cross a tenant boundary
 *   - application-level existence checks in lib/record-links.ts
 * Orphans are still possible if a target row is hard-deleted. Everything
 * user-facing here is soft-deleted, and `npm run db:verify-isolation` is the
 * place to add an orphan sweep if that changes.
 */

/** Entity kinds that may appear at either end of a link. */
export const LINKABLE_ENTITY_TYPES = [
  'contact',
  'company',
  'lead',
  'deal',
  'task',
  'ticket',
  'quote',
  'order',
  'invoice',
  'contract',
  'product',
  'service',
  'project',
  'document',
  'meeting',
  'activity',
] as const;

export type LinkableEntityType = (typeof LINKABLE_ENTITY_TYPES)[number];

/** How the two records relate. `related` is the neutral default. */
export const LINK_RELATIONS = [
  'related',
  'blocks',
  'blocked_by',
  'duplicate_of',
  'parent_of',
  'child_of',
  'caused_by',
  'resolves',
] as const;

export type LinkRelation = (typeof LINK_RELATIONS)[number];

const entityTypeList = LINKABLE_ENTITY_TYPES.map((t) => `'${t}'`).join(', ');
const relationList = LINK_RELATIONS.map((r) => `'${r}'`).join(', ');

export const recordLinks = pgTable('record_links', {
  id: utils.pk(),
  tenantId: utils.tenantId(),

  fromType: text('from_type').notNull(),
  fromId: uuid('from_id').notNull(),
  toType: text('to_type').notNull(),
  toId: uuid('to_id').notNull(),

  relation: text('relation').notNull().default('related'),
  note: text('note'),

  ...utils.audit(),
}, (table) => ({
  // Look-ups always start from one end and ask for everything attached to it.
  fromIdx: index('idx_record_links_from').on(table.tenantId, table.fromType, table.fromId),
  toIdx: index('idx_record_links_to').on(table.tenantId, table.toType, table.toId),

  // One link per (pair, relation). Makes linking idempotent, so a double-click
  // cannot produce two identical rows.
  uniquePair: uniqueIndex('idx_record_links_unique').on(
    table.tenantId,
    table.fromType,
    table.fromId,
    table.toType,
    table.toId,
    table.relation
  ),

  // Without FKs on the endpoints these CHECKs are the only thing stopping an
  // unknown entity kind or relation from being persisted.
  fromTypeValid: check('record_links_from_type_valid', sql.raw(`from_type IN (${entityTypeList})`)),
  toTypeValid: check('record_links_to_type_valid', sql.raw(`to_type IN (${entityTypeList})`)),
  relationValid: check('record_links_relation_valid', sql.raw(`relation IN (${relationList})`)),

  // A record relating to itself is always a mistake.
  notSelf: check(
    'record_links_not_self',
    sql`NOT (from_type = to_type AND from_id = to_id)`
  ),
}));

export type RecordLink = typeof recordLinks.$inferSelect;
export type NewRecordLink = typeof recordLinks.$inferInsert;
