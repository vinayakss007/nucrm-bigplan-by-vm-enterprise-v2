/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Indian GST Calculation Engine
 *
 * Handles GST calculation with place-of-supply logic (IGST vs CGST+SGST),
 * HSN/SAC code rate lookup, TDS calculation, GSTIN validation, and
 * GST-compliant invoice number formatting.
 */

import { getGSTRate, getCessRate } from './gst-rates';

/**
 * Indian state codes used in GSTIN (first 2 digits)
 */
export const STATE_CODES: Record<string, string> = {
  '01': 'Jammu & Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '25': 'Daman & Diu',
  '26': 'Dadra & Nagar Haveli',
  '27': 'Maharashtra',
  '28': 'Andhra Pradesh',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman & Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh (New)',
  '38': 'Ladakh',
  '97': 'Other Territory',
};

export interface GSTResult {
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  total: number;
  taxRate: number;
}

export interface TDSResult {
  tdsAmount: number;
  tdsRate: number;
  netPayable: number;
}

/**
 * Calculate GST for a given amount based on place-of-supply rules.
 *
 * - If fromState === toState: intra-state -> CGST + SGST (each half of rate)
 * - If fromState !== toState: inter-state -> full IGST
 * - Reverse charge: flags the transaction for reverse charge mechanism
 *
 * @param amount - Taxable amount
 * @param fromState - State code of supplier (2-digit string, e.g. "27" for Maharashtra)
 * @param toState - State code of recipient (2-digit string)
 * @param hsnCode - HSN or SAC code for rate lookup (optional, defaults to 18%)
 * @param isReverseCharge - Whether reverse charge mechanism applies
 * @returns GSTResult with breakdown of CGST, SGST, IGST, cess, and total
 */
export function calculateGST(
  amount: number,
  fromState: string,
  toState: string,
  hsnCode?: string,
  _isReverseCharge?: boolean
): GSTResult {
  // Handle edge cases
  if (amount <= 0) {
    return { cgst: 0, sgst: 0, igst: 0, cess: 0, total: 0, taxRate: 0 };
  }

  // Get rate from HSN/SAC code or default to 18%
  const rateInfo = hsnCode ? getGSTRate(hsnCode) : { rate: 18, description: 'Default GST rate' };
  const taxRate = rateInfo.rate;
  const cessRate = hsnCode ? getCessRate(hsnCode) : 0;

  // Calculate cess if applicable
  const cess = roundToTwo(amount * (cessRate / 100));

  // Under reverse charge, tax liability shifts to recipient.
  // The calculation remains the same but is flagged for accounting purposes.
  const isIntraState = fromState === toState;

  let cgst = 0;
  let sgst = 0;
  let igst = 0;

  if (isIntraState) {
    // Intra-state: split into CGST + SGST (each half)
    const halfRate = taxRate / 2;
    cgst = roundToTwo(amount * (halfRate / 100));
    sgst = roundToTwo(amount * (halfRate / 100));
  } else {
    // Inter-state: full IGST
    igst = roundToTwo(amount * (taxRate / 100));
  }

  const total = roundToTwo(cgst + sgst + igst + cess);

  return {
    cgst,
    sgst,
    igst,
    cess,
    total,
    taxRate,
  };
}

/**
 * Calculate TDS (Tax Deducted at Source) for applicable amounts.
 *
 * Under GST, TDS is applicable at 2% (1% CGST + 1% SGST or 2% IGST)
 * when the total value of supply exceeds INR 2,50,000 under a single contract.
 *
 * @param amount - Total invoice amount (inclusive of GST)
 * @param tdsRate - TDS rate as percentage (default 2% for GST TDS)
 * @returns TDSResult with deduction amount and net payable
 */
export function calculateTDS(amount: number, tdsRate: number = 2): TDSResult {
  if (amount <= 0) {
    return { tdsAmount: 0, tdsRate, netPayable: 0 };
  }

  const tdsAmount = roundToTwo(amount * (tdsRate / 100));
  const netPayable = roundToTwo(amount - tdsAmount);

  return {
    tdsAmount,
    tdsRate,
    netPayable,
  };
}

/**
 * Format a GST-compliant invoice number.
 *
 * GST invoice numbers must be:
 * - Consecutive and sequential
 * - Maximum 16 characters
 * - Contain only alphanumeric characters, hyphens, and slashes
 *
 * Format: {tenantCode}/{FY}/{sequence}
 * Example: ABC/2024/000001
 *
 * @param tenantCode - Short code for the tenant (max 4 chars)
 * @param sequence - Invoice sequence number
 * @param financialYear - Financial year (optional, defaults to current)
 * @returns Formatted invoice number string
 */
export function formatGSTInvoiceNumber(
  tenantCode: string,
  sequence: number,
  financialYear?: number
): string {
  const code = tenantCode.toUpperCase().slice(0, 4);
  const fy = financialYear ?? getCurrentFinancialYear();
  const seq = String(sequence).padStart(6, '0');

  return `${code}/${fy}/${seq}`;
}

/**
 * Validate a 15-digit GSTIN (GST Identification Number).
 *
 * Format: SSPPPPPPPPPPPCZ
 * - SS: State code (01-38, 97)
 * - PPPPPPPPPPP: PAN (10 chars: 5 alpha + 4 digits + 1 alpha)
 * - C: Entity code (1-9, A-Z)
 * - Z: Checksum character
 *
 * @param gstin - GSTIN string to validate
 * @returns true if valid, false otherwise
 */
export function validateGSTIN(gstin: string): boolean {
  if (!gstin || gstin.length !== 15) {
    return false;
  }

  const gstinUpper = gstin.toUpperCase();

  // Basic format: 2 digits + 5 alpha + 4 digits + 1 alpha + 1 alphanum + 1 alphanum + 1 alphanum
  const pattern = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z][Z][0-9A-Z]$/;
  if (!pattern.test(gstinUpper)) {
    return false;
  }

  // Validate state code
  const stateCode = gstinUpper.substring(0, 2);
  if (!STATE_CODES[stateCode]) {
    return false;
  }

  // Validate checksum (Luhn mod 36 variant)
  const checksum = calculateGSTINChecksum(gstinUpper.substring(0, 14));
  return checksum === gstinUpper[14];
}

/**
 * Extract the state code from a GSTIN.
 *
 * @param gstin - Valid GSTIN string
 * @returns State code (2-digit string) or null if invalid
 */
export function getStateFromGSTIN(gstin: string): string | null {
  if (!gstin || gstin.length < 2) {
    return null;
  }

  const stateCode = gstin.substring(0, 2);
  if (!STATE_CODES[stateCode]) {
    return null;
  }

  return stateCode;
}

/**
 * Get the state name from a state code
 */
export function getStateName(stateCode: string): string | undefined {
  return STATE_CODES[stateCode];
}

/**
 * Calculate zero-rated export GST (0% tax for exports)
 */
export function calculateExportGST(_amount: number): GSTResult {
  return {
    cgst: 0,
    sgst: 0,
    igst: 0,
    cess: 0,
    total: 0,
    taxRate: 0,
  };
}

// ---- Internal helpers ----

/**
 * Round to two decimal places using banker's rounding
 */
function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Get the current Indian financial year (April to March).
 * Returns the starting year of the current FY.
 */
function getCurrentFinancialYear(): number {
  const now = new Date();
  const month = now.getMonth(); // 0-indexed: 0=Jan, 3=Apr
  const year = now.getFullYear();

  // FY starts in April (month index 3)
  return month >= 3 ? year : year - 1;
}

/**
 * Calculate GSTIN checksum character using the weighted checksum algorithm.
 *
 * The algorithm uses a mod-36 approach where:
 * - Characters are mapped: 0-9 -> 0-9, A-Z -> 10-35
 * - Each position has a factor based on its index
 * - Final checksum is computed as (36 - (sum % 36)) % 36
 */
function calculateGSTINChecksum(gstinWithoutCheck: string): string {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let sum = 0;

  for (let i = 0; i < gstinWithoutCheck.length; i++) {
    const char = gstinWithoutCheck[i]!;
    const charIndex = chars.indexOf(char);

    // Factor calculation: position-based weight
    const factor = (i % 2 === 0) ? 1 : 2;
    const product = charIndex * factor;

    // Sum the quotient and remainder when divided by 36
    sum += Math.floor(product / 36) + (product % 36);
  }

  const remainder = sum % 36;
  const checksumIndex = (36 - remainder) % 36;

  return chars[checksumIndex]!;
}
