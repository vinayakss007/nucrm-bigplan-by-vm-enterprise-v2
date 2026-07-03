# NuCRM: Agent + Human Unified CRM — Architecture Analysis & Roadmap

**Date:** 2026-07-03
**Status:** Analysis Complete — Awaiting Review

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current CRM Feature Inventory](#2-current-crm-feature-inventory)
3. [Current Capabilities Assessment](#3-current-capabilities-assessment)
4. [The Unified CRM Vision: Agents + Humans](#4-the-unified-crm-vision-agents--humans)
5. [MCP Integration Architecture](#5-mcp-integration-architecture)
6. [What Exists vs What's Needed](#6-what-exists-vs-whats-needed)
7. [Implementation Roadmap](#7-implementation-roadmap)
8. [Effort Estimation](#8-effort-estimation)
9. [Risk Analysis](#9-risk-analysis)
10. [Decision Points](#10-decision-points)

---

## 1. Executive Summary

NuCRM currently has a **feature-rich multi-tenant CRM** with 88+ tenant API routes, 80+ database tables, a dual-layer automation engine, multi-provider AI gateway, and webhook infrastructure. However, the system is designed exclusively for **human users** — there is no concept of an "AI agent" as a first-class entity.

The goal is to build a **unified CRM** where both humans and AI agents can:
- Read and write the same data (contacts, deals, tasks, etc.)
- Be held accountable with audit trails showing who did what
- Use the same automation engine for workflow triggers
- Be governed by the same permission model
- Be accessible via MCP (Model Context Protocol) for agent-native integration

**Key Finding:** ~70% of the infrastructure already exists. The gaps are: agent identity, agent-specific auth, MCP server, agent-aware audit trails, and agent-specific UI views.

---

## 2. Current CRM Feature Inventory

### 2.1 Database Schema (80+ Tables)

| Module | Tables | Key Entities |
|--------|--------|-------------|
| **Core** | 17 | tenants, users, tenantMembers, roles, sessions, apiKeys, auditLogs, notifications, invitations |
| **CRM** | 35 | contacts, companies, leads, deals, pipelines, dealStages, products, quotes, priceBooks, meetings, notes, tags, customFieldDefs, forms, formSubmissions, savedViews, followUps, churnPredictions, revenueProjections, callNotes, callRecordings, conversationMetrics, contactScores, dealForecasts, leadActivities, leadAssignments |
| **Automation** | 19 | automations, automationRuns, workflows, workflowActions, workflowExecutions, workflowActionLogs, webhooks, webhookDeliveries, deadLetterQueue, scheduledReports, aiInsights, aiUsageLogs, aiEmailDrafts, contentGenerations, revenueOpportunities, aiModuleConfigs, aiUsageAggregated, automationWorkflows |
| **AI** | 7 | aiProviderSecrets, aiActivity, aiDraftTemplates, leadScoringRules, atRiskRules, tenantAiCredits, aiCreditsLedger |

### 2.2 API Routes (88 Tenant-Scoped Endpoints)

```
contacts/       companies/       deals/           leads/
tasks/          activities/      meetings/        notes/
pipelines/      products/        quotes/          orders/
invoices/       contracts/       tickets/         documents/
reports/        analytics/       dashboard/       search/
automations/    workflows/       webhooks/        email/
sms/            whatsapp/        chat/            calls/
forms/          segments/        sequences/       integrations/
ai/             ai-keys/         roles/           permissions/
members/        settings/        billing/         plans/
projects/       kb/              leaderboards/    views/
export/         backup/          trash/           compliance/
plugins/        sso/             portal/          ...
```

### 2.3 AI Capabilities

| Module | Capability | Provider | Status |
|--------|-----------|----------|--------|
| **Summarize** | Contact/deal/company TL;DR | OpenAI GPT-4o-mini | Active |
| **Email Draft** | Auto-draft emails from templates | OpenAI GPT-4o-mini | Active |
| **Lead Scoring** | AI + rule-based contact scoring | Configurable | Active |
| **Deal Coaching** | At-risk deal detection | Configurable rules | Active |
| **Task Prioritization** | AI-ranked task lists | OpenAI | Active |
| **Sentiment Analysis** | Call/email sentiment scoring | OpenAI | Active |
| **Tenant Analytics** | AI-powered business insights | OpenAI GPT-4o-mini | Active |

### 2.4 Automation Engine

**Dual-layer architecture:**

1. **Legacy Event Engine** (`lib/automation/engine.ts`):
   - Trigger events: `contact.created`, `contact.updated`, `deal.created`, `deal.updated`, `deal.won`, `deal.lost`, `task.created`, `task.completed`
   - Actions: `send_email`, `send_notification`, `update_field`, `create_task`, `enroll_sequence`, `log_call`, `send_whatsapp`, `fire_webhook`
   - Condition operators: `equals`, `not_equals`, `contains`, `not_contains`, `greater_than`, `less_than`, `is_empty`, `is_not_empty`

2. **Visual Workflow Builder** (DAG-based):
   - Node-based workflow editor with start/action/condition/end nodes
   - Trigger types: manual, event-based, scheduled
   - Supported actions: create/update contacts/deals/tasks, send emails, fire webhooks, update fields, create activities
   - Execution logging per action node

### 2.5 Authentication & Authorization

| Method | Implementation | Status |
|--------|---------------|--------|
| JWT Session Cookie | `nucrm_session` cookie, verified via `verifyToken()` | Production |
| API Key | `Bearer ak_...` prefix, SHA-256 hash lookup | Production |
| OAuth2 | Full OAuth2 authorization code flow | Production |
| SSO | SAML-based SSO | Production |
| 2FA/TOTP | TOTP-based two-factor auth | Production |
| CSRF | Token-based CSRF protection | Production |
| Demo Mode | Dev-only fallback with `ALLOW_DEMO_MODE` | Development |

**RBAC System:**
- Role-based with JSONB permissions on `roles` table
- Field-level permissions via `fieldPermissions` table
- Record-level permissions via `recordPermissions` table
- Approval workflows via `approvalRequests` table
- Impersonation sessions for superadmin

---

## 3. Current Capabilities Assessment

### What's Already Production-Ready

| Area | Read | Write | Search | Bulk | Import | Export |
|------|------|-------|--------|------|--------|--------|
| Contacts | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Companies | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| Deals | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| Leads | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Tasks | ✅ | ✅ | ✅ | ✅ | — | — |
| Activities | ✅ | ✅ | ✅ | — | — | — |
| Notes | ✅ | ✅ | — | — | — | — |
| Products | ✅ | ✅ | — | — | — | — |
| Quotes | ✅ | ✅ | — | — | — | — |
| Invoices | ✅ | ✅ | — | — | — | ✅ |
| Pipelines | ✅ | ✅ | — | — | — | — |
| Forms | ✅ | ✅ | — | — | — | — |
| Tickets | ✅ | ✅ | — | — | — | — |

### What's Partially Built

| Area | Status | Gap |
|------|--------|-----|
| AI Gateway | Multi-provider with fallback | No agentic loop (one-shot only) |
| Automation Engine | Event-driven triggers | No agent-triggered events, no agent-as-actor |
| Webhooks | Full delivery + retry + DLQ | No inbound webhook for agent actions |
| Audit Logs | Full entity-level logging | No agent vs human distinction |
| RBAC | Role + field + record permissions | No agent-specific roles |
| API Keys | Scoped + usage tracking | No agent-specific key types |

### What Doesn't Exist

| Area | Notes |
|------|-------|
| Agent entity | No "agent" as a user type or first-class entity |
| MCP Server | No production MCP server — only dev tooling |
| Agent UI views | No dashboard for monitoring agent activity |
| Agent-specific automation triggers | No `agent.action` event types |
| Agent authentication flow | No dedicated auth for agents |
| Agent rate limiting | No agent-specific rate limit tiers |
| Agent audit trail | No separate view for agent vs human actions |

---

## 4. The Unified CRM Vision: Agents + Humans

### 4.1 Core Design Principles

1. **Same Data, Different Actors** — Agents and humans read/write the same CRM data through the same API layer
2. **Full Auditability** — Every action (human or agent) is logged with `performedBy` (userId or agentId) and `performedByType` (human/agent)
3. **Same Permissions Model** — Agents get assigned roles just like humans; RBAC applies equally
4. **Agent-Specific Identity** — Agents are a new entity type with their own credentials, capabilities, and lifecycle
5. **MCP-Native Access** — Agents access the CRM via MCP (Model Context Protocol) tools, while humans access via UI + REST API
6. **Human-in-the-Loop** — Certain agent actions can require approval before execution

### 4.2 Agent Entity Model

```
agents
├── id              UUID PK
├── tenantId        UUID FK → tenants
├── name            VARCHAR         -- "Sales Bot", "Support Agent", "Lead Qualifier"
├── slug            VARCHAR         -- unique within tenant, e.g. "sales-bot"
├── description     TEXT
├── type            ENUM            -- 'ai', 'external', 'hybrid'
├── provider        VARCHAR         -- "openai", "anthropic", "custom", "mcp-client"
├── modelId         VARCHAR         -- "gpt-4o", "claude-3-opus", etc.
├── systemPrompt    TEXT            -- Agent's system instructions
├── capabilities    JSONB           -- ["contacts.read", "deals.write", "tasks.create", ...]
├── config          JSONB           -- { temperature, maxTokens, providerSettings, ... }
├── status          ENUM            -- 'active', 'paused', 'error', 'archived'
├── maxActionsPerHour INT
├── maxCostPerDayCents INT
├── createdBy       UUID FK → users
├── createdAt       TIMESTAMP
├── updatedAt       TIMESTAMP

agentSessions
├── id              UUID PK
├── agentId         UUID FK → agents
├── tenantId        UUID FK → tenants
├── startedAt       TIMESTAMP
├── endedAt         TIMESTAMP NULL
├── status          ENUM            -- 'active', 'completed', 'error'
├── totalActions    INT
├── totalCostCents  INT
├── metadata        JSONB

agentActions
├── id              UUID PK
├── agentId         UUID FK → agents
├── sessionId       UUID FK → agentSessions
├── tenantId        UUID FK → tenants
├── entityType      VARCHAR         -- 'contact', 'deal', 'task', etc.
├── entityId        UUID
├── action          VARCHAR         -- 'create', 'update', 'read', 'delete', 'email', ...
├── input           JSONB
├── output          JSONB
├── status          ENUM            -- 'success', 'error', 'pending_approval'
├── approvedBy      UUID FK → users NULL
├── costCents       INT
├── createdAt       TIMESTAMP
```

### 4.3 How the Unified Model Works

```
┌──────────────────────────────────────────────────────────┐
│                    NuCRM Platform                         │
│                                                           │
│  ┌─────────────┐    ┌─────────────┐    ┌──────────────┐ │
│  │  Human UI   │    │  MCP Server │    │  REST API    │ │
│  │  (Next.js)  │    │  (MCP)      │    │  (v2 API)    │ │
│  └──────┬──────┘    └──────┬──────┘    └──────┬───────┘ │
│         │                  │                  │          │
│         └──────────────────┼──────────────────┘          │
│                            │                              │
│                    ┌───────▼────────┐                     │
│                    │  Auth Layer    │                     │
│                    │  - JWT Session │                     │
│                    │  - API Key     │                     │
│                    │  - MCP Token   │ ← NEW               │
│                    └───────┬────────┘                     │
│                            │                              │
│                    ┌───────▼────────┐                     │
│                    │  RBAC Engine   │                     │
│                    │  (same for all)│                     │
│                    └───────┬────────┘                     │
│                            │                              │
│                    ┌───────▼────────┐                     │
│                    │  Data Layer    │                     │
│                    │  (Drizzle ORM) │                     │
│                    └───────┬────────┘                     │
│                            │                              │
│                    ┌───────▼────────┐                     │
│                    │  Audit Logger  │                     │
│                    │  (with actor   │                     │
│                    │   type)        │                     │
│                    └────────────────┘                     │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │              Automation Engine                       │ │
│  │  - contact.created  → triggers                       │ │
│  │  - deal.won         → triggers                       │ │
│  │  - agent.action     → triggers (NEW)                 │ │
│  │  - agent.complete   → triggers (NEW)                 │ │
│  └─────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

---

## 5. MCP Integration Architecture

### 5.1 What is MCP?

The **Model Context Protocol (MCP)** is an open standard (by Anthropic) for connecting AI agents to data sources and tools. It defines:

- **Tools** — Functions an agent can call (like API endpoints but structured for LLM consumption)
- **Resources** — Data the agent can read (like database schemas, file contents)
- **Prompts** — Predefined prompt templates the agent can use

MCP servers expose tools to any MCP client (Claude Desktop, Cursor, custom agents, etc.).

### 5.2 Proposed MCP Server Architecture

```
NuCRM MCP Server (TypeScript)
├── Transport: stdio (for desktop clients) + SSE/HTTP (for remote)
├── Auth: API key or OAuth2 token via MCP headers
│
├── TOOLS (Agent Actions)
│   ├── contacts.search(query, filters) → Contact[]
│   ├── contacts.get(id) → Contact
│   ├── contacts.create(data) → Contact
│   ├── contacts.update(id, data) → Contact
│   ├── deals.search(query, filters) → Deal[]
│   ├── deals.get(id) → Deal
│   ├── deals.create(data) → Deal
│   ├── deals.update(id, data) → Deal
│   ├── deals.moveStage(id, stageId) → Deal
│   ├── tasks.create(data) → Task
│   ├── tasks.complete(id) → Task
│   ├── activities.log(data) → Activity
│   ├── notes.add(entityType, entityId, content) → Note
│   ├── companies.get(id) → Company
│   ├── companies.search(query) → Company[]
│   ├── emails.send(to, subject, body) → SendResult
│   ├── emails.draft(contactId, purpose) → Draft
│   ├── pipeline.get() → Pipeline[]
│   └── search(query, type) → SearchResult[]
│
├── RESOURCES (Agent Reads)
│   ├── crm://schema → Full database schema (read-only)
│   ├── crm://tenant/{id}/stats → Tenant statistics
│   ├── crm://contacts/{id} → Contact details
│   ├── crm://deals/{id} → Deal details
│   └── crm://automation/rules → Active automation rules
│
└── PROMPTS (Agent Guidance)
    ├── crm.contact-summary → Generate contact summary
    ├── crm.deal-coaching → Deal coaching prompts
    ├── crm.email-draft → Email drafting templates
    └── crm.lead-qualification → Lead qualification checklist
```

### 5.3 MCP vs Native API Integration

| Aspect | MCP | Native API (REST/GraphQL) |
|--------|-----|--------------------------|
| **Agent Discovery** | Tools are self-describing with JSON Schema | Requires OpenAPI spec parsing |
| **Structured I/O** | Built-in type validation | Manual validation |
| **Authentication** | MCP auth headers | API keys, JWT, OAuth |
| **Transport** | stdio, SSE, HTTP | HTTP only |
| **LLM Integration** | Native (tools → LLM function calling) | Requires custom adapter |
| **Streaming** | Built-in | Requires WebSocket/SSE |
| **Ecosystem** | Claude, Cursor, VS Code, custom | Universal |
| **Maturity** | Newer (2024+) | Mature |

**Recommendation:** Implement **both** — MCP for agent-native tools (Claude, Cursor) and REST API for programmatic access. They share the same backend auth + data layer.

### 5.4 MCP Server Implementation Plan

```
packages/mcp-server/           # NEW: Standalone MCP server package
├── src/
│   ├── index.ts               # MCP server entry point
│   ├── auth/
│   │   ├── apiKey.ts           # API key validation (reuse existing)
│   │   └── mcpAuth.ts          # MCP-specific auth headers
│   ├── tools/
│   │   ├── contacts.ts         # Contact CRUD tools
│   │   ├── deals.ts            # Deal CRUD tools
│   │   ├── tasks.ts            # Task tools
│   │   ├── activities.ts       # Activity logging tools
│   │   ├── emails.ts           # Email send/draft tools
│   │   ├── search.ts           # Global search tool
│   │   └── automation.ts       # Trigger automation tools
│   ├── resources/
│   │   ├── schema.ts           # Database schema resource
│   │   └── stats.ts            # Tenant stats resource
│   └── prompts/
│       ├── contactSummary.ts   # Contact summary prompts
│       └── dealCoaching.ts     # Deal coaching prompts
├── package.json
└── tsconfig.json
```

---

## 6. What Exists vs What's Needed

### 6.1 Gap Analysis

| Component | Exists? | Effort to Adapt | Priority |
|-----------|---------|-----------------|----------|
| Contact CRUD API | ✅ Full | Low — add agentId tracking | P0 |
| Deal CRUD API | ✅ Full | Low — add agentId tracking | P0 |
| Task API | ✅ Full | Low — add agentId tracking | P0 |
| Activity Logging | ✅ Full | Low — add actorType | P0 |
| Notes API | ✅ Full | Low — add agentId | P1 |
| Search API | ✅ Full | Low — agent-compatible | P1 |
| RBAC Engine | ✅ Full | Medium — add agent roles | P0 |
| Audit Logging | ✅ Full | Low — add actorType field | P0 |
| Webhook System | ✅ Full | Low — add agent events | P1 |
| Automation Engine | ✅ Full | Medium — add agent triggers | P1 |
| AI Gateway | ✅ Full | Medium — add agentic loop | P1 |
| Email Send | ✅ Full | Low — add agentId | P1 |
| API Keys | ✅ Full | Low — add agent key type | P0 |
| **Agent Entity** | ❌ None | **High — new schema + CRUD** | P0 |
| **MCP Server** | ❌ None | **High — new package** | P0 |
| **Agent Auth Flow** | ❌ None | **Medium — new auth path** | P0 |
| **Agent UI Views** | ❌ None | **Medium — new dashboard** | P1 |
| **Agent Approval Flow** | ❌ None | **Medium — new workflow** | P1 |
| **Agent-Specific Rate Limits** | ❌ None | **Low — extend existing** | P2 |
| **Agent Cost Tracking** | ❌ None | **Medium — new billing integration** | P2 |

### 6.2 Existing Code That Can Be Reused

| Existing Code | Reuse For |
|---------------|-----------|
| `lib/auth/middleware.ts` — `requireAuth()` | Agent auth middleware |
| `lib/tenant/context.ts` — `requireTenantCtx()` | Agent tenant context |
| `lib/webhooks/delivery.ts` — `queueWebhook()` | Agent action webhooks |
| `lib/automation/engine.ts` — `evaluateAutomations()` | Agent-triggered automations |
| `app/api/v2/[...path]/route.ts` — API gateway | Agent API gateway |
| `app/api/openapi/route.ts` — OpenAPI spec | Agent tool discovery |
| `lib/ai/gateway.ts` — `chat()` | Agent LLM calls |
| `lib/ai/common.ts` — `checkTokenAndLimits()` | Agent usage limits |
| `lib/ai/credits.ts` — credit management | Agent cost tracking |
| `drizzle/schema/core.ts` — `apiKeys` table | Agent API key storage |

---

## 7. Implementation Roadmap

### Phase 1: Agent Identity & Auth (Weeks 1-2)

**Goal:** Agents can authenticate and be identified as distinct actors

| Task | Files to Create/Modify | Effort |
|------|----------------------|--------|
| Add `agents` and `agentSessions` tables | `drizzle/schema/agents.ts` (NEW), `drizzle/migrations/` | 2d |
| Add `agentActions` table | `drizzle/schema/agents.ts` | 1d |
| Agent CRUD API | `app/api/tenant/agents/route.ts`, `[id]/route.ts` (NEW) | 2d |
| Agent auth middleware | `lib/auth/agent.ts` (NEW) — token-based auth for agents | 2d |
| Extend `requireAuth()` to support agent tokens | `lib/auth/middleware.ts` (MODIFY) | 1d |
| Extend RBAC for agent roles | `lib/tenant/context.ts` (MODIFY), role creation | 1d |
| Agent key type in `apiKeys` table | `drizzle/schema/core.ts` (MODIFY) | 0.5d |
| Agent seed data & test fixtures | Test files | 1d |

**Deliverable:** Agents can log in, get API keys, and be identified in the system.

### Phase 2: Agent-Aware Data Layer (Weeks 3-4)

**Goal:** All existing API routes track agent vs human actors

| Task | Files to Create/Modify | Effort |
|------|----------------------|--------|
| Add `performedByType` to audit logs | `drizzle/schema/core.ts` (MODIFY) | 0.5d |
| Extend all CRUD routes to accept `agentId` header | `app/api/tenant/contacts/route.ts`, `deals/route.ts`, `tasks/route.ts`, etc. (88 routes) | 5d |
| Agent action logging middleware | `lib/middleware/agentAudit.ts` (NEW) | 2d |
| Extend webhook payload with agent info | `lib/webhooks/delivery.ts` (MODIFY) | 1d |
| Add agent trigger events to automation engine | `lib/automation/engine.ts` (MODIFY) | 2d |
| Update OpenAPI spec for agent auth | `public/api/openapi.yaml` (MODIFY) | 1d |

**Deliverable:** Every API action knows whether it was performed by a human or agent.

### Phase 3: MCP Server (Weeks 5-7)

**Goal:** Agents can access the CRM via MCP tools

| Task | Files to Create/Modify | Effort |
|------|----------------------|--------|
| New MCP server package | `packages/mcp-server/` (NEW) | 3d |
| Contact tools (search, get, create, update) | `packages/mcp-server/src/tools/contacts.ts` | 2d |
| Deal tools (search, get, create, update, moveStage) | `packages/mcp-server/src/tools/deals.ts` | 2d |
| Task tools (create, complete) | `packages/mcp-server/src/tools/tasks.ts` | 1d |
| Activity & note tools | `packages/mcp-server/src/tools/activities.ts` | 1d |
| Email tools (send, draft) | `packages/mcp-server/src/tools/emails.ts` | 1d |
| Search tool | `packages/mcp-server/src/tools/search.ts` | 1d |
| Resources (schema, stats) | `packages/mcp-server/src/resources/` | 1d |
| Prompts (summary, coaching) | `packages/mcp-server/src/prompts/` | 1d |
| Auth integration (API key validation) | `packages/mcp-server/src/auth/` | 1d |
| MCP server config & tests | `packages/mcp-server/package.json`, tests | 2d |

**Deliverable:** Working MCP server that Claude/Cursor can connect to.

### Phase 4: Agent UI & Monitoring (Weeks 8-9)

**Goal:** Humans can manage and monitor agents

| Task | Files to Create/Modify | Effort |
|------|----------------------|--------|
| Agent dashboard page | `app/tenant/agents/page.tsx` (NEW) | 2d |
| Agent detail page | `app/tenant/agents/[id]/page.tsx` (NEW) | 2d |
| Agent activity log view | `app/tenant/agents/[id]/activity/page.tsx` (NEW) | 1d |
| Agent create/edit form | Component (NEW) | 1d |
| Agent status monitoring | Component (NEW) | 1d |
| Cost dashboard for agents | `app/tenant/agents/costs/page.tsx` (NEW) | 1d |

**Deliverable:** Full agent management UI.

### Phase 5: Advanced Agent Features (Weeks 10-12)

**Goal:** Agent-specific capabilities and governance

| Task | Files to Create/Modify | Effort |
|------|----------------------|--------|
| Agent approval workflow | `lib/agent/approval.ts` (NEW), approval UI | 3d |
| Agent rate limiting | `lib/agent/rateLimit.ts` (NEW) | 2d |
| Agent cost tracking + billing | `lib/agent/billing.ts` (NEW) | 2d |
| Agent-specific automation triggers | `lib/automation/engine.ts` (MODIFY) | 2d |
| Agent templates (pre-configured agents) | `lib/agent/templates.ts` (NEW) | 2d |
| Agent webhook events (agent.started, agent.completed) | `lib/webhooks/` (MODIFY) | 1d |

**Deliverable:** Production-grade agent governance.

---

## 8. Effort Estimation

### Summary by Phase

| Phase | Effort (Days) | Effort (Weeks) | Dependencies |
|-------|--------------|----------------|-------------|
| Phase 1: Agent Identity & Auth | 10.5 | 2 | None |
| Phase 2: Agent-Aware Data Layer | 11.5 | 2.5 | Phase 1 |
| Phase 3: MCP Server | 16 | 3 | Phase 1 |
| Phase 4: Agent UI & Monitoring | 9 | 2 | Phases 1+2 |
| Phase 5: Advanced Features | 12 | 2.5 | Phases 1+2 |
| **Total** | **59** | **12** | — |

### Effort by Component Type

| Component | New Code | Modify Existing | Tests |
|-----------|----------|-----------------|-------|
| Schema (Drizzle) | 3 tables (~3d) | 2 columns (~0.5d) | 0.5d |
| Backend API | 6 routes (~6d) | 88 routes (~5d) | 4d |
| MCP Server | 12 files (~16d) | 0 | 3d |
| Frontend UI | 6 pages (~9d) | 0 | 1d |
| Auth/AuthZ | 2 files (~3d) | 3 files (~2d) | 1d |
| Automation | 1 file (~2d) | 2 files (~3d) | 1d |
| **Total** | **~39d** | **~10.5d** | **~10.5d** |

### Team Composition (Recommended)

| Role | Count | Focus |
|------|-------|-------|
| Backend Engineer | 2 | Schema, API, MCP server |
| Frontend Engineer | 1 | Agent UI, dashboard |
| Full-Stack Engineer | 1 | Auth, automation, integration |
| QA Engineer | 1 | Testing, MCP validation |

With a 4-person team: ~3-4 weeks per phase, ~15-16 weeks total (4 months).

---

## 9. Risk Analysis

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| MCP spec changes rapidly | MCP server needs rework | Medium | Pin MCP SDK version, abstract transport layer |
| Agent auth complexity | Security vulnerabilities | Low | Reuse existing auth patterns, extensive testing |
| 88 route modifications | Regressions in existing APIs | Medium | Feature-flag agent tracking, incremental rollout |
| Agent cost runaways | Unexpected billing | Medium | Hard limits on actions/hour and cost/day |
| Agent performs destructive actions | Data loss | High | Approval workflows for high-risk actions (delete, bulk update) |
| MCP adoption uncertainty | Low usage | Medium | Also provide REST API; MCP is optional |

---

## 10. Decision Points

### Must Decide Before Phase 1

1. **Agent Identity Model:** Should agents be a separate entity type, or a subtype of `users`?
   - **Recommendation:** Separate entity (cleaner, no confusion with human users)
   - **Alternative:** Agent as a user with `isAgent: true` flag (simpler but messier)

2. **Agent Auth Method:** API key only, or also JWT sessions?
   - **Recommendation:** API key only for agents (simpler, no session management needed)
   - **Alternative:** JWT sessions for long-running agent processes

3. **Agent Data Isolation:** Should agents see all tenant data or only their assigned data?
   - **Recommendation:** RBAC-based (same as humans — agents get roles with permissions)
   - **Alternative:** Agent-specific data scoping (more complex, more secure)

### Must Decide Before Phase 3

4. **MCP Transport:** stdio only, or also HTTP/SSE?
   - **Recommendation:** Both (stdio for desktop, HTTP for remote/cloud agents)
   - **Alternative:** HTTP only (simpler, covers most use cases)

5. **MCP Tool Granularity:** Fine-grained (one tool per entity action) or coarse-grained (one tool per entity)?
   - **Recommendation:** Fine-grained (better LLM comprehension, clearer error messages)
   - **Alternative:** Coarse-grained (fewer tools, simpler server)

### Must Decide Before Phase 5

6. **Agent Approval Model:** Which actions require human approval?
   - **Recommendation:** Only destructive actions (delete, bulk update, send external email)
   - **Alternative:** All write actions require approval (too slow for agent workflows)

---

## Appendix A: MCP Tool Schema (Preview)

```json
{
  "tools": [
    {
      "name": "crm_contacts_search",
      "description": "Search contacts in the CRM by name, email, company, or custom fields",
      "inputSchema": {
        "type": "object",
        "properties": {
          "query": { "type": "string", "description": "Search query" },
          "filters": {
            "type": "object",
            "properties": {
              "lifecycleStage": { "type": "string" },
              "leadStatus": { "type": "string" },
              "assignedTo": { "type": "string" },
              "tags": { "type": "array", "items": { "type": "string" } }
            }
          },
          "limit": { "type": "number", "default": 20 }
        },
        "required": ["query"]
      }
    },
    {
      "name": "crm_deals_create",
      "description": "Create a new deal in the CRM",
      "inputSchema": {
        "type": "object",
        "properties": {
          "title": { "type": "string" },
          "contactId": { "type": "string" },
          "companyId": { "type": "string" },
          "pipelineId": { "type": "string" },
          "stageId": { "type": "string" },
          "amount": { "type": "number" },
          "closeDate": { "type": "string", "format": "date" }
        },
        "required": ["title"]
      }
    },
    {
      "name": "crm_tasks_create",
      "description": "Create a follow-up task for a contact or deal",
      "inputSchema": {
        "type": "object",
        "properties": {
          "title": { "type": "string" },
          "description": { "type": "string" },
          "contactId": { "type": "string" },
          "dealId": { "type": "string" },
          "dueDate": { "type": "string", "format": "date-time" },
          "assignedTo": { "type": "string" }
        },
        "required": ["title"]
      }
    }
  ]
}
```

## Appendix B: Existing Automation Trigger Events

```typescript
// Current trigger events (lib/automation/engine.ts)
export type TriggerEvent =
  | 'contact.created' | 'contact.updated'
  | 'deal.created'    | 'deal.updated' | 'deal.won' | 'deal.lost'
  | 'task.created'    | 'task.completed';

// Proposed new trigger events for agents
export type AgentTriggerEvent =
  | 'agent.action'       // When any agent action is performed
  | 'agent.created'      // When a new agent is created
  | 'agent.activated'    // When an agent is activated
  | 'agent.deactivated'  // When an agent is deactivated
  | 'agent.threshold'    // When agent hits cost/action threshold
  | 'agent.error';       // When an agent action fails
```
