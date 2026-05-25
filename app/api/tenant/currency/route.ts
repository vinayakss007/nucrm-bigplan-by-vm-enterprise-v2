import { NextRequest, NextResponse } from 'next/server';
import { apiError } from '@/lib/api-error';
import { requireAuth } from '@/lib/auth/middleware';
import {
  getSupportedCurrencies,
  getExchangeRate,
  setRateCache,
  SUPPORTED_CURRENCIES,
} from '@/lib/currency';

/**
 * GET /api/tenant/currency
 * Returns supported currencies with current rates.
 * No module gate - available to all tenants.
 */
export async function GET(req: NextRequest) {
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
        rates,
      },
    });
  } catch (err: any) {
    return apiError(err);
  }
}

/**
 * POST /api/tenant/currency
 * Set tenant default currency.
 * No module gate - available to all tenants.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const body = await req.json();
    const { currency } = body;

    if (!currency || typeof currency !== 'string') {
      return NextResponse.json(
        { error: 'Currency code is required' },
        { status: 400 }
      );
    }

    const upperCode = currency.toUpperCase();
    const valid = SUPPORTED_CURRENCIES.find(c => c.code === upperCode);
    if (!valid) {
      return NextResponse.json(
        { error: `Unsupported currency: ${upperCode}` },
        { status: 400 }
      );
    }

    // In a full implementation, this would update the tenant's default currency
    // in the tenants table. For now, return confirmation.
    return NextResponse.json({
      data: {
        tenantId: ctx.tenantId,
        defaultCurrency: upperCode,
        currencyInfo: valid,
      },
    });
  } catch (err: any) {
    return apiError(err);
  }
}
