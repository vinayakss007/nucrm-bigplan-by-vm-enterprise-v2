# Agent + Human Unified CRM — All Decision Questions

**Purpose:** Complete list of all decisions that need to be made before implementation.
**Date:** 2026-07-03
**Status:** Awaiting decisions

---

## How to Use This Document

For each question:
1. Read the options
2. Pick one (or write your own)
3. Add a note if you have special reasoning
4. We will use your answers to lock the implementation plan

---

## Index: All Questions by Section

| Phase | Questions | Topics |
|-------|-----------|--------|
| Phase 1: Agent Identity & Auth | Q1–Q6 | Entity model, auth, data scope, keys, lifecycle, permissions |
| Phase 2: Agent-Aware Data Layer | Q7–Q10 | Audit granularity, attribution, automations, route updates |
| Phase 3: MCP Server | Q11–Q15 | Transport, tool size, deployment, auth, discovery |
| Phase 4: Agent UI & Monitoring | Q16–Q18 | Dashboard, activity view, error notifications |
| Phase 5: Advanced Features | Q19–Q23 | Approvals, rate limits, cost tracking, templates, webhooks |
| Phase 6: Departments | Q28–Q36 | Department model, structure, permissions, navigation, costs |
| Strategic: Niche & Specialization | Q37–Q43 | Target industry, agent-first design, specialized agents, data model, go-to-market, positioning, MVP scope |
| Cross-cutting | Q24–Q27 | Backward compat, feature flags, testing, docs |

---

## PHASE 1: Agent Identity & Auth (Before Sprint 1)

### Q1. Agent Entity Model
**Should agents be a separate entity type, or a subtype of `users`?**

- **Option A:** Separate entity — New `agents` table, distinct from `users`
  - Pros: Clean separation, no confusion, independent lifecycle, agent-specific fields
  - Cons: More tables, need to bridge agent↔user for "who created this agent"

- **Option B:** User subtype — Add `isAgent: true` flag to `users` table
  - Pros: Simpler schema, existing auth works as-is, no new entity needed
  - Cons: Agents pollute user lists, mixed concerns, harder to add agent-specific fields

**Your pick:** _______________

---

### Q2. Agent Authentication Method
**How should agents authenticate to the CRM?**

- **Option A:** API key only — Agents use `Bearer ak_...` keys (like existing API keys)
  - Pros: Simple, stateless, already supported by the API, no session management
  - Cons: No refresh token flow, keys can be long-lived

- **Option B:** JWT tokens — Agents get short-lived JWTs (like human sessions)
  - Pros: Expiry, refresh flow, more secure for long-running agents
  - Cons: More complex, need refresh token logic for agents

- **Option C:** Both — API key for simple integrations, JWT for complex agent flows
  - Pros: Flexible, covers all use cases
  - Cons: Two auth paths to maintain

**Your pick:** _______________

---

### Q3. Agent Data Scope
**Should agents see all tenant data, or only their assigned data?**

- **Option A:** RBAC-based — Same permissions as humans (agents get roles)
  - Pros: Consistent model, simple to implement, leverages existing RBAC
  - Cons: Agents might see more than needed

- **Option B:** Agent-specific scoping — Agents only see data they created or are assigned to
  - Pros: Least-privilege by default, cleaner agent views
  - Cons: More complex, need assignment logic

- **Option C:** Configurable per agent — Admin chooses scope when creating each agent
  - Pros: Maximum flexibility
  - Cons: More configuration surface, harder to reason about

**Your pick:** _______________

---

### Q4. Agent Naming Convention
**What prefix/identifier pattern for agent API keys?**

- **Option A:** `ak_agent_...` — Distinguish agent keys from human API keys
  - Pros: Clear distinction in logs, easy to filter
  - Cons: New prefix to manage

- **Option B:** Same `ak_...` prefix — Agents use the same key format as humans
  - Pros: No changes to key validation logic
  - Cons: Can't distinguish agent vs human keys at a glance

- **Option C:** Separate prefix `ag_...` — Completely separate key space
  - Pros: Maximum clarity, separate validation path
  - Cons: More changes to auth middleware

**Your pick:** _______________

---

### Q5. Agent Lifecycle States
**What states should an agent have?**

- **Option A:** Simple — `active`, `paused`, `archived`
  - Pros: Easy to understand, 3 states
  - Cons: No error state, no distinction between "never started" and "stopped"

- **Option B:** Full — `draft`, `active`, `paused`, `error`, `archived`
  - Pros: More granular, can track agent health
  - Cons: More state transitions to manage

- **Option C:** Extended — `draft`, `active`, `paused`, `rate_limited`, `error`, `archived`
  - Pros: Includes rate limit state for billing-aware agents
  - Cons: Most complex

**Your pick:** _______________

---

### Q6. Agent Creation Permissions
**Who can create agents in a tenant?**

- **Option A:** Admins only
  - Pros: Controlled, prevents agent sprawl
  - Cons: Bottleneck if many agents needed

- **Option B:** Admins + Managers
  - Pros: More flexibility, managers can create team agents
  - Cons: Need to define "manager" role

- **Option C:** Configurable per role
  - Pros: Maximum flexibility
  - Cons: More complex permission model

**Your pick:** _______________

---

## PHASE 2: Agent-Aware Data Layer (Before Sprint 2)

### Q7. Audit Trail Granularity
**How detailed should agent action logging be?**

- **Option A:** One log per API call — Every HTTP request gets an `agentActions` row
  - Pros: Complete audit trail, easy to trace
  - Cons: High volume, storage costs

- **Option B:** One log per logical action — Group related API calls (e.g., "create contact" = 1 log)
  - Pros: Cleaner audit trail, less noise
  - Cons: Need to define "logical action" boundaries

- **Option C:** Configurable per agent — Some agents log everything, others log summaries
  - Pros: Flexible, balance between detail and storage
  - Cons: Inconsistent audit trails

**Your pick:** _______________

---

### Q8. Agent Action Attribution
**How should CRM records track who (human or agent) performed an action?**

- **Option A:** Add `performedBy` + `performedByType` columns to `auditLogs`
  - Pros: Explicit, queryable, backward-compatible
  - Cons: Two new columns on a high-volume table

- **Option B:** Add `agentId` nullable column to all entity tables (contacts, deals, etc.)
  - Pros: Direct link, easy to query "all contacts created by agent X"
  - Cons: Many table modifications, NULL for human actions

- **Option C:** Both — auditLogs gets actor info, entity tables get `lastModifiedByAgentId`
  - Pros: Best of both worlds
  - Cons: Most changes

**Your pick:** _______________

---

### Q9. Agent-Triggered Automations
**Should agents be able to trigger automation workflows?**

- **Option A:** Yes — Agent actions fire the same triggers as human actions
  - Pros: Agents get full automation power, consistent behavior
  - Cons: Agents might trigger unintended automations

- **Option B:** Yes, but with separate triggers — New `agent.action` event type
  - Pros: Can build agent-specific automations, clear separation
  - Cons: More trigger types to manage

- **Option C:** No — Agents cannot trigger automations
  - Pros: Simple, no risk of agent-triggered cascades
  - Cons: Agents are less powerful

**Your pick:** _______________

---

### Q10. Bulk Agent Route Updates
**How should the 88 tenant API routes be updated to support agent tracking?**

- **Option A:** Middleware approach — Single middleware adds agent context to all routes
  - Pros: One change covers all routes, consistent
  - Cons: Middleware must correctly identify agent vs human for every route

- **Option B:** Per-route updates — Modify each route handler individually
  - Pros: Precise control per route
  - Cons: 88 files to touch, high regression risk

- **Option C:** Hybrid — Middleware for common patterns, per-route for special cases
  - Pros: Balanced approach
  - Cons: Need to decide which routes are "special"

**Your pick:** _______________

---

## PHASE 3: MCP Server (Before Sprint 3)

### Q11. MCP Transport Protocol
**Which transport should the MCP server support?**

- **Option A:** stdio only — For local/desktop clients (Claude Desktop, Cursor)
  - Pros: Simplest to implement, standard for local tools
  - Cons: Can't be used by remote/cloud agents

- **Option B:** HTTP/SSE only — For remote/cloud agent deployments
  - Pros: Works over network, scalable
  - Cons: Not compatible with some local MCP clients

- **Option C:** Both stdio and HTTP/SSE
  - Pros: Covers all use cases
  - Cons: Two transport implementations to maintain

**Your pick:** _______________

---

### Q12. MCP Tool Granularity
**How fine-grained should MCP tools be?**

- **Option A:** Fine-grained — One tool per action (contacts.search, contacts.get, contacts.create, contacts.update, contacts.delete)
  - Pros: Clear to LLMs, precise error messages, easier to permission
  - Cons: Many tools (15-20+)

- **Option B:** Coarse-grained — One tool per entity (contacts with action parameter)
  - Pros: Fewer tools (5-8), simpler server
  - Cons: Harder for LLMs to pick the right action, vague errors

- **Option C:** Mixed — Fine-grained for common actions, coarse for rare ones
  - Pros: Balanced
  - Cons: Inconsistent interface

**Your pick:** _______________

---

### Q13. MCP Server Deployment
**Where should the MCP server run?**

- **Option A:** In-process with Next.js — Same server, shares DB connection
  - Pros: No separate deployment, shared auth, simplest
  - Cons: Ties MCP to Next.js lifecycle, resource contention

- **Option B:** Standalone package — Separate process, separate deployment
  - Pros: Independent scaling, can be deployed anywhere
  - Cons: More deployment complexity, separate DB connection

- **Option C:** Both — In-process for dev, standalone for production
  - Pros: Best DX and production separation
  - Cons: Two modes to maintain

**Your pick:** _______________

---

### Q14. MCP Authentication
**How should MCP clients authenticate to the MCP server?**

- **Option A:** API key in MCP config — Key passed as environment variable or MCP header
  - Pros: Simple, stateless, standard MCP pattern
  - Cons: Key must be stored securely on client side

- **Option B:** OAuth2 flow — Agent gets OAuth token via standard flow
  - Pros: More secure, token expiry, revocable
  - Cons: More complex, requires OAuth server setup

- **Option C:** Session-based — MCP server issues short-lived session tokens
  - Pros: No long-lived secrets on client
  - Cons: Session management overhead

**Your pick:** _______________

---

### Q15. MCP Tool Discovery
**How should MCP clients discover available tools?**

- **Option A:** Static tool list — Tools defined in code, always available
  - Pros: Simple, predictable
  - Cons: No dynamic tool management

- **Option B:** Dynamic from DB — Tools generated from agent capabilities config
  - Pros: Different agents can have different tool sets
  - Cons: More complex, need tool registry

- **Option C:** Hybrid — Core tools always available, optional tools from config
  - Pros: Balanced
  - Cons: Two discovery paths

**Your pick:** _______________

---

## PHASE 4: Agent UI & Monitoring (Before Sprint 4)

### Q16. Agent Dashboard Scope
**What should the agent dashboard show?**

- **Option A:** Basic — List of agents, status, last active, action count
  - Pros: Simple, quick to build
  - Cons: Limited visibility

- **Option B:** Comprehensive — List + activity timeline + cost tracking + error log
  - Pros: Full operational visibility
  - Cons: More complex, more UI work

- **Option C:** Minimal — Just agent list with status toggle (active/paused)
  - Pros: Fastest to build, iterate later
  - Cons: Operators need CLI/API for details

**Your pick:** _______________

---

### Q17. Agent Activity View
**How should agent activity be displayed to humans?**

- **Option A:** Separate page — Dedicated "Agent Activity" tab
  - Pros: Clean separation, dedicated UI
  - Cons: Another page to navigate to

- **Option B:** Integrated into existing activity feed — Filter by agent
  - Pros: Unified view, consistent with existing UX
  - Cons: Activity feed gets more complex

- **Option C:** Both — Separate page + filter in main feed
  - Pros: Maximum flexibility
  - Cons: Most UI work

**Your pick:** _______________

---

### Q18. Agent Error Notifications
**How should humans be notified when an agent fails?**

- **Option A:** In-app notification — Standard CRM notification
  - Pros: Uses existing notification system
  - Cons: May be missed if not checking CRM

- **Option B:** Email notification — Alert email to tenant admin
  - Pros: Visible outside CRM, more urgent
  - Cons: Email fatigue, delivery issues

- **Option C:** Both in-app + email
  - Pros: Maximum coverage
  - Cons: Two notification paths

- **Option D:** Webhook — POST to a configurable URL
  - Pros: Integrates with external systems (Slack, PagerDuty)
  - Cons: Requires external setup

**Your pick:** _______________

---

## PHASE 5: Advanced Features (Before Sprint 5)

### Q19. Agent Approval Workflow
**Which agent actions should require human approval before execution?**

- **Option A:** No approval — Agents can do everything
  - Pros: Maximum agent autonomy, fastest execution
  - Cons: Risk of unintended bulk changes or data loss

- **Option B:** Destructive actions only — Delete, bulk update, send external email require approval
  - Pros: Protects against data loss, minimal friction
  - Cons: Some agent workflows blocked until approved

- **Option C:** All write actions — Any create/update/delete requires approval
  - Pros: Maximum control
  - Cons: Agents become very slow, defeats the purpose

- **Option D:** Configurable per agent — Admin sets approval requirements per agent
  - Pros: Flexible, different agents have different risk levels
  - Cons: More configuration, harder to reason about

**Your pick:** _______________

---

### Q20. Agent Rate Limiting Strategy
**How should agent actions be rate-limited?**

- **Option A:** Same limits as humans — Agents share the tenant's rate limits
  - Pros: Simple, no new limit model
  - Cons: Agents might consume all rate limit budget

- **Option B:** Separate limits — Each agent gets its own action/hour and cost/day limits
  - Pros: Predictable, agents can't starve humans
  - Cons: More limit tracking

- **Option C:** Tiered limits — Different limits based on agent type (AI vs external)
  - Pros: Matches cost profiles
  - Cons: More complex tier model

**Your pick:** _______________

---

### Q21. Agent Cost Tracking
**How should agent costs be tracked and billed?**

- **Option A:** Per-action cost — Each action has a cost (based on AI tokens, API calls)
  - Pros: Granular, fair billing
  - Cons: Complex cost calculation per action

- **Option B:** Flat monthly fee per agent — Fixed cost regardless of usage
  - Pros: Predictable, simple billing
  - Cons: May not match actual costs, heavy users subsidized

- **Option C:** Credit-based — Agents consume from a shared credit pool (like AI credits)
  - Pros: Reuse existing credit system, flexible
  - Cons: Need to allocate credits per agent

**Your pick:** _______________

---

### Q22. Agent Templates
**Should NuCRM ship with pre-built agent templates?**

- **Option A:** Yes — Pre-configured agents like "Sales Qualifier", "Support Bot", "Lead Warmer"
  - Pros: Fast onboarding, shows what's possible
  - Cons: Templates may not match tenant needs

- **Option B:** No — Agents created from scratch each time
  - Pros: Clean slate, no template maintenance
  - Cons: Slower onboarding, users must learn the system

- **Option C:** Yes, but minimal — Just 2-3 starter templates
  - Pros: Some guidance without over-engineering
  - Cons: Still may not be useful

**Your pick:** _______________

---

### Q23. Agent Webhook Events
**Should agent actions fire webhook events?**

- **Option A:** Yes — `agent.action`, `agent.completed`, `agent.error` events
  - Pros: External systems can react to agent activity
  - Cons: More webhook events to manage

- **Option B:** Only on errors — `agent.error` fires webhook
  - Pros: Alert on failures, less noise
  - Cons: Can't track completions externally

- **Option C:** Configurable per webhook — Tenant chooses which agent events to subscribe to
  - Pros: Maximum flexibility
  - Cons: More webhook configuration

**Your pick:** _______________

---

## PHASE 6: Department / Agent Workspace (Before Sprint 6)

> Context: As agent count grows (10, 50, 100+), a flat list becomes unmanageable. Departments group agents by business function (Sales, Marketing, Support, Product) so humans can navigate, monitor, and control agents by team.

### Q28. Department Model
**Should agents be organized into departments?**

- **Option A:** Yes — New `departments` table, agents belong to a department
  - Pros: Clean grouping, natural permission boundaries, scalable to many agents
  - Cons: Extra table, one more thing to configure

- **Option B:** No — Agents are flat, use tags/labels for grouping
  - Pros: Simpler, no new entity
  - Cons: Tags are ad-hoc, no structure, no department-level views

- **Option C:** Yes, but as "workspaces" not "departments" — more generic naming
  - Pros: Flexible (could be teams, projects, not just departments)
  - Cons: Less intuitive for business users

**Your pick:** _______________

---

### Q29. Department Structure
**What should the default departments be?**

- **Option A:** Fixed set — Sales, Marketing, Support, Product (cannot be changed)
  - Pros: Consistent across tenants, simpler UI
  - Cons: Not all businesses use these exact departments

- **Option B:** Configurable — Tenant creates/deletes departments
  - Pros: Matches each business's structure
  - Cons: More setup, UI for department management

- **Option C:** Starter templates — Pre-defined defaults, tenant can customize
  - Pros: Quick start with flexibility
  - Cons: Template maintenance

**Your pick:** _______________

---

### Q30. Department-Agent Relationship
**How many departments can one agent belong to?**

- **Option A:** Single department — Each agent belongs to exactly one department
  - Pros: Simple, clear ownership, easy to query
  - Cons: Agent can't serve two functions (e.g., both Sales and Support)

- **Option B:** Multiple departments — An agent can be in multiple departments with different roles
  - Pros: Flexible, one agent can serve multiple teams
  - Cons: Complex permissions, harder to display

- **Option C:** Primary + secondary — One main department, can be secondary in others
  - Pros: Balanced, agent has a home but can assist elsewhere
  - Cons: Medium complexity

**Your pick:** _______________

---

### Q31. Department Permissions
**Should department-level permissions restrict what agents can do?**

- **Option A:** No — All agents see all tenant data regardless of department
  - Pros: Simple, no permission conflicts
  - Cons: Sales agent could accidentally modify Support tickets

- **Option B:** Yes — Agents only access data relevant to their department
  - Pros: Least-privilege, prevents cross-department accidents
  - Cons: Complex to define "relevant data" per department

- **Option C:** Configurable per department — Admin sets data access rules per department
  - Pros: Maximum flexibility
  - Cons: More configuration surface

**Your pick:** _______________

---

### Q32. Department Manager Role
**Should each department have a human manager who oversees agents?**

- **Option A:** Yes — Each department has a `managerId` (human user) who can view/approve agent actions
  - Pros: Clear accountability, human-in-the-loop per department
  - Cons: Requires assigning managers

- **Option B:** No — All admins see all departments equally
  - Pros: Simpler, no manager assignment needed
  - Cons: No department-level human oversight

- **Option C:** Optional — Department can have a manager or not
  - Pros: Flexible
  - Cons: Some departments may lack oversight

**Your pick:** _______________

---

### Q33. Department Dashboard
**What should a department-level dashboard show?**

- **Option A:** Agent list — Just agents in this department with status
  - Pros: Simple, fast to build
  - Cons: Limited visibility

- **Option B:** Agent list + aggregate metrics — Actions taken, success rate, cost per department
  - Pros: Operational visibility per department
  - Cons: More metrics to compute

- **Option C:** Full command center — Agents + metrics + activity feed + pending approvals + cost breakdown
  - Pros: Complete department management view
  - Cons: Most complex UI

**Your pick:** _______________

---

### Q34. Department Navigation in UI
**How should departments appear in the CRM navigation?**

- **Option A:** Sidebar section — "Agents" section with department sub-items
  - Pros: Consistent with existing sidebar pattern
  - Cons: Sidebar gets longer

- **Option B:** Tabbed view — Single "Agents" page with department tabs
  - Pros: Compact, one page, easy switching
  - Cons: Tabs get crowded with many departments

- **Option C:** Dropdown filter — Single "Agents" page with department dropdown filter
  - Pros: Cleanest UI, filter on-demand
  - Cons: Extra click to filter

- **Option D:** Separate top-level nav — "Sales Agents", "Marketing Agents" as separate nav items
  - Pros: Most prominent, easy access
  - Cons: Clutters main navigation

**Your pick:** _______________

---

### Q35. Department + Agent Templates
**Should agent templates be organized by department?**

- **Option A:** Yes — Templates grouped by department (Sales templates, Support templates, etc.)
  - Pros: Easy to find relevant templates, matches department structure
  - Cons: More template categories to manage

- **Option B:** No — Flat template list, each template has a department tag
  - Pros: Simpler template system
  - Cons: Harder to browse by department

- **Option C:** No templates at all — Agents created from scratch
  - Pros: Maximum flexibility, no template maintenance
  - Cons: Slower onboarding

**Your pick:** _______________

---

### Q36. Department Cost Allocation
**Should costs be tracked per department?**

- **Option A:** Yes — Each department has its own cost budget/limit
  - Pros: department-level cost control, easy P&L per team
  - Cons: More billing complexity

- **Option B:** No — All agent costs go to tenant total
  - Pros: Simple billing
  - Cons: Can't see which department spends what

- **Option C:** Reporting only — Costs tracked per department for visibility, but limits are tenant-level
  - Pros: Visibility without enforcement complexity
  - Cons: Can't enforce department budgets

**Your pick:** _______________

---

## CROSS-CUTTING DECISIONS

### Q24. Backward Compatibility
**Should existing API consumers (without agent tracking) continue to work unchanged?**

- **Option A:** Yes — All new fields are optional, existing calls work as-is
  - Pros: Zero breaking changes, smooth migration
  - Cons: Some calls have no actor attribution

- **Option B:** Yes, with deprecation warnings — Old calls work but log warnings
  - Pros: Smooth migration with visibility into what needs updating
  - Cons: Warning noise

- **Option C:** No — All calls must include actor info (breaking change)
  - Pros: Complete attribution from day one
  - Cons: Breaking change, all integrations must update

**Your pick:** _______________

---

### Q25. Feature Flag Strategy
**Should agent features be behind a feature flag?**

- **Option A:** Yes — Agent features gated behind `agent-features` flag
  - Pros: Can ship code without enabling, gradual rollout, easy rollback
  - Cons: Extra flag management

- **Option B:** No — Agent features always available
  - Pros: Simpler, no flag overhead
  - Cons: Can't selectively enable/disable

- **Option C:** Plan-based — Agent features only on paid plans
  - Pros: Revenue model, controlled rollout
  - Cons: May limit adoption

**Your pick:** _______________

---

### Q26. Testing Strategy for Agent Features
**How should agent features be tested?**

- **Option A:** Unit tests only — Test agent auth, CRUD, and MCP tools in isolation
  - Pros: Fast, cheap
  - Cons: No integration validation

- **Option B:** Unit + integration tests — Test agent flows end-to-end with real DB
  - Pros: Higher confidence, catches integration bugs
  - Cons: Slower CI, more test infrastructure

- **Option C:** Unit + integration + E2E — Full browser tests for agent UI
  - Pros: Maximum coverage
  - Cons: Most expensive, Playwright currently unavailable

**Your pick:** _______________

---

### Q27. Documentation Scope
**What documentation should be created for the agent system?**

- **Option A:** API reference only — OpenAPI spec updated with agent endpoints
  - Pros: Machine-readable, auto-generated
  - Cons: No human-friendly guide

- **Option B:** API reference + developer guide — OpenAPI + MCP integration guide
  - Pros: Covers both REST and MCP developers
  - Cons: More docs to maintain

- **Option C:** Full docs — API reference + developer guide + admin guide + tutorials
  - Pros: Complete coverage for all audiences
  - Cons: Most documentation effort

**Your pick:** _______________

---

## Summary: Quick-Pick Table

| # | Question | Your Pick |
|---|----------|-----------|
| Q1 | Agent entity model | _______________ |
| Q2 | Agent auth method | _______________ |
| Q3 | Agent data scope | _______________ |
| Q4 | Agent key prefix | _______________ |
| Q5 | Agent lifecycle states | _______________ |
| Q6 | Agent creation permissions | _______________ |
| Q7 | Audit trail granularity | _______________ |
| Q8 | Action attribution | _______________ |
| Q9 | Agent-triggered automations | _______________ |
| Q10 | Bulk route update approach | _______________ |
| Q11 | MCP transport | _______________ |
| Q12 | MCP tool granularity | _______________ |
| Q13 | MCP server deployment | _______________ |
| Q14 | MCP authentication | _______________ |
| Q15 | MCP tool discovery | _______________ |
| Q16 | Agent dashboard scope | _______________ |
| Q17 | Agent activity view | _______________ |
| Q18 | Agent error notifications | _______________ |
| Q19 | Agent approval workflow | _______________ |
| Q20 | Agent rate limiting | _______________ |
| Q21 | Agent cost tracking | _______________ |
| Q22 | Agent templates | _______________ |
| Q23 | Agent webhook events | _______________ |
| Q24 | Backward compatibility | _______________ |
| Q25 | Feature flag strategy | _______________ |
| Q26 | Testing strategy | _______________ |
| Q27 | Documentation scope | _______________ |
| Q28 | Department model | _______________ |
| Q29 | Department structure | _______________ |
| Q30 | Department-agent relationship | _______________ |
| Q31 | Department permissions | _______________ |
| Q32 | Department manager role | _______________ |
| Q33 | Department dashboard | _______________ |
| Q34 | Department navigation in UI | _______________ |
| Q35 | Department + agent templates | _______________ |
| Q36 | Department cost allocation | _______________ |
| Q37 | Target industry/niche | _______________ |
| Q38 | Agent-first vs human-first | _______________ |
| Q39 | Specialized agent types | _______________ |
| Q40 | Industry-specific data model | _______________ |
| Q41 | Niche go-to-market | _______________ |
| Q42 | Competitive positioning | _______________ |
| Q43 | MVP niche scope | _______________ |

---

## STRATEGIC DECISIONS: Niche & Specialization (Before Build)

> Context: The current plan is a generic "CRM + AI agents." To compete against Salesforce, HubSpot, and Zoho, you need to niche down — pick a specific industry, workflow, or agent type and go deep instead of broad.

### Q37. Target Industry / Niche
**Which industry should NuCRM target first?**

- **Option A:** SaaS / Software Companies
  - Pros: You're a developer (understand the space), tech-savvy buyers, clear metrics (MRR, churn, LTV), high willingness to pay
  - Cons: Crowded market (HubSpot, Salesforce dominate)

- **Option B:** Real Estate
  - Pros: Unique workflows (listings, showings, offers), agents=AI agents is a natural fit, high deal values
  - Cons: Industry-specific knowledge needed, slower sales cycles

- **Option C:** E-commerce / DTC Brands
  - Pros: High volume transactions, cart recovery is clear ROI, integrates with Shopify/WooCommerce
  - Cons: Low margins, price-sensitive buyers

- **Option D:** Healthcare / Clinics
  - Pros: HIPAA compliance is a moat, patient intake automation, high willingness to pay
  - Cons: Heavy regulation, long sales cycles, complex requirements

- **Option E:** Legal / Law Firms
  - Pros: Billable hour tracking, client intake, document management are specific
  - Cons: Very traditional industry, slow adoption

- **Option F:** Recruiting / Staffing
  - Pros: Candidate screening, interview scheduling, pipeline management are specific
  - Cons: Existing ATS competitors (Greenhouse, Lever)

- **Option G:** Stay Generic — No niche
  - Pros: Broadest market, flexible product
  - Cons: Competes with everyone, hard to differentiate

**Your pick:** _______________

---

### Q38. Agent-First vs Human-First Design
**Should the CRM be designed for humans first (with agents as add-on) or agents first (with humans as supervisors)?**

- **Option A:** Human-first + agents as add-on (traditional approach)
  - Pros: Familiar UX, easier to sell to traditional buyers
  - Cons: Agents feel bolted on, not a differentiator

- **Option B:** Agent-first + humans as supervisors (bold approach)
  - Pros: Unique positioning, agents do 80% of work, humans do 20% (strategy + approvals)
  - Cons: Harder to sell, unfamiliar UX, requires change management

- **Option C:** Balanced — Both human UI and agent UI equally designed
  - Pros: Covers both audiences
  - Cons: More UI work, may feel unfocused

**Your pick:** _______________

---

### Q39. Specialized Agent Types
**Which agent types should be built for your chosen niche?**

- **Option A:** Sales agents only — Lead qualification, deal follow-up, pipeline management
  - Pros: Clear ROI, easiest to build, most CRM users need this
  - Cons: Only covers one function

- **Option B:** Sales + Support agents — Add ticket resolution, customer onboarding
  - Pros: Covers two major business functions
  - Cons: More complex, two different workflows

- **Option C:** Full suite — Sales + Support + Marketing + Operations agents
  - Pros: Complete coverage, maximum value
  - Cons: Massive scope, hard to do well

- **Option D:** Let me define custom agents per niche (see below)

**Custom agents for your niche:**

```
Niche: _______________

Sales Agents:
1. _______________
2. _______________
3. _______________

Support Agents:
1. _______________
2. _______________
3. _______________

Marketing Agents:
1. _______________
2. _______________
3. _______________

Operations Agents:
1. _______________
2. _______________
3. _______________
```

**Your pick:** _______________

---

### Q40. Industry-Specific Data Model
**Should the CRM schema include industry-specific fields and entities?**

- **Option A:** Yes — Add industry-specific tables and fields (e.g., for SaaS: subscriptions, MRR, churn signals)
  - Pros: Deep integration, agents have more context, better analytics
  - Cons: More complex schema, harder to maintain

- **Option B:** No — Use generic CRM tables, let agents adapt via prompts
  - Pros: Simpler schema, one codebase for all industries
  - Cons: Less context for agents, generic analytics

- **Option C:** Hybrid — Core generic tables + optional industry plugins
  - Pros: Flexible, core stays clean, plugins add depth
  - Cons: Plugin system complexity

**Industry-specific data ideas (fill for your niche):**

```
Niche: _______________

New tables needed:
1. _______________
2. _______________
3. _______________

New fields on existing tables:
1. contacts._______________
2. deals._______________
3. companies._______________

New API routes needed:
1. /api/_______________
2. /api/_______________
3. /api/_______________
```

**Your pick:** _______________

---

### Q41. Niche Go-to-Market
**How should NuCRM reach its niche audience?**

- **Option A:** Content marketing — Blog posts, guides, templates for the niche
  - Pros: Low cost, builds authority, SEO
  - Cons: Slow, requires consistent content

- **Option B:** Integrations — Connect to tools the niche already uses
  - Pros: Meets users where they are, quick adoption
  - Cons: Depends on third-party APIs

- **Option C:** Direct sales — Outbound to companies in the niche
  - Pros: Controlled, measurable
  - Cons: Expensive, requires sales team

- **Option D:** Community — Build a community of users in the niche
  - Pros: Strong retention, word-of-mouth
  - Cons: Takes time, resource-intensive

- **Option E:** All of the above (long-term)

**Niche-specific integrations to build:**

```
Niche: _______________

Must-have integrations:
1. _______________ (why: _______________)
2. _______________ (why: _______________)
3. _______________ (why: _______________)

Nice-to-have integrations:
1. _______________
2. _______________
3. _______________
```

**Your pick:** _______________

---

### Q42. Competitive Positioning
**How should NuCRM position against existing CRM + AI tools?**

- **Option A:** "AI-native CRM" — Built for agents from day one, not bolted on
  - Pros: Clear differentiator, forward-looking positioning
  - Cons: Requires proof that agents actually work

- **Option B:** "CRM for [Niche]" — Industry-specific features and agents
  - Pros: Clear target market, less competition
  - Cons: Smaller market, niche may be too small

- **Option C:** "Agent workspace" — Not a CRM, but a place where agents do CRM work
  - Pros: New category, no direct competitors
  - Cons: Hard to explain, market education needed

- **Option D:** "Open-source CRM + Agents" — Community-driven, customizable
  - Pros: Adoption through open source, community contributions
  - Cons: Harder to monetize, support burden

**Your positioning statement (fill in):**

```
NuCRM is the _______________ for _______________
that helps them _______________
unlike _______________ which _______________
```

**Your pick:** _______________

---

### Q43. MVP Niche Scope
**What is the minimum viable product for your niche?**

- **Option A:** Core CRM + 2-3 agents for one niche
  - Pros: Fast to build, focused, validates the concept
  - Cons: Limited functionality

- **Option B:** Core CRM + full agent suite for one niche
  - Pros: Complete solution for the niche
  - Cons: Larger scope, slower to ship

- **Option C:** Core CRM only (no agents yet) for one niche
  - Pros: Fastest to ship, validates CRM demand first
  - Cons: No agent differentiation yet

- **Option D:** Generic CRM + agents (no niche focus)
  - Pros: Broadest market
  - Cons: Hardest to differentiate

**MVP scope definition:**

```
Niche: _______________

Core CRM features in MVP:
1. _______________
2. _______________
3. _______________

Agents in MVP:
1. _______________
2. _______________
3. _______________

Integrations in MVP:
1. _______________
2. _______________

Timeline: _______________ weeks
```

**Your pick:** _______________
