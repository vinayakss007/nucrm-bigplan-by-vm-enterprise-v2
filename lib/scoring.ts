/**
 * Contact/Lead scoring helpers
 */

export type ScoreTier = 'hot' | 'warm' | 'cold';

export function getScoreTier(score: number): ScoreTier {
  if (score >= 70) return 'hot';
  if (score >= 40) return 'warm';
  return 'cold';
}

export function getScoreTierConfig(tier: ScoreTier) {
  switch (tier) {
    case 'hot':
      return { label: 'Hot', color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-950/20', bar: 'bg-red-500', border: 'border-red-200 dark:border-red-800' };
    case 'warm':
      return { label: 'Warm', color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950/20', bar: 'bg-amber-500', border: 'border-amber-200 dark:border-amber-800' };
    case 'cold':
      return { label: 'Cold', color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-950/20', bar: 'bg-blue-500', border: 'border-blue-200 dark:border-blue-800' };
  }
}
