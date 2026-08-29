/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Contract PDF Export
 * GET /api/tenant/contracts/[id]/pdf
 * Returns a real application/pdf summary document for a contract.
 *
 * NOTE: Contracts have NO contract_line_items table in the schema, so this PDF
 * is a summary document only (header, parties, type, term dates, total value,
 * billing frequency, terms, notes). Line items are intentionally out of scope
 * because no contract line-item entity exists.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { logError } from '@/lib/errors-server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { contracts, contacts, companies, tenants } from '@/drizzle/schema';
import { eq, and, sql } from 'drizzle-orm';
import { withApiRoute } from '@/lib/api/with-api-route';
import { renderContractPdf } from '@/lib/pdf/render';
import {
  mapContractToPdfData,
  type ContractRow,
  type ContractPartyRow,
} from '@/lib/pdf/mappers';

export const GET = withApiRoute(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const deny = requirePerm(ctx, 'contracts.view');
    if (deny) return deny;

    const contractId = (await params).id;

    // Fetch the contract with its contact/company via leftJoin (like the quote route).
    const [row] = await db
      .select({
        id: contracts.id,
        title: contracts.title,
        contractNumber: contracts.contractNumber,
        contractType: contracts.contractType,
        status: contracts.status,
        startDate: contracts.startDate,
        endDate: contracts.endDate,
        totalValue: contracts.totalValue,
        billingFrequency: contracts.billingFrequency,
        terms: contracts.terms,
        notes: contracts.notes,
        contactFirstName: contacts.firstName,
        contactLastName: contacts.lastName,
        contactEmail: contacts.email,
        companyName: companies.name,
      })
      .from(contracts)
      .leftJoin(contacts, eq(contacts.id, contracts.contactId))
      .leftJoin(companies, eq(companies.id, contracts.companyId))
      .where(
        and(
          eq(contracts.id, contractId),
          eq(contracts.tenantId, ctx.tenantId),
          sql`${contracts.deletedAt} IS NULL`
        )
      )
      .limit(1);

    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Branding = tenant name (only branding source in the schema today).
    const [tenant] = await db
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1);

    const contract: ContractRow = {
      id: row.id,
      title: row.title,
      contractNumber: row.contractNumber,
      contractType: row.contractType,
      status: row.status,
      startDate: row.startDate,
      endDate: row.endDate,
      totalValue: row.totalValue,
      billingFrequency: row.billingFrequency,
      terms: row.terms,
      notes: row.notes,
    };
    const party: ContractPartyRow = {
      contactFirstName: row.contactFirstName,
      contactLastName: row.contactLastName,
      contactEmail: row.contactEmail,
      companyName: row.companyName,
    };

    const pdf = await renderContractPdf(mapContractToPdfData(contract, party, tenant?.name));

    // Reuse the same filename sanitization convention as the invoice route.
    const safeName = String(row.contractNumber || `contract-${row.id.slice(0, 8)}`).replace(
      /[^a-zA-Z0-9_\-]/g,
      '_'
    );

    // A Node Buffer is wrapped as Uint8Array so the Response body type is satisfied.
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${safeName}.pdf"`,
      },
    });
  } catch (err) {
    await logError({ error: err, context: 'tenant/contracts/[id]/pdf GET', requestMethod: 'GET' });
    return apiError(err);
  }
});
