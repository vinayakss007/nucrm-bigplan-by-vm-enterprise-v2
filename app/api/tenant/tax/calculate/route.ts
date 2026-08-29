/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { requireModule } from '@/lib/modules/gate';
import { calculateTax, calculateCompoundTax, applyTaxToLineItems } from '@/lib/tax';
import { readJsonBody } from '@/lib/api/validate';
import { withApiRoute } from '@/lib/api/with-api-route';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/tenant/tax/calculate
 * Calculate tax for a given amount or line items.
 * Returns breakdown with each tax line.
 * Module-gated to 'sales-quotes'.
 */
export const POST = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const gate = await requireModule(ctx.tenantId, 'sales-quotes', ctx.isSuperAdmin);
    if (gate) return gate;

    const body = await readJsonBody(req);
    const { amount, taxRateIds, items } = body;

    if (taxRateIds && Array.isArray(taxRateIds)) {
      const invalid = taxRateIds.filter((id: string) => !UUID_RE.test(id));
      if (invalid.length > 0) {
        return NextResponse.json(
          { error: `Invalid taxRateId(s): ${invalid.join(', ')}` },
          { status: 400 }
        );
      }
    }

    // If items are provided, apply tax to line items
    if (items && Array.isArray(items)) {
      if (!taxRateIds || !Array.isArray(taxRateIds) || taxRateIds.length === 0) {
        return NextResponse.json(
          { error: 'taxRateIds array is required' },
          { status: 400 }
        );
      }

      const result = await applyTaxToLineItems(items, {
        taxRateIds,
        tenantId: ctx.tenantId,
      });

      return NextResponse.json({ data: result });
    }

    // Single amount calculation
    if (amount === undefined || amount === null) {
      return NextResponse.json(
        { error: 'Amount or items array is required' },
        { status: 400 }
      );
    }

    if (!taxRateIds || !Array.isArray(taxRateIds) || taxRateIds.length === 0) {
      return NextResponse.json(
        { error: 'taxRateIds array is required' },
        { status: 400 }
      );
    }

    // Use compound tax for multiple rates, single tax for one rate
    let result;
    if (taxRateIds.length === 1) {
      result = await calculateTax(amount, taxRateIds[0], ctx.tenantId);
    } else {
      result = await calculateCompoundTax(amount, taxRateIds, ctx.tenantId);
    }

    return NextResponse.json({ data: result });
 
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    return apiError(err);
  }
});
