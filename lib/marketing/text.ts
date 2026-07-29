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
 * Hyphenated tokens like "E-commerce" are handled by splitting on hyphens and
 * checking each part individually.
 *
 *   softLower('AI assistant')        // 'AI assistant'
 *   softLower('Sales & pipeline')    // 'sales & pipeline'
 *   softLower('SaaS & software')     // 'SaaS & software'
 *   softLower('Recruitment & HR')    // 'recruitment & HR'
 *   softLower('E-commerce & retail') // 'e-commerce & retail'
 */
export function softLower(label: string): string {
  return label
    .split(' ')
    .map((token) => {
      // Handle hyphenated tokens like "E-commerce"
      if (token.includes('-')) {
        const parts = token.split('-');
        const lowered = parts.map((part) =>
          /^[A-Z][a-z]*$/.test(part) ? part.toLowerCase() : part,
        );
        return lowered.join('-');
      }
      return /^[A-Z][a-z]*$/.test(token) ? token.toLowerCase() : token;
    })
    .join(' ');
}
