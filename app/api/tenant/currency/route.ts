/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import { db } from '@/drizzle/db';
import { tenants } from '@/drizzle/schema';
import { eq, sql } from 'drizzle-orm';
import { logAudit } from '@/lib/audit';
import {
  getSupportedCurrencies,
  getExchangeRate,
  SUPPORTED_CURRENCIES,
} from '@/lib/currency';
import { z } from 'zod';
import { validateBody, readJsonBody } from '@/lib/api/validate';
import { withApiRoute } from '@/lib/api/with-api-route';

const setCurrencySchema = z.object({
  currency: z.string().min(1, 'Currency code is required'),
});

/** Reads the code POST /api/tenant/currency stored in tenants.settings. */
async function readDefaultCurrency(tenantId: string): Promise<string> {
  const [t] = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  const stored = (t?.settings as Record<string, unknown> | undefined)?.default_currency;
  return typeof stored === 'string' && stored ? stored : 'USD';
}

/**
 * GET /api/tenant/currency
 * Returns supported currencies with current rates.
 * No module gate - available to all tenants.
 */
export const GET = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const currencies = getSupportedCurrencies();

    // Try to get rates (may fail if API is unavailable)
    let rates: Record<string, number | null> = {};
    try {
      for (const currency of currencies.slice(0, 10)) {
        if (currency.code === 'USD') {
          rates[currency.code] = 1;
        } else {
          rates[currency.code] = await getExchangeRate('USD', currency.code);
        }
      }
    } catch {
      // If rates unavailable, return currencies without rates
      rates = {};
    }

    return NextResponse.json({
      data: {
        currencies,
        baseCurrency: 'USD',
        defaultCurrency: await readDefaultCurrency(ctx.tenantId),
        rates,
      },
    });
 
 
  } catch (err) {
    return apiError(err);
  }
});

/**
 * POST /api/tenant/currency
 * Set tenant default currency.
 * No module gate - available to all tenants.
 */
export const POST = withApiRoute(async (req: NextRequest) => {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const raw = await readJsonBody(req);
    const parsed = validateBody(setCurrencySchema, raw);
    if (parsed instanceof NextResponse) return parsed;
    const { currency } = parsed.data;

    const upperCode = currency.toUpperCase();
    const valid = SUPPORTED_CURRENCIES.find(c => c.code === upperCode);
    if (!valid) {
      return NextResponse.json(
        { error: `Unsupported currency: ${upperCode}` },
        { status: 400 }
      );
    }

    // tenants has no currency column, so this lives in tenants.settings the
    // same way localization does — a jsonb_set merge that cannot clobber the
    // other keys. Before this the handler answered 200 and stored nothing.
    const [updated] = await db
      .update(tenants)
      .set({
        settings: sql`jsonb_set(
          COALESCE(${tenants.settings}, '{}'::jsonb),
          '{default_currency}',
          to_jsonb(${upperCode}::text)
        )`,
      })
      .where(eq(tenants.id, ctx.tenantId))
      .returning({ id: tenants.id });

    if (!updated) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });

    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'set_default_currency',
      entityType: 'tenant',
      newData: { default_currency: upperCode },
    });

    return NextResponse.json({
      data: {
        tenantId: ctx.tenantId,
        defaultCurrency: upperCode,
        currencyInfo: valid,
      },
    });
 
 
  } catch (err) {
    return apiError(err);
  }
});
