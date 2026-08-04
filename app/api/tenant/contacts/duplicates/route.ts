import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contacts } from '@/drizzle/schema';
import { sql, inArray } from 'drizzle-orm';

/**
 * GET /api/tenant/contacts/duplicates
 * Find potential duplicate contacts based on email, phone, or name similarity.
 *
 * Returns groups of contacts that likely represent the same person.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const tid = ctx.tenantId;

    // Strategy 1: Exact email duplicates (most reliable)
    const emailDupes = await db.execute(sql`
      SELECT LOWER(email) as email, array_agg(id) as contact_ids, count(*) as cnt
      FROM contacts
      WHERE tenant_id = ${tid}
        AND deleted_at IS NULL
        AND email IS NOT NULL
        AND email != ''
      GROUP BY LOWER(email)
      HAVING count(*) > 1
      ORDER BY count(*) DESC
      LIMIT 50
    `);

    // Strategy 2: Exact phone duplicates
    const phoneDupes = await db.execute(sql`
      SELECT phone, array_agg(id) as contact_ids, count(*) as cnt
      FROM contacts
      WHERE tenant_id = ${tid}
        AND deleted_at IS NULL
        AND phone IS NOT NULL
        AND phone != ''
      GROUP BY phone
      HAVING count(*) > 1
      ORDER BY count(*) DESC
      LIMIT 30
    `);

    // Strategy 3: Same first_name + last_name (fuzzy — could be different people)
    const nameDupes = await db.execute(sql`
      SELECT LOWER(first_name || ' ' || COALESCE(last_name, '')) as full_name,
             array_agg(id) as contact_ids, count(*) as cnt
      FROM contacts
      WHERE tenant_id = ${tid}
        AND deleted_at IS NULL
        AND first_name IS NOT NULL
      GROUP BY LOWER(first_name || ' ' || COALESCE(last_name, ''))
      HAVING count(*) > 1
      ORDER BY count(*) DESC
      LIMIT 30
    `);

    // Deduplicate groups (same contacts may appear in multiple strategies)
    const seen = new Set<string>();
     
    const groups: Array<{ match_type: string; match_value: string; contact_ids: string[]; count: number }> = [];

    for (const row of emailDupes.rows as Array<{ email: string; contact_ids: string[]; cnt: number }>) {
      const key = (row.contact_ids || []).sort().join(',');
      if (!seen.has(key)) {
        seen.add(key);
        groups.push({ match_type: 'email', match_value: row.email, contact_ids: row.contact_ids, count: Number(row.cnt) });
      }
    }

    for (const row of phoneDupes.rows as Array<{ phone: string; contact_ids: string[]; cnt: number }>) {
      const key = (row.contact_ids || []).sort().join(',');
      if (!seen.has(key)) {
        seen.add(key);
        groups.push({ match_type: 'phone', match_value: row.phone, contact_ids: row.contact_ids, count: Number(row.cnt) });
      }
    }

    for (const row of nameDupes.rows as Array<{ full_name: string; contact_ids: string[]; cnt: number }>) {
      const key = (row.contact_ids || []).sort().join(',');
      if (!seen.has(key)) {
        seen.add(key);
        groups.push({ match_type: 'name', match_value: row.full_name, contact_ids: row.contact_ids, count: Number(row.cnt) });
      }
    }

    // Fetch details for the first 10 groups to show in UI
    const topGroups = groups.slice(0, 20);
    const allIds = [...new Set(topGroups.flatMap(g => g.contact_ids))];

    let contactDetails: Array<{ id: string; firstName: string | null; lastName: string | null; email: string | null; phone: string | null; createdAt: Date }> = [];
    if (allIds.length > 0) {
      contactDetails = await db
        .select({
          id: contacts.id,
          firstName: contacts.firstName,
          lastName: contacts.lastName,
          email: contacts.email,
          phone: contacts.phone,
          createdAt: contacts.createdAt,
        })
        .from(contacts)
        .where(inArray(contacts.id, allIds));
    }

    const contactMap = new Map(contactDetails.map(c => [c.id, c]));

    const enrichedGroups = topGroups.map(g => ({
      ...g,
      contacts: g.contact_ids.map(id => contactMap.get(id)).filter(Boolean),
    }));

    return NextResponse.json({
      data: {
        groups: enrichedGroups,
        total_duplicate_groups: groups.length,
        total_duplicate_contacts: [...new Set(groups.flatMap(g => g.contact_ids))].length,
      },
    });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
}
