/*!
 * NuCRM Enterprise — Property of abetworks.in
 * Copyright (c) 2026 abetworks.in. All Rights Reserved.
 * Proprietary & confidential. Unauthorized copying or distribution is prohibited.
 */

/**
 * Whether a deal-stage name represents a "won" (closed-won) stage.
 *
 * Deal "won" side-effects (webhooks, email, automations) used to be gated on
 * an exact `name.toLowerCase() === 'won'` check, which silently broke for any
 * tenant that renamed their winning stage (e.g. "Closed Won", "Deal Won",
 * "Closed - Won"). This matches the common naming conventions instead. (#658)
 *
 * Matching rules (case/punctuation-insensitive):
 *  - exactly "won"
 *  - contains the standalone word "won" together with one of the qualifier
 *    words closed / deal / mark(ed) / sale(s)  →  "Closed Won", "Deal Won", …
 *
 * Deliberately does NOT match "lost", "not won", "unwon", or unrelated labels.
 */
export function isWonStageName(name: string | null | undefined): boolean {
  if (!name) return false;
  const n = name.toLowerCase().replace(/[^a-z]+/g, ' ').trim();
  if (n === 'won') return true;
  if (!/\bwon\b/.test(n)) return false;
  // Guard against negations like "not won".
  if (/\bnot\b/.test(n)) return false;
  return /\b(closed|deal|mark|marked|sale|sales)\b/.test(n);
}

/**
 * Whether a deal-stage name represents a "lost" (closed-lost) stage — the mirror
 * of `isWonStageName` above, with the same vocabulary and the same refusal of
 * negations.
 *
 * Analytics needs both sides: the win rate and the open-pipeline figure classify
 * every stage of a tenant's pipeline as won, lost, or neither. A page that only
 * knows the exact names 'Won'/'Lost' silently files a renamed winning stage under
 * "open", which inflates live pipeline by the money already banked. (#3118)
 *
 * Kept conservative on purpose: a label the matcher does not understand is left
 * in the open bucket rather than counted as a loss, so a stage like
 * "Not Won" or "Churn Risk" never deflates the win rate.
 */
export function isLostStageName(name: string | null | undefined): boolean {
  if (!name) return false;
  const n = name.toLowerCase().replace(/[^a-z]+/g, ' ').trim();
  if (n === 'lost') return true;
  if (!/\blost\b/.test(n)) return false;
  if (/\bnot\b|\bnever\b/.test(n)) return false;
  return /\b(closed|deal|mark|marked|sale|sales)\b/.test(n);
}

/**
 * The `deals` patch that records a win, for a stage name a write is about to
 * move deals into — empty unless the stage is a won stage.
 *
 * `deals.won_at` (0084) is the win date the MTD revenue tiles and the
 * leaderboards read, and until #3112 only the single-deal PATCH set it, so a
 * bulk "move to Won" — the common way a team closes a quarter of deals at once
 * — was invisible to revenue and excluded outright by leaderboards'
 * `won_at IS NOT NULL`. It returns a spreadable object so an ordinary move
 * spreads to nothing and the UPDATE does not mention the column at all.
 *
 * The legacy `metadata.won_at` copy `deals/[id]` still mirrors is deliberately
 * not written here — 0084 backfilled it and no reader remains.
 */
export function wonAtPatch(name: string | null | undefined): { wonAt?: Date } {
  return isWonStageName(name) ? { wonAt: new Date() } : {};
}
