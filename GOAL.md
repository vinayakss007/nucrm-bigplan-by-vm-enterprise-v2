# NuCRM Enterprise — Product Vision & Goal

**Last Updated:** 2026-06-06
**Owner:** Vinayak
**This file is read at the start of every session to maintain alignment.**

---

## Core Vision

A CRM where **no lead falls through the cracks**. The system actively ensures every follow-up happens on time, and if the user misses — AI steps in intelligently.

---

## Pillars

### 1. Lead Management & Pipelines
- Leads stay **idle/pending** even when someone adds them (don't auto-assign or auto-activate)
- **Very fine-grained pipelines** — customizable stages, not just "open/won/lost"
- Clear visual: which stage, how long in stage, what's next action
- If a lead is added by someone, the assigned person must **explicitly take ownership**

### 2. Follow-Up Intelligence
- Every lead/contact shows: **"Follow up today"** or **"Follow up by [date]"** clearly
- If follow-up date is **missed** → badge shows: **"⚠ You missed the follow-up date by X days"**
- The missed state is **always visible**, never hidden or auto-dismissed
- User can see a **"Missed Follow-ups"** view that aggregates all overdue items

### 3. AI Auto-Follow-Up (Opt-In)
- If the user **enables AI** for their workspace:
  - When a follow-up is missed (e.g., 24h past due), **AI takes over**
  - AI sends a context-aware follow-up email/SMS based on the lead's history
  - User is notified: "AI sent a follow-up to [Lead Name] on your behalf"
  - User can **review, edit, or cancel** AI-scheduled follow-ups
- This is a **per-workspace toggle** — never forced

### 4. Smart Lead Scoring
- AI scores leads based on: engagement, email opens/clicks, site visits, response time
- Scores update in real time
- Visual: Hot/Warm/Cold badges + score number
- Rules: user can define what weights matter (e.g., "Email open = +10, Demo request = +50")

### 5. Multi-Channel Outreach
- Email, SMS, WhatsApp — unified inbox
- All outreach logged against the lead/contact automatically
- Templates per channel
- Sequence builder: "Day 1: Email → Day 3: SMS → Day 7: WhatsApp → Day 10: Call reminder"

### 6. Deliverability Engine
- Email warmup, spam score check, domain reputation monitoring
- Bounce handling, unsubscribe management
- Send timing optimization (when does this lead usually open?)
- Only for users who configure email sending

### 7. Automated Workflows
- No-code workflow builder: trigger → condition → action
- Triggers: lead created, deal stage changed, email opened, date reached, score changed
- Actions: send email, change stage, assign user, post webhook, add tag
- Workflows can be **paused, tested, versioned**

### 8. Real-Time Analytics
- Live dashboard: new leads today, follow-ups due, missed follow-ups, emails sent, conversion rates
- Per-user: "Your performance this week"
- Per-team: leaderboard of follow-up completion
- Exportable reports

---

## Development Rules (Non-Negotiable)

1. **Before every merge to main:** `npm run build` must succeed
2. **TypeScript errors are never ignored** — `ignoreBuildErrors: true` must be removed in dev
3. **Every new feature branch gets documented** in MASTER-TRACKER.md with its dependencies
4. **When merging a branch**, verify all imports it introduces actually exist in main
5. **After any merge**, run the smoke test (scripts/smoke-test.sh)
6. **This GOAL.md is read at the start of every session** — always update it if vision changes
