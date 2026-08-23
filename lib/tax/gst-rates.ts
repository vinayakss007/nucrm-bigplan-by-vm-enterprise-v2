/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * HSN/SAC Code to GST Rate Mapping
 *
 * SAC (Services Accounting Code) and HSN (Harmonized System of Nomenclature)
 * codes mapped to their applicable GST rates for the Indian market.
 */

export interface GSTRateEntry {
  code: string;
  rate: number;
  description: string;
  category: 'service' | 'product';
  cessRate?: number;
}

/**
 * SAC codes for services commonly used in CRM/B2B SaaS context
 */
const SAC_RATES: GSTRateEntry[] = [
  { code: '998313', rate: 18, description: 'Management consulting services', category: 'service' },
  { code: '998314', rate: 18, description: 'IT consulting and support services', category: 'service' },
  { code: '998315', rate: 18, description: 'Legal services', category: 'service' },
  { code: '998316', rate: 18, description: 'Accounting, auditing and bookkeeping services', category: 'service' },
  { code: '9983', rate: 18, description: 'Professional, technical and business services', category: 'service' },
  { code: '9984', rate: 18, description: 'Telecommunications, broadcasting and information supply services', category: 'service' },
  { code: '9971', rate: 18, description: 'Financial and related services', category: 'service' },
  { code: '997211', rate: 18, description: 'Real estate services - commercial', category: 'service' },
  { code: '997212', rate: 12, description: 'Real estate services - residential (affordable)', category: 'service' },
  { code: '997213', rate: 5, description: 'Real estate services - under construction (affordable housing)', category: 'service' },
  { code: '9972', rate: 18, description: 'Real estate services', category: 'service' },
  { code: '998511', rate: 18, description: 'SaaS and cloud computing services', category: 'service' },
  { code: '998512', rate: 18, description: 'Hosting and IT infrastructure services', category: 'service' },
  { code: '9985', rate: 18, description: 'Support services', category: 'service' },
  { code: '9986', rate: 18, description: 'Support services to agriculture, mining, utilities', category: 'service' },
  { code: '9987', rate: 5, description: 'Maintenance and repair services', category: 'service' },
  { code: '9988', rate: 18, description: 'Manufacturing services on physical inputs', category: 'service' },
  { code: '9989', rate: 18, description: 'Other manufacturing services', category: 'service' },
  { code: '9991', rate: 18, description: 'Public administration services', category: 'service' },
  { code: '9992', rate: 18, description: 'Education services', category: 'service' },
  { code: '9993', rate: 18, description: 'Human health and social care services', category: 'service' },
  { code: '9994', rate: 18, description: 'Sewage and waste collection services', category: 'service' },
  { code: '9995', rate: 18, description: 'Services of membership organizations', category: 'service' },
  { code: '9996', rate: 18, description: 'Recreational, cultural and sporting services', category: 'service' },
  { code: '9997', rate: 18, description: 'Other services', category: 'service' },
];

/**
 * Common product HSN codes at different GST slabs
 */
const HSN_RATES: GSTRateEntry[] = [
  // 5% slab
  { code: '0901', rate: 5, description: 'Coffee and tea', category: 'product' },
  { code: '1006', rate: 5, description: 'Rice', category: 'product' },
  { code: '4901', rate: 5, description: 'Printed books and newspapers', category: 'product' },
  { code: '8471', rate: 5, description: 'Automatic data processing machines (basic)', category: 'product' },

  // 12% slab
  { code: '1905', rate: 12, description: 'Bakery products', category: 'product' },
  { code: '3304', rate: 12, description: 'Beauty and makeup preparations', category: 'product' },
  { code: '5607', rate: 12, description: 'Twine, cordage, ropes', category: 'product' },
  { code: '8414', rate: 12, description: 'Air or vacuum pumps', category: 'product' },

  // 18% slab
  { code: '3923', rate: 18, description: 'Plastic articles for packing', category: 'product' },
  { code: '7318', rate: 18, description: 'Screws, bolts, nuts (iron/steel)', category: 'product' },
  { code: '8504', rate: 18, description: 'Electrical transformers and converters', category: 'product' },
  { code: '8517', rate: 18, description: 'Telephones and communication apparatus', category: 'product' },
  { code: '8523', rate: 18, description: 'Discs, tapes, storage devices', category: 'product' },
  { code: '8528', rate: 18, description: 'Monitors and projectors', category: 'product' },
  { code: '8534', rate: 18, description: 'Printed circuits', category: 'product' },
  { code: '8544', rate: 18, description: 'Insulated wire, cables', category: 'product' },

  // 28% slab
  { code: '8703', rate: 28, description: 'Motor cars and vehicles', category: 'product' },
  { code: '2402', rate: 28, description: 'Cigars and cigarettes', category: 'product', cessRate: 12 },
  { code: '2202', rate: 28, description: 'Aerated waters and beverages', category: 'product', cessRate: 12 },
  { code: '8525', rate: 28, description: 'Cameras and video recorders', category: 'product' },
  { code: '9504', rate: 28, description: 'Video games and gaming consoles', category: 'product' },
  { code: '3303', rate: 28, description: 'Perfumes and toilet waters', category: 'product' },
];

/**
 * Combined rate table for lookups
 */
const ALL_RATES: GSTRateEntry[] = [...SAC_RATES, ...HSN_RATES];

/**
 * Get GST rate for a given HSN or SAC code.
 * First checks for exact match, then tries prefix match (parent codes).
 */
export function getGSTRate(hsnOrSacCode: string): { rate: number; description: string } {
  const code = hsnOrSacCode.trim();

  // Exact match
  const exact = ALL_RATES.find(entry => entry.code === code);
  if (exact) {
    return { rate: exact.rate, description: exact.description };
  }

  // Prefix match: find the longest matching parent code
  let bestMatch: GSTRateEntry | undefined;
  let bestLength = 0;

  for (const entry of ALL_RATES) {
    if (code.startsWith(entry.code) && entry.code.length > bestLength) {
      bestMatch = entry;
      bestLength = entry.code.length;
    }
  }

  if (bestMatch) {
    return { rate: bestMatch.rate, description: bestMatch.description };
  }

  // Default rate for unknown codes
  return { rate: 18, description: 'Default GST rate' };
}

/**
 * Get the cess rate for a given HSN/SAC code, if applicable
 */
export function getCessRate(hsnOrSacCode: string): number {
  const code = hsnOrSacCode.trim();
  const entry = ALL_RATES.find(e => e.code === code);
  return entry?.cessRate ?? 0;
}

/**
 * Get the full rate entry with all details
 */
export function getGSTRateEntry(hsnOrSacCode: string): GSTRateEntry | undefined {
  const code = hsnOrSacCode.trim();
  return ALL_RATES.find(entry => entry.code === code);
}

/**
 * Get all rates in a specific slab
 */
export function getRatesBySlab(rate: number): GSTRateEntry[] {
  return ALL_RATES.filter(entry => entry.rate === rate);
}

/**
 * Check if a code is a SAC (service) code
 */
export function isSACCode(code: string): boolean {
  const entry = ALL_RATES.find(e => e.code === code.trim());
  return entry?.category === 'service';
}
