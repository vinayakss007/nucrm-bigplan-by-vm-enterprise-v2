/**
 * Revenue forecasting helpers
 */

export function getStageProbability(stageName: string): number {
  const lower = (stageName || '').toLowerCase();
  if (lower.includes('closed') || lower.includes('won')) return 1.0;
  if (lower.includes('negotiation')) return 0.75;
  if (lower.includes('proposal')) return 0.5;
  if (lower.includes('qualified')) return 0.25;
  if (lower.includes('lead') || lower.includes('new')) return 0.1;
  return 0.3;
}

export function calculateWeightedValue(amount: number, stageName: string): number {
  return amount * getStageProbability(stageName);
}
