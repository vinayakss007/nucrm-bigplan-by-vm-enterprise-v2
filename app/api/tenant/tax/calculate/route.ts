import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { requireModule } from '@/lib/modules/gate';
import { calculateTax, calculateCompoundTax, applyTaxToLineItems } from '@/lib/tax';

/**
 * POST /api/tenant/tax/calculate
 * Calculate tax for a given amount or line items.
 * Returns breakdown with each tax line.
 * Module-gated to 'sales-quotes'.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const gate = await requireModule(ctx.tenantId, 'sales-quotes');
    if (gate) return gate;

    const body = await req.json();
    const { amount, taxRateIds, items } = body;

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
  } catch (err: any) {
    return apiError(err);
  }
}
