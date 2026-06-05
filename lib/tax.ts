/**
 * Tax Calculation Engine
 *
 * Provides tax calculation, compound tax support, region-based lookup,
 * and line-item tax application. Supports percentage-based, fixed amount,
 * compound tax, and tax-exempt entities.
 */

import { db } from '@/drizzle/db';
import { taxRates, taxExemptions } from '@/drizzle/schema/financial';
import { eq, and } from 'drizzle-orm';

export interface TaxRate {
  id: string;
  name: string;
  rate: number;
  type: 'percentage' | 'fixed';
  country?: string | null;
  state?: string | null;
  isDefault: boolean;
}

export interface TaxBreakdown {
  taxRateId: string;
  taxName: string;
  rate: number;
  type: 'percentage' | 'fixed';
  taxAmount: number;
}

export interface TaxResult {
  subtotal: number;
  totalTax: number;
  total: number;
  breakdown: TaxBreakdown[];
}

export interface LineItem {
  id?: string;
  description?: string;
  amount: number;
  quantity?: number;
  taxExempt?: boolean;
}

export interface TaxConfig {
  taxRateIds: string[];
  tenantId: string;
}

export interface LineItemWithTax extends LineItem {
  taxBreakdown: TaxBreakdown[];
  taxAmount: number;
  totalWithTax: number;
}

/**
 * Calculate tax for a single amount using a specific tax rate
 */
export async function calculateTax(
  amount: number,
  taxRateId: string,
  tenantId: string
): Promise<TaxResult> {
  const rate = await db.query.taxRates.findFirst({
    where: and(
      eq(taxRates.id, taxRateId),
      eq(taxRates.tenantId, tenantId),
      eq(taxRates.isActive, true)
    ),
  });

  if (!rate) {
    throw new Error(`Tax rate '${taxRateId}' not found or inactive`);
  }

  const numericRate = parseFloat(String(rate.rate));
  let taxAmount: number;

  if (rate.type === 'fixed') {
    taxAmount = numericRate;
  } else {
    taxAmount = Math.round(amount * (numericRate / 100) * 100) / 100;
  }

  return {
    subtotal: amount,
    totalTax: taxAmount,
    total: Math.round((amount + taxAmount) * 100) / 100,
    breakdown: [
      {
        taxRateId: rate.id,
        taxName: rate.name,
        rate: numericRate,
        type: rate.type as 'percentage' | 'fixed',
        taxAmount,
      },
    ],
  };
}

/**
 * Calculate compound tax (multiple tax rates applied sequentially)
 * Each tax is calculated on the original amount (not cascading).
 */
export async function calculateCompoundTax(
  amount: number,
  taxRateIds: string[],
  tenantId: string
): Promise<TaxResult> {
  if (taxRateIds.length === 0) {
    return { subtotal: amount, totalTax: 0, total: amount, breakdown: [] };
  }

  const breakdown: TaxBreakdown[] = [];
  let totalTax = 0;

  for (const taxRateId of taxRateIds) {
    const rate = await db.query.taxRates.findFirst({
      where: and(
        eq(taxRates.id, taxRateId),
        eq(taxRates.tenantId, tenantId),
        eq(taxRates.isActive, true)
      ),
    });

    if (!rate) {
      throw new Error(`Tax rate '${taxRateId}' not found or inactive`);
    }

    const numericRate = parseFloat(String(rate.rate));
    let taxAmount: number;

    if (rate.type === 'fixed') {
      taxAmount = numericRate;
    } else {
      taxAmount = Math.round(amount * (numericRate / 100) * 100) / 100;
    }

    totalTax += taxAmount;
    breakdown.push({
      taxRateId: rate.id,
      taxName: rate.name,
      rate: numericRate,
      type: rate.type as 'percentage' | 'fixed',
      taxAmount,
    });
  }

  totalTax = Math.round(totalTax * 100) / 100;

  return {
    subtotal: amount,
    totalTax,
    total: Math.round((amount + totalTax) * 100) / 100,
    breakdown,
  };
}

/**
 * Get tax rates for a specific region (country/state)
 */
export async function getTaxRatesForRegion(
  tenantId: string,
  country: string,
  state?: string
): Promise<TaxRate[]> {
  const filters = [
    eq(taxRates.tenantId, tenantId),
    eq(taxRates.isActive, true),
    eq(taxRates.country, country),
  ];

  if (state) {
    filters.push(eq(taxRates.state, state));
  }

  const rates = await db.select()
    .from(taxRates)
    .where(and(...filters));

  return rates.map(r => ({
    id: r.id,
    name: r.name,
    rate: parseFloat(String(r.rate)),
    type: r.type as 'percentage' | 'fixed',
    country: r.country,
    state: r.state,
    isDefault: r.isDefault,
  }));
}

/**
 * Check if an entity is tax-exempt
 */
export async function isEntityExempt(
  tenantId: string,
  entityType: string,
  entityId: string
): Promise<boolean> {
  const exemption = await db.query.taxExemptions.findFirst({
    where: and(
      eq(taxExemptions.tenantId, tenantId),
      eq(taxExemptions.entityType, entityType),
      eq(taxExemptions.entityId, entityId)
    ),
  });

  return !!exemption;
}

/**
 * Apply tax to line items with exemption support
 */
export async function applyTaxToLineItems(
  items: LineItem[],
  taxConfig: TaxConfig
): Promise<{ items: LineItemWithTax[]; summary: TaxResult }> {
  let totalSubtotal = 0;
  let totalTax = 0;
  const allBreakdown: TaxBreakdown[] = [];
  const itemsWithTax: LineItemWithTax[] = [];

  for (const item of items) {
    const lineAmount = item.amount * (item.quantity || 1);
    totalSubtotal += lineAmount;

    if (item.taxExempt) {
      itemsWithTax.push({
        ...item,
        taxBreakdown: [],
        taxAmount: 0,
        totalWithTax: lineAmount,
      });
      continue;
    }

    const result = await calculateCompoundTax(lineAmount, taxConfig.taxRateIds, taxConfig.tenantId);
    totalTax += result.totalTax;

    for (const bd of result.breakdown) {
      const existing = allBreakdown.find(b => b.taxRateId === bd.taxRateId);
      if (existing) {
        existing.taxAmount += bd.taxAmount;
      } else {
        allBreakdown.push({ ...bd });
      }
    }

    itemsWithTax.push({
      ...item,
      taxBreakdown: result.breakdown,
      taxAmount: result.totalTax,
      totalWithTax: result.total,
    });
  }

  // Round final amounts
  totalTax = Math.round(totalTax * 100) / 100;
  for (const bd of allBreakdown) {
    bd.taxAmount = Math.round(bd.taxAmount * 100) / 100;
  }

  return {
    items: itemsWithTax,
    summary: {
      subtotal: Math.round(totalSubtotal * 100) / 100,
      totalTax,
      total: Math.round((totalSubtotal + totalTax) * 100) / 100,
      breakdown: allBreakdown,
    },
  };
}
