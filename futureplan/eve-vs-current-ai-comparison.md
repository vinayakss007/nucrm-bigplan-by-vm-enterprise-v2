# eve vs Current CRM AI — Comparison

**Date:** 2026-07-16

---

## Current CRM AI Features (Already Built)

| Feature | What it does | Powered by |
|---|---|---|
| AI Draft | Email/content generation with template interpolation | Multi-provider gateway (OpenAI, Anthropic, Groq, Ollama, DeepSeek) |
| AI Lead Scoring | AI-powered lead/contact ranking 0-100 with reasons | AI gateway + scoring rules |
| At-Risk Deal Detection | Flags stalled/idle/negative-sentiment deals | Configurable per-stage rules + sentiment |
| Sentiment Analysis | Text sentiment (positive/neutral/negative) + score | AI gateway + keyword fallback |
| Summarization | TL;DR for contacts, deals, companies | AI gateway |
| Lead Warming | Automated AI outreach campaigns (email, WhatsApp, SMS) | AI gateway + calendar events |
| Reply Analysis | Classify reply intent (interested, not_interested, etc.) | AI gateway |
| Churn Prediction | ML-based churn risk with factors + actions | DB function `calculate_churn_risk` |
| AI Insights | Automated contact/deal intelligence | AI gateway |
| AI Activity Log | Audit trail of all AI calls with ratings | Database |
| Multi-Provider Gateway | Infrastructure: fallback, cost tracking, credits, plan gating | Custom built |
| Provider Config UI | Settings page to configure providers + keys | React UI |

**Infrastructure:**
- `lib/ai/gateway.ts` — Multi-provider with automatic fallback
- `lib/ai/secrets.ts` — Encrypted key vault (AES-256-GCM)
- `lib/ai/credits.ts` — Token/cost credit management
- `lib/ai/plan-gate.ts` — Plan-based feature gating
- Supports: OpenAI, Anthropic, Groq, Ollama, OpenCode, DeepSeek, custom

---

## What eve Would Add

| Capability | What it does | Current CRM Status |
|---|---|---|
| Conversational agent | Natural language chat interface to CRM data | **Missing** (AI Assistant is a stub — returns null) |
| Channel integration | Same agent on HTTP, Slack, Discord, Teams, Telegram | **Missing** (need manual per-platform build) |
| Durable sessions | Conversation survives crashes/deploys | **Missing** |
| Human-in-the-loop | Built-in tool approval workflow | **Missing** (no native approval system) |
| Subagents | Specialist child agents for task delegation | **Missing** |
| Filesystem-first | Create agents as Markdown + TypeScript files | **Missing** (current features are code-only) |
| Scheduled autonomous runs | Cron-triggered agent sessions | **Missing** (current cron fires code, not agents) |
| Evals | Test suites for agent behavior in CI | **Missing** |
| Connections | OAuth for GitHub, Stripe, Salesforce, etc. | **Partial** (some integrations exist) |

---

## Comparison Summary

| Dimension | Current CRM AI | eve |
|---|---|---|
| **Focus** | Purpose-built CRM tools (scoring, draft, warming) | Conversational agent loop + channels |
| **Interface** | UI buttons, forms, dashboards | Natural language chat, Slack, Discord |
| **Provider support** | 7+ providers with fallback | Gateway or direct API key |
| **CRM data access** | Deep (native Drizzle queries) | Via tools (write SQL or call CRM APIs) |
| **Cost tracking** | Built-in credits + ledger | Not built-in (needs custom) |
| **Plan gating** | Built-in per feature | Not built-in |
| **Multi-channel** | Web only | HTTP + Slack + Discord + Teams + Telegram |
| **Durability** | None | Vercel Workflows (or none on VM) |
| **Approvals** | None | Built-in HITL |
| **Complexity** | CRM-specific, familiar code | New framework, new paradigm |

---

## Verdict

**They are complementary, not replacements.**

Current CRM AI = purpose-built backend tools (scoring, draft, warming, etc.)
eve = conversational frontend that can orchestrate those tools

What you're missing that eve fills:
1. A natural language conversational interface to your CRM data
2. Slack/Discord/Teams channel presence
3. Durable agent sessions with human-in-the-loop approvals

You don't need to choose. Add eve as a conversational layer that calls your existing AI tools.

---

## Recommended Path

1. First: deploy CRM on Vercel (already planned)
2. Then: `npm install eve@latest` + `withEve()` to add agent alongside CRM
3. Write 2-3 tools that call existing CRM AI features (e.g. `score_lead`, `draft_email`, `get_pipeline`)
4. Connect Slack channel for sales team access
5. Keep existing CRM AI as the engine; eve as the interface

This way you get conversational AI without rewriting any of your existing infrastructure.
