/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Service layer for arbitrary record-to-record links.
 *
 * `record_links` stores polymorphic endpoints, so PostgreSQL cannot foreign-key
 * them. This module is where the integrity a foreign key would have given us is
 * enforced instead:
 *
 *   - the entity type is on an allowlist (also a CHECK constraint)
 *   - the target row actually exists
 *   - the target row belongs to the SAME tenant as the link
 *
 * The tenant check is the important one. Without it a caller could link one
 * tenant's ticket to another tenant's deal, and every "related records" panel
 * would then happily render across the boundary.
 */

import { db } from '@/drizzle/db';
import {
  recordLinks,
  LINKABLE_ENTITY_TYPES,
  LINK_RELATIONS,
  type LinkableEntityType,
  type LinkRelation,
} from '@/drizzle/schema/record-links';
import { and, eq, isNull, or, sql } from 'drizzle-orm';

/**
 * Physical table backing each entity type. Values are checked against
 * LINKABLE_ENTITY_TYPES before use and never taken from user input directly, so
 * they cannot be used to reach an arbitrary table.
 */
const ENTITY_TABLES: Record<LinkableEntityType, string> = {
  contact: 'contacts',
  company: 'companies',
  lead: 'leads',
  deal: 'deals',
  task: 'tasks',
  ticket: 'support_tickets',
  quote: 'quotes',
  order: 'orders',
  invoice: 'invoices',
  contract: 'contracts',
  product: 'products',
  service: 'services',
  project: 'projects',
  document: 'documents',
  meeting: 'meetings',
  activity: 'activities',
};

export class RecordLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecordLinkError';
  }
}

export function isLinkableEntityType(value: string): value is LinkableEntityType {
  return (LINKABLE_ENTITY_TYPES as readonly string[]).includes(value);
}

export function isLinkRelation(value: string): value is LinkRelation {
  return (LINK_RELATIONS as readonly string[]).includes(value);
}

/**
 * Confirm a record exists and belongs to `tenantId`.
 *
 * Uses sql.identifier for the table name, and only ever with a value resolved
 * from ENTITY_TABLES via a validated entity type, so the name can never come
 * from a request.
 */
async function assertRecordInTenant(
  tenantId: string,
  entityType: LinkableEntityType,
  entityId: string
): Promise<void> {
  const table = ENTITY_TABLES[entityType];

  const result = await db.execute<{ exists: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM ${sql.identifier(table)}
       WHERE id = ${entityId} AND tenant_id = ${tenantId}
    ) AS exists
  `);

  const found = (result.rows?.[0] as { exists?: boolean } | undefined)?.exists;
  if (!found) {
    // Deliberately does not distinguish "missing" from "belongs to another
    // tenant" — that difference would confirm the existence of another tenant's
    // record id.
    throw new RecordLinkError(`No ${entityType} ${entityId} in this tenant`);
  }
}

export interface LinkInput {
  tenantId: string;
  fromType: string;
  fromId: string;
  toType: string;
  toId: string;
  relation?: string;
  note?: string | null;
  userId?: string;
}

/**
 * Create a link between two records. Idempotent: repeating the same
 * (pair, relation) returns the existing row rather than duplicating it.
 */
export async function linkRecords(input: LinkInput) {
  const { tenantId, fromId, toId, note, userId } = input;
  const relation = input.relation ?? 'related';

  if (!isLinkableEntityType(input.fromType)) {
    throw new RecordLinkError(`Unsupported entity type: ${input.fromType}`);
  }
  if (!isLinkableEntityType(input.toType)) {
    throw new RecordLinkError(`Unsupported entity type: ${input.toType}`);
  }
  if (!isLinkRelation(relation)) {
    throw new RecordLinkError(`Unsupported relation: ${relation}`);
  }
  if (input.fromType === input.toType && fromId === toId) {
    throw new RecordLinkError('A record cannot be linked to itself');
  }

  const fromType = input.fromType;
  const toType = input.toType;

  // Both ends must exist in this tenant before anything is written.
  await Promise.all([
    assertRecordInTenant(tenantId, fromType, fromId),
    assertRecordInTenant(tenantId, toType, toId),
  ]);

  const [row] = await db
    .insert(recordLinks)
    .values({ tenantId, fromType, fromId, toType, toId, relation, note: note ?? null, createdBy: userId })
    .onConflictDoNothing()
    .returning();

  if (row) return row;

  // onConflictDoNothing returned nothing, so an identical link already exists.
  const existing = await db.query.recordLinks?.findFirst({
    where: and(
      eq(recordLinks.tenantId, tenantId),
      eq(recordLinks.fromType, fromType),
      eq(recordLinks.fromId, fromId),
      eq(recordLinks.toType, toType),
      eq(recordLinks.toId, toId),
      eq(recordLinks.relation, relation)
    ),
  });

  if (!existing) {
    throw new RecordLinkError('Link could not be created or found');
  }
  return existing;
}

/**
 * Every record linked to the given one, in either direction.
 *
 * Links are conceptually undirected for display purposes: a ticket linked to a
 * deal should appear on the deal too. Returning only rows where the record is
 * `from` would make half of them invisible depending on who created the link.
 */
export async function getLinkedRecords(
  tenantId: string,
  entityType: string,
  entityId: string
) {
  if (!isLinkableEntityType(entityType)) {
    throw new RecordLinkError(`Unsupported entity type: ${entityType}`);
  }

  const rows = await db
    .select()
    .from(recordLinks)
    .where(
      and(
        eq(recordLinks.tenantId, tenantId),
        isNull(recordLinks.deletedAt),
        or(
          and(eq(recordLinks.fromType, entityType), eq(recordLinks.fromId, entityId)),
          and(eq(recordLinks.toType, entityType), eq(recordLinks.toId, entityId))
        )
      )
    );

  // Normalise so the caller always sees the *other* end, whichever side it was
  // stored on.
  return rows.map((row) => {
    const isFrom = row.fromType === entityType && row.fromId === entityId;
    return {
      linkId: row.id,
      relation: row.relation as LinkRelation,
      note: row.note,
      entityType: (isFrom ? row.toType : row.fromType) as LinkableEntityType,
      entityId: isFrom ? row.toId : row.fromId,
      createdAt: row.createdAt,
    };
  });
}

/** Soft-delete a link. Returns false when it does not exist in this tenant. */
export async function unlinkRecords(
  tenantId: string,
  linkId: string,
  userId?: string
): Promise<boolean> {
  const [row] = await db
    .update(recordLinks)
    .set({ deletedAt: new Date(), deletedBy: userId ?? null })
    .where(
      and(
        eq(recordLinks.id, linkId),
        eq(recordLinks.tenantId, tenantId),
        isNull(recordLinks.deletedAt)
      )
    )
    .returning({ id: recordLinks.id });

  return Boolean(row);
}
