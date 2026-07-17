# eve Framework Integration Report — NuCRM

**Date:** 2026-07-16
**Source:** https://eve.dev, https://vercel.com/eve, https://github.com/vercel/eve

---

## 1. What is eve?

Vercel's open-source AI agent framework (Apache-2.0, launched June 2026). "Next.js for agents" — an agent is a **directory of files**. Instructions in Markdown, tools in TypeScript, compiled into a durable service on Vercel.

```
my-agent/
└── agent/
    ├── agent.ts            # Model config (e.g. anthropic/claude-sonnet-5)
    ├── instructions.md     # System prompt
    ├── tools/              # Typed functions the model can call
    ├── skills/             # On-demand procedures loaded when relevant
    ├── channels/           # HTTP, Slack, Discord, Teams, Telegram, etc.
    ├── schedules/          # Recurring cron jobs
    ├── subagents/          # Specialist child agents for delegation
    ├── connections/        # OAuth links to external services
    └── sandbox/            # Isolated code execution environment
```

---

## 2. Key Features

| Feature | What it does |
|---|---|
| **Durable execution** | Sessions survive crashes/deploys, resume where they stopped |
| **Sandboxed compute** | Agent-generated code runs in isolated sandbox |
| **Human-in-the-loop** | Any tool can require approval; agent pauses and waits |
| **Channels** | Same agent works on HTTP, Slack, Discord, Teams, Telegram, etc. |
| **Connections** | OAuth for GitHub, Stripe, Salesforce, Notion, Linear, etc. |
| **Schedules** | Cron-driven agent runs for reports, digests |
| **Evals** | Test suites for agent behavior, runnable in CI |
| **Tracing** | OpenTelemetry spans → Braintrust, Datadog, Honeycomb |

---

## 3. How to Add eve to the CRM

### Integration Path (Minimal)

eve's `withEve()` Next.js plugin mounts an agent alongside the existing app:

```ts
// next.config.ts
import { withEve } from "eve/next";

export default withEve(nextConfig);
```

- Adds an `agent/` directory to the project root
- Agent routes are served at `/eve/v1/*` from the same deployment
- No CORS, no separate URL, no env var sync
- Works in dev (`npm run dev` boots both) and production (single Vercel deploy)

### What It Takes

| Step | Effort |
|---|---|
| `npm install eve@latest` | 1 command |
| Create `agent/` directory | ~15 min |
| Write `agent/instructions.md` (system prompt) | ~30 min |
| Add tools (DB queries, email, search, etc.) | ~1-2 hours per tool |
| Deploy to Vercel (already planned) | Already doing this |

---

## 4. CRM Use Cases for eve Agents

### 4.1 Sales Assistant Agent

**What it does:** Answers natural language questions about pipeline, deals, contacts.

```
User: "What's the total value of deals closing this quarter?"
Agent: Runs SQL/API query → returns summary
```

**Tools needed:**
- `get_pipeline_summary` — query deals table
- `get_deal_details` — fetch deal by name/ID
- `get_contact_info` — lookup contacts
- `get_team_performance` — per-rep metrics

**Eases:**
- Managers get answers without logging in
- No need to build custom dashboard for every question
- Works from Slack/Teams

### 4.2 Automation Agent

**What it does:** Executes workflow actions from natural language.

```
User: "Send follow-up email to all leads from the conference"
Agent: Queries leads → triggers email tool
```

**Tools needed:**
- `send_email` — trigger email via existing email system
- `create_task` — add task to CRM
- `update_deal_stage` — move deal through pipeline
- `assign_lead` — assign to team member

**Eases:**
- Non-technical team members can trigger complex workflows
- Reduces clicks through the UI
- Human-in-the-loop approval for destructive actions

### 4.3 Support Agent (Channel-based)

**What it runs on:** Slack/Discord channel connected via eve.

```
User in #support: "What's the status of ticket #3421?"
Agent: Looks up ticket → responds in channel
```

**Tools needed:**
- `get_ticket` — query tickets table
- `update_ticket_status` — change ticket state
- `get_customer_history` — past interactions

**Eases:**
- Support team works from Slack without switching to CRM
- Customers get faster answers
- Agent can handle 80% of "where's my ticket" queries

### 4.4 Analytics Agent (Scheduled)

**What it does:** Runs on a cron to produce daily/weekly summaries.

```
Schedule: Every Monday at 9 AM
Agent: Runs queries → posts summary to Slack channel
```

**Tools needed:**
- `get_weekly_revenue` — aggregate deals closed
- `get_pipeline_health` — stage distribution
- `get_activity_summary` — calls, emails, meetings logged

**Eases:**
- Automatic digest without building email reports
- Configurable schedule via cron syntax
- Can post to multiple channels

### 4.5 Lead Intelligence Agent

**What it does:** Enriches incoming leads from webforms.

```
Trigger: New lead created via webhook
Agent: Researches company → enriches record → auto-assigns
```

**Tools needed:**
- `search_company_info` — web search or external API
- `enrich_lead_record` — update CRM fields
- `score_lead` — run lead scoring model
- `assign_to_rep` — round-robin or rule-based

**Eases:**
- Automates manual enrichment work
- Leads get assigned faster
- Scoring happens instantly

---

## 5. Architecture Diagram (Proposed)

```
┌─────────────────────────────────────────────┐
│              Vercel Deployment               │
│                                               │
│  ┌─────────────────┐  ┌──────────────────┐   │
│  │   Next.js App   │  │   eve Agent(s)   │   │
│  │   (NuCRM)       │  │                  │   │
│  │   /tenant/*     │  │   /eve/v1/*      │   │
│  │   /api/*        │  │                  │   │
│  └────────┬────────┘  └────────┬─────────┘   │
│           │                     │             │
│           └─────────┬───────────┘             │
│                     │                         │
│           ┌─────────▼───────────┐             │
│           │   withEve(nextConfig)            │
│           │   (single deploy)                │
│           └─────────────────────┘            │
└─────────────────────────────────────────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
   PostgreSQL    Redis        Email/S3
   (Neon)       (Upstash)    (existing)
```

---

## 6. What It Would Ease

| Current Pain | How eve Helps |
|---|---|
| Building custom dashboards for every KPI | Natural language queries via agent |
| Support team switching between Slack & CRM | Agent works inside Slack channel |
| Manual lead enrichment | Scheduled agent enriches on-creation |
| Complex multi-step workflows | Agent chains tools + human approval |
| Weekly report generation | Cron-triggered agent produces digest |
| No easy way to expose CRM data in Slack/Teams | Channels connect agent to any platform |

---

## 7. Considerations

| Pro | Con |
|---|---|
| Filesystem-first = easy to version + review in PRs | Beta — APIs may change before GA |
| `withEase()` integration == minimal code changes | Locks you into Vercel ecosystem |
| Durable execution, sandbox, approvals built-in | Requires Node 24 (need to upgrade) |
| Multi-channel out of the box | New paradigm for the team to learn |
| Open source (Apache-2.0) | Many features depend on Vercel services |

---

## 8. Recommended Approach

**Phase 1 — Foundation (after Vercel migration)**
1. `npm install eve@latest`
2. Create `agent/` with instructions.md + agent.ts
3. Add 1-2 simple tools (query pipeline, search contacts)
4. Deploy with `withEve()` — verify `/eve/v1/*` works

**Phase 2 — Sales Assistant**
5. Add `get_pipeline_summary`, `get_deal_details`, `get_contact_info` tools
6. Connect to Slack channel
7. Let sales team test with real queries

**Phase 3 — Automation & Schedules**
8. Add write tools (update deal, send email) with approval gates
9. Set up Monday morning pipeline digest via schedule
10. Add support channel for ticket queries

**Phase 4 — Full Production**
11. Write evals for agent behavior
12. Set up monitoring + tracing
13. Train team on how to interact with agents

---

## 9. Timeline Estimate

| Phase | Time | Team |
|---|---|---|
| Phase 1: Foundation | 1-2 days | 1 developer |
| Phase 2: Sales Assistant | 3-5 days | 1 developer |
| Phase 3: Automation | 1 week | 1 developer + SME |
| Phase 4: Production | Ongoing | Depends on adoption |
