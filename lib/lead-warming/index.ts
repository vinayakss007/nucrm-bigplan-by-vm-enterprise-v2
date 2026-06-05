/**
 * Lead Warming — Premium Module
 *
 * Auto-sends personalized emails + WhatsApp messages on festivals,
 * birthdays, and custom events. AI analyzes replies to detect intent.
 *
 * Module ID: 'lead-warming'
 * Plan: Pro ($35/mo) | Enterprise (included)
 *
 * API Routes:
 *   GET/POST   /api/tenant/lead-warming/campaigns
 *   GET/PATCH/DELETE /api/tenant/lead-warming/campaigns/[id]
 *   GET/POST   /api/tenant/lead-warming/events
 *   GET/POST   /api/tenant/lead-warming/replies
 *   GET        /api/tenant/lead-warming/stats
 *
 * Cron:
 *   POST /api/cron/lead-warming (daily at 9 AM)
 *
 * Worker Queue:
 *   'send-lead-warming' — processes WhatsApp messages async
 */

export { processLeadWarming, seedSystemEvents, resetMonthlyCounters, SYSTEM_FESTIVALS } from './engine';
export { analyzeReply, processIncomingReply, analyzeUnprocessedReplies } from './reply-analyzer';
export type { ReplyIntent, Sentiment, ReplyAnalysis } from './reply-analyzer';
export type { WarmingResult, FestivalEvent } from './engine';
