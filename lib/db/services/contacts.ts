import { db } from '@/drizzle/db';
import { contacts, companies, users } from '@/drizzle/schema';
import { eq, and, or, ilike, desc, sql } from 'drizzle-orm';

export interface GetContactsOptions {
  tenantId: string;
  userId?: string;
  viewAll?: boolean;
  q?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

/**
 * Fetch contacts with filtering and pagination
 * Centralized service to be used by both API and Server Components
 * Updated to use Drizzle ORM
 */
export async function getContacts(opts: GetContactsOptions) {
  const { tenantId, userId, viewAll = true, q, status = 'all', limit = 50, offset = 0 } = opts;
  
  const filters = [
    eq(contacts.tenantId, tenantId),
    sql`${contacts.deletedAt} IS NULL`
  ];

  if (!viewAll && userId) {
    const orClause = or(
      eq(contacts.assignedTo, userId),
      eq(contacts.createdBy, userId)
    );
    if (orClause) filters.push(orClause);
  }

  if (q) {
    const searchPattern = `%${q}%`;
    const orClause = or(
      ilike(contacts.firstName, searchPattern),
      ilike(contacts.lastName, searchPattern),
      ilike(contacts.email, searchPattern),
      ilike(companies.name, searchPattern),
      sql`${contacts.tags}::text ILIKE ${searchPattern}`
    );
    if (orClause) filters.push(orClause);
  }

  if (status !== 'all') {
    filters.push(eq(contacts.leadStatus, status));
  }

  const whereClause = and(...filters);

  const [results, totalCountResult] = await Promise.all([
    db.select({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      email: contacts.email,
      phone: contacts.phone,
      leadStatus: contacts.leadStatus,
      leadSource: contacts.leadSource,
      score: contacts.score,
      tags: contacts.tags,
      city: contacts.city,
      country: contacts.country,
      createdAt: contacts.createdAt,
      lastActivityAt: contacts.lastActivityAt,
      assignedTo: contacts.assignedTo,
      doNotContact: contacts.doNotContact,
      lifecycleStage: contacts.lifecycleStage,
      companyName: companies.name,
      assignedName: users.fullName,
    })
    .from(contacts)
    .leftJoin(companies, eq(companies.id, contacts.companyId))
    .leftJoin(users, eq(users.id, contacts.assignedTo))
    .where(whereClause)
    .orderBy(desc(contacts.createdAt))
    .limit(limit)
    .offset(offset),

    db.select({ count: sql<number>`count(*)` })
      .from(contacts)
      .leftJoin(companies, eq(companies.id, contacts.companyId))
      .where(whereClause)
      .then(res => Number(res[0]?.count || 0))
  ]);

  return {
    contacts: results,
    total: totalCountResult,
  };
}
