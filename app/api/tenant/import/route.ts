/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contacts, companies, leads, tenants, plans } from '@/drizzle/schema';
import { eq, sql } from 'drizzle-orm';
import { rateLimitMutating } from '@/lib/api/mutating-rate-limit';
import { readJsonBody } from '@/lib/api/validate';
import { withApiRoute } from '@/lib/api/with-api-route';

/** The transaction handle drizzle gives this route, so a savepoint can be threaded. */
type ImportTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * POST /api/tenant/import
 * Import records from CSV data (parsed client-side, sent as JSON array).
 *
 * Body: { entity: 'contacts'|'companies'|'leads', records: Array<Record<string, string>> }
 * Each record is a flat object with column headers as keys.
 *
 * Returns: { imported: number, errors: Array<{ row: number, error: string }> }
 */
export const POST = withApiRoute(async (request: NextRequest) => {
  try {
    const limited = await rateLimitMutating(request, 'import', 'post');
    if (limited) return limited;

    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'settings.manage');
    if (deny) return deny;

    const body = await readJsonBody(request);
    const { entity, records } = body as { entity: string; records: Array<Record<string, string>> };

    if (!entity || !records || !Array.isArray(records)) {
      return NextResponse.json({ error: 'entity and records[] required' }, { status: 400 });
    }

    const validEntities = ['contacts', 'companies', 'leads'];
    if (!validEntities.includes(entity)) {
      return NextResponse.json({ error: `Invalid entity. Must be one of: ${validEntities.join(', ')}` }, { status: 400 });
    }

    if (records.length === 0) {
      return NextResponse.json({ data: { imported: 0, errors: [] } });
    }

    if (records.length > 1000) {
      return NextResponse.json({ error: 'Max 1000 records per import. Use multiple requests for larger datasets.' }, { status: 400 });
    }

    // Every valid row is built BEFORE anything writes: the plan gate below needs
    // the real count, and a row rejected for a missing required field must not
    // change how much quota the import costs. (#3147 — this route used to insert
    // as it validated, 50 rows at a time, outside any transaction, so it never
    // read plans.maxContacts and never maintained tenants.currentContacts.)
    const errors: Array<{ row: number; error: string }> = [];
    const contactRows: (typeof contacts.$inferInsert)[] = [];
    const companyRows: (typeof companies.$inferInsert)[] = [];
    const leadRows: (typeof leads.$inferInsert)[] = [];

    records.forEach((r, idx) => {
      if (entity === 'contacts') {
        if (!r.first_name && !r.firstName) {
          errors.push({ row: idx + 1, error: 'first_name is required' });
          return;
        }
        contactRows.push({
          tenantId: ctx.tenantId,
          firstName: r.first_name || r.firstName || '',
          lastName: r.last_name || r.lastName || null,
          email: r.email || null,
          phone: r.phone || null,
          jobTitle: r.job_title || r.jobTitle || null,
          leadStatus: 'new',
          createdBy: ctx.userId,
        });
        return;
      }

      if (entity === 'companies') {
        if (!r.name) {
          errors.push({ row: idx + 1, error: 'name is required' });
          return;
        }
        companyRows.push({
          tenantId: ctx.tenantId,
          name: r.name,
          website: r.website || null,
          industry: r.industry || null,
          phone: r.phone || null,
          createdBy: ctx.userId,
        });
        return;
      }

      if (!r.first_name && !r.firstName) {
        errors.push({ row: idx + 1, error: 'first_name is required' });
        return;
      }
      leadRows.push({
        tenantId: ctx.tenantId,
        firstName: r.first_name || r.firstName || '',
        // leads.lastName is NOT NULL (default ''), unlike contacts.lastName
        // which is nullable — so this branch cannot pass null.
        lastName: r.last_name || r.lastName || '',
        email: r.email || null,
        phone: r.phone || null,
        companyName: r.company || r.company_name || null,
        leadStatus: 'new',
        source: r.source || r.lead_source || null,
        createdBy: ctx.userId,
      });
    });

    // Exactly one of the three arrays above is populated, by the `entity`
    // switch the mapping just ran through.
    const rowCount = contactRows.length + companyRows.length + leadRows.length;
    if (rowCount === 0) {
      return NextResponse.json({ data: { imported: 0, errors, total_records: records.length } });
    }

    // Process in batches of 50
    const BATCH_SIZE = 50;
    let imported = 0;
    // contacts and leads are admitted to the tenant's contacts pool, which
    // plans.maxContacts caps; companies own no counter and stay out of the gate.
    const gated = entity !== 'companies';
    let planLimitError: string | null = null;

    await db.transaction(async (tx) => {
      // #3080's rule: the FOR UPDATE lock, the quota test, the writes and the
      // counter bump belong to ONE transaction. An upfront check that commits
      // before any row exists lets two concurrent imports both pass it, and a
      // quota failure here rolls back whatever this request already inserted.
      if (gated) {
        const [lockedTenant] = await tx
          .select({
            currentContacts: tenants.currentContacts,
            maxContacts: plans.maxContacts,
          })
          .from(tenants)
          .innerJoin(plans, eq(plans.id, tenants.planId))
          .where(eq(tenants.id, ctx.tenantId))
          .limit(1)
          .for('update');

        if (lockedTenant && lockedTenant.maxContacts != null
          && (lockedTenant.currentContacts ?? 0) + rowCount > lockedTenant.maxContacts) {
          planLimitError = `Import would exceed plan limit of ${lockedTenant.maxContacts} contacts`
            + (entity === 'leads' ? ' (leads share the contacts pool).' : '.');
          return;
        }
      }

      // A batch that the database refuses stays the per-batch error it always
      // was, thanks to the savepoint drizzle opens for a nested transaction —
      // one bad row in a 1000-row file must not discard the 950 good ones. The
      // savepoint is inside the locked transaction, so the quota still holds.
      const writeBatched = async <T extends object>(
        rows: T[],
        insert: (sp: ImportTx, rows: T[]) => Promise<unknown>,
      ): Promise<void> => {
        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
          const batch = rows.slice(i, i + BATCH_SIZE);
          try {
            await tx.transaction(async (sp) => { await insert(sp, batch); });
            imported += batch.length;
          } catch (batchErr) {
            const msg = batchErr instanceof Error ? batchErr.message : 'Unknown error';
            errors.push({ row: i + 1, error: `Batch failed: ${msg}` });
          }
        }
      };

      await writeBatched(contactRows, (sp, batch) => sp.insert(contacts).values(batch));
      await writeBatched(companyRows, (sp, batch) => sp.insert(companies).values(batch));
      await writeBatched(leadRows, (sp, batch) => sp.insert(leads).values(batch));

      if (gated && imported > 0) {
        // SQL-side, not read-then-write: two imports that both committed would
        // otherwise each write the number they last read.
        await tx
          .update(tenants)
          .set({ currentContacts: sql`COALESCE(${tenants.currentContacts}, 0) + ${imported}` })
          .where(eq(tenants.id, ctx.tenantId));
      }
    });

    if (planLimitError) {
      return NextResponse.json({ error: planLimitError }, { status: 403 });
    }

    return NextResponse.json({
      data: { imported, errors, total_records: records.length },
    });
  } catch (err) {
    return apiError(err);
  }
});
