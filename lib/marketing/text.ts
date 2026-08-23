/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */
/**
 * Copy helpers for the marketing site.
 */

/**
 * Lowercase a label for use mid-sentence, without destroying acronyms and
 * brand casing.
 *
 * A blind `.toLowerCase()` produced "Go deeper on ai", "Try ai assistant on
 * your own data", "NuCRM for saas & software" and "recruitment & hr". Only
 * tokens that are plainly Capitalised words get lowered; anything carrying an
 * internal capital (AI, HR, SaaS, NuCRM) is left exactly as written.
 *
 *   softLower('AI assistant')        // 'AI assistant'
 *   softLower('Sales & pipeline')    // 'sales & pipeline'
 *   softLower('SaaS & software')     // 'SaaS & software'
 *   softLower('Recruitment & HR')    // 'recruitment & HR'
 */
export function softLower(label: string): string {
  return label
    .split(' ')
    .map((token) => (/^[A-Z][a-z]*$/.test(token) ? token.toLowerCase() : token))
    .join(' ');
}
