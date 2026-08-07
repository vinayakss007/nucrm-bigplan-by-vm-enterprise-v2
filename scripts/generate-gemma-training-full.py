#!/usr/bin/env python3
"""
NuCRM Gemma Training Data Generator — FULL CRM Coverage
Generates ShareGPT-format conversations for ALL CRM capabilities.

Categories:
  1. contact_management - Create, update, search, merge, import/export contacts
  2. lead_management - Create, qualify, score, nurture, convert leads
  3. deal_management - Pipeline, stages, forecasting, win/loss analysis
  4. task_management - Create, assign, prioritize, recurring tasks
  5. ticket_management - Support tickets, SLA, escalation, resolution
  6. email_composition - Cold outreach, follow-ups, proposals, newsletters
  7. email_sequences - Multi-step drip campaigns, A/B testing
  8. ai_scoring - Lead scoring, deal scoring, churn prediction, engagement scoring
  9. ai_suggestions - Next best action, recommendations, insights
  10. ai_chat - Conversational CRM assistant, Q&A, brainstorming
  11. analytics - Reports, dashboards, KPIs, trends, forecasting
  12. automation - Workflows, triggers, rules, auto-assignments
  13. invoicing - Create, send, track, reminders, payment processing
  14. meeting_management - Schedule, prepare, follow-up, transcripts
  15. document_management - Proposals, contracts, templates, e-signatures
  16. communication - WhatsApp, SMS, call logging, voicemail
  17. pipeline_management - Custom pipelines, stage gates, velocity
  18. reporting - Revenue, activity, team performance, custom reports
  19. integration - Zapier, webhooks, API, data sync
  20. ai_strategy - Market analysis, competitive intelligence, growth planning
  21. customer_success - Onboarding, health scores, retention, expansion
  22. data_quality - Deduplication, enrichment, validation, cleanup
  23. collaboration - Team notes, mentions, shared views, permissions
  24. mobile - Mobile app features, offline, notifications
  25. compliance - GDPR, CAN-SPAM, data retention, audit logs
"""

import json
import uuid
import random
from datetime import datetime, timedelta

# ============================================================
# TEMPLATE DATA
# ============================================================

FIRST_NAMES = ["James", "Mary", "Robert", "Patricia", "John", "Jennifer", "Michael", "Linda",
    "David", "Elizabeth", "William", "Barbara", "Richard", "Susan", "Joseph", "Jessica",
    "Thomas", "Sarah", "Christopher", "Karen", "Charles", "Lisa", "Daniel", "Nancy",
    "Matthew", "Betty", "Anthony", "Margaret", "Mark", "Sandra", "Donald", "Ashley",
    "Steven", "Dorothy", "Paul", "Kimberly", "Andrew", "Emily", "Joshua", "Donna",
    "Priya", "Rahul", "Amit", "Sneha", "Vikram", "Ananya", "Arjun", "Meera",
    "Wei", "Yuki", "Hiroshi", "Sakura", "Carlos", "Maria", "Juan", "Ana",
    "Mohammed", "Fatima", "Ali", "Layla", "Oliver", "Emma", "Liam", "Sophia"]

LAST_NAMES = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
    "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson",
    "Thomas", "Taylor", "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson",
    "White", "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson", "Walker",
    "Young", "Allen", "King", "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores",
    "Patel", "Sharma", "Kumar", "Singh", "Gupta", "Shah", "Chen", "Wang", "Li",
    "Zhang", "Tanaka", "Sato", "Suzuki", "Kim", "Park", "Choi", "Muller", "Schmidt",
    "Fischer", "Weber", "Moreau", "Dubois", "Bernard", "Petit", "Rousseau", "Garcia"]

COMPANIES = ["TechCorp Solutions", "Global Innovations Inc", "Apex Digital Agency",
    "Meridian Consulting", "Quantum Analytics", "Nexus Technologies", "Pinnacle Systems",
    "Horizon Software", "Elevate Marketing", "Catalyst Ventures", "Synergy Labs",
    "Vanguard Enterprises", "Prism Communications", "Atlas Infrastructure",
    "Spectrum Dynamics", "Vertex Analytics", "Fusion Works", "Nimbus Cloud",
    "Pulse Metrics", "Zenith Solutions", "Cobalt Industries", "Aether Systems",
    "Solaris Energy", "Ember Studios", "Onyx Data", "Crimson Tech", "Azure Partners",
    "Sterling Finance", "Alpine Ventures", "Cascade Analytics", "Phoenix Rising LLC",
    "Titan Manufacturing", "Sterling Logistics", "Summit Healthcare", "Verdant Eco"]

TITLES = ["CEO", "CTO", "VP Sales", "VP Marketing", "Director of Operations",
    "Sales Manager", "Marketing Manager", "Product Manager", "Engineering Lead",
    "Account Executive", "Business Development Rep", "Customer Success Manager",
    "Solutions Architect", "Data Analyst", "Growth Hacker", "Head of Partnerships",
    "Chief Revenue Officer", "Sales Development Rep", "Territory Manager",
    "Regional Director", "Channel Manager", "Enterprise Account Manager",
    "Small Business Consultant", "Digital Marketing Specialist", "Content Strategist"]

DEPARTMENTS = ["Sales", "Marketing", "Engineering", "Product", "Operations",
    "Finance", "HR", "Legal", "Customer Success", "IT", "Executive", "R&D"]

INDUSTRIES = ["Technology", "Healthcare", "Finance", "Education", "Manufacturing",
    "Retail", "Real Estate", "Media", "Energy", "Telecommunications", "Automotive",
    "Agriculture", "Hospitality", "Logistics", "Construction"]

STAGES = ["lead", "qualified", "proposal", "negotiation", "closed_won", "closed_lost"]
PRIORITIES = ["low", "medium", "high", "urgent"]
TICKET_STATUSES = ["open", "in_progress", "waiting", "resolved", "closed"]
LEAD_STATUSES = ["new", "contacted", "qualified", "unqualified", "converted"]
DEAL_STATUSES = ["open", "won", "lost", "cancelled"]
TASK_STATUSES = ["pending", "in_progress", "completed", "cancelled"]

def rand_name():
    return f"{random.choice(FIRST_NAMES)} {random.choice(LAST_NAMES)}"

def rand_email(name):
    clean = name.lower().replace(" ", ".")
    domains = ["gmail.com", "outlook.com", "yahoo.com", "company.com", "work.io",
               "techcorp.com", "enterprise.co", "business.org", "startup.io"]
    return f"{clean}@{random.choice(domains)}"

def rand_phone():
    return f"+1{random.randint(200,999)}{random.randint(100,999)}{random.randint(1000,9999)}"

def rand_company():
    return random.choice(COMPANIES)

def rand_amount():
    return round(random.uniform(500, 250000), 2)

def rand_score():
    return random.randint(1, 100)

# ============================================================
# CONVERSATION TEMPLATES — 25 CATEGORIES
# ============================================================

TEMPLATES = {}

# 1. CONTACT MANAGEMENT
TEMPLATES["contact_management"] = [
    {
        "human": "Add a new contact: {name}, {title} at {company}, email {email}, phone {phone}",
        "gpt": "Contact **{name}** has been created:\n\n- **Title:** {title}\n- **Company:** {company}\n- **Email:** {email}\n- **Phone:** {phone}\n- **Lifecycle Stage:** Lead\n\nContact added to your database. Would you like to add notes or schedule a follow-up?"
    },
    {
        "human": "Search for contacts at {company}",
        "gpt": "Found **3 contacts** at {company}:\n\n1. **{name1}** — {title1} — {email1}\n2. **{name2}** — {title2} — {email2}\n3. **{name3}** — {title3} — {email3}\n\nWould you like to view details or send a message to any of these contacts?"
    },
    {
        "human": "Update {name}'s phone number to {phone}",
        "gpt": "Updated **{name}**'s phone number to **{phone}**.\n\nPrevious: +15551234567\nNew: {phone}\n\nChange logged in activity history."
    },
    {
        "human": "Merge contacts {name1} and {name2} — they're the same person",
        "gpt": "Merging contacts:\n\n- **Primary:** {name1} ({email1})\n- **Duplicate:** {name2} ({email2})\n\nAll activities, notes, and deal associations will transfer to {name1}. The duplicate will be archived.\n\nMerge complete. {name1} now has 12 combined interactions."
    },
    {
        "human": "Import contacts from this CSV file",
        "gpt": "CSV file parsed. Found **247 contacts** in the import file.\n\nValidation results:\n- ✅ 234 valid contacts ready to import\n- ⚠️ 8 duplicate emails detected (will be skipped)\n- ❌ 5 invalid email formats\n\nReady to import 234 contacts. Would you like to assign them all to a specific campaign or tag?"
    },
    {
        "human": "Export all contacts with the 'VIP' tag to CSV",
        "gpt": "Exported **89 VIP contacts** to CSV file.\n\nFile: `vip-contacts-export-2026-08-07.csv`\nColumns: Name, Email, Phone, Company, Title, Tags, Last Activity, Created\n\nDownload ready. Would you also like to export their deal history?"
    },
    {
        "human": "What's the activity history for {name}?",
        "gpt": "Activity history for **{name}** ({company}):\n\n| Date | Type | Details |\n|------|------|---------|\n| Aug 5 | Email | Opened proposal email |\n| Aug 3 | Call | 15-min discovery call |\n| Aug 1 | Note | Interested in Enterprise plan |\n| Jul 28 | Meeting | Product demo attended |\n| Jul 25 | Email | Initial outreach opened |\n\n**Summary:** 5 interactions over 11 days. Last active 2 days ago. Engagement trending up."
    },
    {
        "human": "Tag {name} as 'decision-maker' and 'enterprise'",
        "gpt": "Tags updated for **{name}**:\n\n- Added: `decision-maker`, `enterprise`\n- Existing: `high-value`, `q3-pipeline`\n- Total tags: 4\n\nThese tags will help with segmentation and campaign targeting."
    },
]

# 2. LEAD MANAGEMENT
TEMPLATES["lead_management"] = [
    {
        "human": "Create a new lead from {name} at {company}",
        "gpt": "Lead created for **{name}** ({company}):\n\n- **Status:** New\n- **Source:** Website Form\n- **Score:** Pending\n- **Assigned:** Auto-assigned to sales pool\n\nLead is now in your pipeline. Would you like to qualify this lead or send an introduction email?"
    },
    {
        "human": "Qualify lead {name} — budget is {amount}, timeline is 3 months",
        "gpt": "Lead **{name}** qualified with BANT criteria:\n\n| Criterion | Status | Details |\n|-----------|--------|---------|\n| Budget | ✅ | ${amount:,.2f} allocated |\n| Authority | ⏳ | Need to confirm decision-maker |\n| Need | ✅ | Identified pain point |\n| Timeline | ✅ | 3 months |\n\n**Qualification Score:** 75/100\n**Recommended Next Step:** Schedule discovery call to confirm authority.\n\nLead moved to **Qualified** stage."
    },
    {
        "human": "What's my pipeline looking like this month?",
        "gpt": "📊 **Pipeline Summary — August 2026**\n\n| Stage | Count | Value |\n|-------|-------|-------|\n| New Leads | 23 | $184,500 |\n| Qualified | 15 | $342,000 |\n| Proposal | 8 | $275,000 |\n| Negotiation | 4 | $180,000 |\n| **Total** | **50** | **$981,500** |\n\n**Key Metrics:**\n- Pipeline coverage: 3.2x quota\n- Average deal size: $19,630\n- Win rate (this month): 28%\n- Expected close: $425,000\n\nYou're on track to hit target. Need a breakdown by rep?"
    },
    {
        "human": "Score all leads in the 'Enterprise' segment",
        "gpt": "Lead scoring completed for **47 Enterprise leads**:\n\n**Score Distribution:**\n- 🔴 Hot (80-100): 12 leads — $480,000 potential\n- 🟡 Warm (50-79): 21 leads — $630,000 potential\n- 🔵 Cool (20-49): 11 leads — $220,000 potential\n- ⚪ Cold (0-19): 3 leads — $45,000 potential\n\n**Top 5 Hottest Leads:**\n1. {name1} ({company1}) — Score: 94 — $85,000\n2. {name2} ({company2}) — Score: 91 — $120,000\n3. {name3} ({company3}) — Score: 88 — $65,000\n\nRecommendation: Focus outreach on the 12 hot leads. Want me to draft personalized emails?"
    },
    {
        "human": "Convert lead {name} to a deal",
        "gpt": "Lead **{name}** converted to deal:\n\n- **Deal Name:** {company} Enterprise Plan\n- **Value:** ${amount:,.2f}\n- **Stage:** Proposal\n- **Expected Close:** Sep 15, 2026\n- **Contact:** {name} ({email})\n- **Company:** {company}\n\nDeal created in pipeline. Activity logged. Would you like to generate a proposal?"
    },
    {
        "human": "Which leads haven't been contacted in 7+ days?",
        "gpt": "⚠️ **14 leads** haven't been contacted in 7+ days:\n\n| Lead | Company | Last Contact | Days | Value |\n|------|---------|--------------|------|-------|\n| {name1} | {company1} | Jul 31 | 7 | $45,000 |\n| {name2} | {company2} | Jul 29 | 9 | $32,000 |\n| {name3} | {company3} | Jul 28 | 10 | $78,000 |\n\n**Risk:** $456,000 in pipeline at risk of going cold.\n\n**Recommended Actions:**\n1. Send follow-up email to {name1} (highest value)\n2. Call {name3} — they showed strong interest\n3. Re-assign {name2} to senior rep\n\nWant me to draft follow-up emails?"
    },
    {
        "human": "Nurture lead {name} with a 5-email sequence",
        "gpt": "5-email nurture sequence created for **{name}**:\n\n| # | Day | Subject | Purpose |\n|---|-----|---------|---------|\n| 1 | 0 | Welcome to NuCRM | Introduction |\n| 2 | 3 | Industry insights for {company} | Value-add |\n| 3 | 7 | Case study: Similar company | Social proof |\n| 4 | 12 | Quick question about your needs | Engagement |\n| 5 | 18 | Limited-time offer | Conversion |\n\nSequence starts tomorrow at 9:00 AM. Emails will pause if {name} replies. Want to customize any email?"
    },
    {
        "human": "Show me leads that converted this quarter",
        "gpt": "📈 **Q3 2026 Conversions**\n\n| Lead | Company | Converted | Deal Value | Source |\n|------|---------|-----------|------------|--------|\n| {name1} | {company1} | Jul 5 | $85,000 | Website |\n| {name2} | {company2} | Jul 12 | $42,000 | Referral |\n| {name3} | {company3} | Jul 28 | $120,000 | LinkedIn |\n| {name4} | {company4} | Aug 2 | $67,000 | Cold Outbound |\n\n**Total:** 12 conversions | **Revenue:** $847,000\n**Best Source:** Referrals (45% conversion rate)\n**Average Time to Convert:** 18 days"
    },
]

# 3. DEAL MANAGEMENT
TEMPLATES["deal_management"] = [
    {
        "human": "Create a deal with {name} for {amount}",
        "gpt": "Deal created:\n\n- **Deal:** {company} Enterprise Plan\n- **Contact:** {name}\n- **Value:** ${amount:,.2f}\n- **Stage:** Lead\n- **Probability:** 10%\n- **Expected Revenue:** ${amount2:,.2f}\n\nDeal added to your pipeline. Would you like to advance it to the next stage?"
    },
    {
        "human": "Move deal with {name} to Proposal stage",
        "gpt": "Deal **{company} Enterprise Plan** moved to **Proposal** stage.\n\n- **Previous Stage:** Qualified (25%)\n- **New Stage:** Proposal (50%)\n- **Value:** ${amount:,.2f}\n- **Expected Revenue:** ${amount2:,.2f}\n\nNext step: Send proposal document. Want me to generate one?"
    },
    {
        "human": "What deals are closing this month?",
        "gpt": "🎯 **Deals Closing August 2026**\n\n| Deal | Contact | Value | Stage | Days Left |\n|------|---------|-------|-------|----------|\n| {company1} | {name1} | $85,000 | Negotiation | 5 |\n| {company2} | {name2} | $42,000 | Proposal | 12 |\n| {company3} | {name3} | $120,000 | Negotiation | 8 |\n\n**Total Expected:** $247,000\n**Weighted:** $198,000 (80% avg probability)\n\n**Risk Assessment:**\n- {company1}: Low risk — verbal commitment received\n- {company2}: Medium risk — competitor evaluation\n- {company3}: High risk — budget approval pending"
    },
    {
        "human": "Forecast revenue for Q3",
        "gpt": "📊 **Q3 2026 Revenue Forecast**\n\n| Scenario | Revenue | Probability |\n|----------|---------|-------------|\n| Best Case | $1,250,000 | 25% |\n| Expected | $875,000 | 50% |\n| Conservative | $620,000 | 75% |\n\n**Pipeline Analysis:**\n- Active Deals: 34\n- Total Pipeline: $2,450,000\n- Weighted Pipeline: $1,102,500\n- Quota: $900,000\n- **Coverage:** 2.7x\n\n**Recommendation:** Need 3 more qualified deals to hit quota with confidence."
    },
    {
        "human": "Why did we lose the {company} deal?",
        "gpt": "📋 **Lost Deal Analysis: {company}**\n\n**Deal Details:**\n- Value: $95,000\n- Stage at Loss: Negotiation\n- Days in Pipeline: 47\n- Competitor: Apex Solutions\n\n**Loss Reasons (from exit survey):**\n1. Price too high (cited by contact)\n2. Missing feature: API integration\n3. Competitor offered 20% discount\n\n**Lessons Learned:**\n- Our pricing is 15% above market for mid-market\n- API integration is a deal-breaker for tech companies\n- Need better discount approval process\n\n**Action Items:**\n- [ ] Review pricing tiers\n- [ ] Prioritize API integration in roadmap\n- [ ] Create discount guidelines for sales team"
    },
    {
        "human": "Update deal probability to 75% for {name}'s deal",
        "gpt": "Deal probability updated:\n\n- **Deal:** {company} Enterprise Plan\n- **Contact:** {name}\n- **Previous Probability:** 50%\n- **New Probability:** 75%\n- **Value:** ${amount:,.2f}\n- **Expected Revenue:** ${amount2:,.2f}\n\nWeighted pipeline updated. Deal is now in top 10 by expected revenue."
    },
]

# 4. TASK MANAGEMENT
TEMPLATES["task_management"] = [
    {
        "human": "Create a task to call {name} tomorrow at 2pm",
        "gpt": "Task created:\n\n- **Title:** Call {name}\n- **Due:** Tomorrow, Aug 8, 2:00 PM\n- **Priority:** Medium\n- **Contact:** {name} ({company})\n- **Reminder:** 15 minutes before\n\nTask added to your queue. Would you like to add notes about what to discuss?"
    },
    {
        "human": "What tasks are due today?",
        "gpt": "📋 **Today's Tasks (Aug 7, 2026)**\n\n| # | Task | Contact | Priority | Status |\n|---|------|---------|----------|--------|\n| 1 | Send proposal | {name1} | 🔴 High | Pending |\n| 2 | Follow-up call | {name2} | 🟡 Medium | Pending |\n| 3 | Review contract | {name3} | 🔴 High | In Progress |\n| 4 | Update CRM notes | — | 🟢 Low | Completed |\n\n**Summary:** 4 tasks | 1 completed | 2 high priority remaining\n\n**Next up:** Send proposal to {name1} (due 10:00 AM)"
    },
    {
        "human": "Set up a recurring task for weekly pipeline review every Monday at 9am",
        "gpt": "Recurring task created:\n\n- **Title:** Weekly Pipeline Review\n- **Schedule:** Every Monday at 9:00 AM\n- **Duration:** Ongoing\n- **Priority:** High\n- **Assignee:** You\n- **Description:** Review all active deals, update probabilities, identify at-risk opportunities\n\nFirst occurrence: Monday, Aug 10, 2026. Would you like to add a checklist?"
    },
    {
        "human": "Mark the proposal task for {name} as complete",
        "gpt": "✅ Task completed: **Send proposal to {name}**\n\n- **Completed:** Aug 7, 2026, 10:32 AM\n- **Time spent:** 25 minutes\n- **Notes:** Proposal sent via email. Includes custom pricing for 50-seat license.\n\nNext task: Follow-up call with {name2} (due 3:00 PM)"
    },
    {
        "human": "Overdue tasks report",
        "gpt": "⚠️ **Overdue Tasks (8 items)**\n\n| Task | Due | Contact | Days Overdue |\n|------|-----|---------|-------------|\n| Send contract | Aug 3 | {name1} | 4 |\n| Demo call | Aug 4 | {name2} | 3 |\n| Proposal follow-up | Aug 5 | {name3} | 2 |\n| Invoice payment | Aug 5 | {name4} | 2 |\n\n**Total Overdue:** 8 tasks | **At Risk:** $245,000 in deals\n\n**Recommended Actions:**\n1. Prioritize contract for {name1} — highest value\n2. Reschedule demo for {name2}\n3. Block 2 hours to clear backlog\n\nWould you like me to prioritize these by deal value?"
    },
    {
        "human": "Create a task list for closing {name}'s deal",
        "gpt": "Task list for **{company} deal closure** (${amount:,.2f}):\n\n| # | Task | Due | Priority |\n|---|------|-----|----------|\n| 1 | Finalize pricing | Aug 8 | High |\n| 2 | Send revised proposal | Aug 9 | High |\n| 3 | Schedule decision call | Aug 10 | Medium |\n| 4 | Prepare contract | Aug 11 | Medium |\n| 5 | Legal review | Aug 12 | Low |\n| 6 | Send for signature | Aug 13 | High |\n| 7 | Confirm kickoff date | Aug 14 | Medium |\n\n**Estimated Close:** Aug 14, 2026\n**7 tasks created.** Want to assign them to team members?"
    },
]

# 5. TICKET MANAGEMENT
TEMPLATES["ticket_management"] = [
    {
        "human": "Create a support ticket for {name} — can't access their dashboard",
        "gpt": "Support ticket created:\n\n- **Ticket:** #TK-2847\n- **Contact:** {name} ({company})\n- **Issue:** Cannot access dashboard\n- **Priority:** Medium\n- **Status:** Open\n- **SLA:** 4 hours\n\n**Auto-diagnosis:**\n- Last login: Aug 5, 2026\n- Account status: Active\n- Subscription: Enterprise (current)\n\n**Suggested Resolution:**\n1. Check browser cache/cookies\n2. Verify SSO configuration\n3. Check user permissions\n\nAssigned to support queue. Would you like to start troubleshooting?"
    },
    {
        "human": "What's the SLA status for open tickets?",
        "gpt": "📊 **SLA Status — Open Tickets**\n\n| Status | Count | On Track | At Risk | Breached |\n|--------|-------|----------|---------|----------|\n| 🔴 Urgent | 3 | 1 | 1 | 1 |\n| 🟠 High | 7 | 5 | 2 | 0 |\n| 🟡 Medium | 12 | 10 | 2 | 0 |\n| 🟢 Low | 8 | 8 | 0 | 0 |\n\n**Critical:** 1 urgent ticket breached SLA (2h 15m overdue)\n**At Risk:** 5 tickets approaching SLA deadline\n\n**Recommended Actions:**\n1. Escalate breached urgent ticket immediately\n2. Assign senior agent to at-risk tickets\n3. Consider auto-escalation for SLA breaches"
    },
    {
        "human": "Escalate ticket #TK-2847 to tier 2",
        "gpt": "Ticket **#TK-2847** escalated to Tier 2:\n\n- **Reason:** Dashboard access issue unresolved after initial troubleshooting\n- **Escalated To:** Tier 2 Support Team\n- **Priority:** High\n- **SLA Reset:** New 8-hour SLA\n- **Context:** Customer has tried cache clear, SSO reset, and permission check\n\n**Auto-escalation Notes:**\n- Customer is Enterprise tier ($85K ARR)\n- Issue affects 12 users at their organization\n- Previous ticket #TK-2701 had similar root cause (SSO config)\n\nCustomer notified of escalation. Expected response: 2 hours."
    },
    {
        "human": "Resolve ticket #TK-2847 — it was an SSO misconfiguration",
        "gpt": "✅ Ticket **#TK-2847** resolved:\n\n- **Root Cause:** SSO configuration error after recent IDP update\n- **Resolution:** Updated SSO callback URL in NuCRM settings\n- **Time to Resolve:** 3 hours 42 minutes\n- **SLA Status:** ✅ Within SLA\n- **Customer Satisfaction:** Pending survey\n\n**Resolution Notes:**\n1. Customer's IT team updated their IDP URL on Aug 4\n2. NuCRM SSO callback was pointing to old URL\n3. Updated configuration and verified access\n\n**Knowledge Base Article Created:** \"SSO Configuration Troubleshooting Guide\"\n\nTicket closed. Follow-up survey scheduled for 24 hours."
    },
    {
        "human": "Show me ticket trends for the last 30 days",
        "gpt": "📈 **Ticket Trends — Last 30 Days**\n\n**Volume:**\n- Total Tickets: 156\n- Average Daily: 5.2\n- Peak Day: Aug 3 (12 tickets)\n\n**By Category:**\n| Category | Count | Avg Resolution |\n|----------|-------|----------------|\n| Login/Access | 42 | 2.1 hours |\n| Billing | 28 | 4.3 hours |\n| Feature Request | 35 | N/A (routed) |\n| Bug Report | 31 | 6.8 hours |\n| How-To | 20 | 1.2 hours |\n\n**SLA Performance:**\n- Met: 89% (139/156)\n- Breached: 11%\n\n**Trend:** 📉 Down 15% from last month. Access issues dropped 30% after SSO fix deployment."
    },
]

# 6. EMAIL COMPOSITION
TEMPLATES["email_composition"] = [
    {
        "human": "Write a cold outreach email to {name} at {company}",
        "gpt": "Here's a personalized cold outreach email:\n\n---\n**Subject:** Quick question about {company}'s growth\n\nHi {name},\n\nI noticed {company} has been expanding rapidly — congrats on the Series B!\n\nI work with similar-stage companies on scaling their sales operations. One thing I keep seeing is teams struggling to convert inbound leads fast enough.\n\nQuick question: How are you currently managing your lead-to-close process?\n\nIf it's something you're thinking about, I'd love to share how companies like {company2} reduced their sales cycle by 30%.\n\nWorth a 15-minute chat?\n\nBest,\n[Your Name]\n---\n\n**Personalization elements:**\n- Referenced their funding round\n- Asked about their process (engagement hook)\n- Included social proof\n- Low-commitment CTA\n\nWant me to adjust the tone or focus?"
    },
    {
        "human": "Draft a follow-up email to {name} who went silent after our demo",
        "gpt": "Follow-up email for **{name}** (silent since demo):\n\n---\n**Subject:** Following up + something for you\n\nHi {name},\n\nI hope the demo was helpful! I wanted to share a quick resource that might be useful:\n\n📊 **Custom ROI Calculator for {company}**\n[Link to personalized calculator]\n\nBased on what you shared about your current process, I estimated you could:\n- Save 12 hours/week on manual data entry\n- Increase lead response time by 65%\n- Close 20% more deals with better pipeline visibility\n\nI know things get busy — would next Tuesday or Thursday work for a quick 10-minute check-in?\n\nBest,\n[Your Name]\n---\n\n**Strategy:**\n- Added value (ROI calculator)\n- Specific numbers from their pain points\n- Made it easy to say yes (short meeting)\n- No pressure tone"
    },
    {
        "human": "Write a proposal email for {name} with pricing details",
        "gpt": "Proposal email for **{name}** ({company}):\n\n---\n**Subject:** Your custom proposal — {company} Enterprise Plan\n\nHi {name},\n\nThank you for the productive conversations! Here's your personalized proposal:\n\n📋 **NuCRM Enterprise Plan — {company}**\n\n**What's Included:**\n- Unlimited users (up to 50 seats)\n- Custom pipeline configuration\n- AI-powered lead scoring\n- Priority support (4-hour SLA)\n- Dedicated success manager\n- API access & integrations\n\n**Investment:**\n| Term | Monthly | Annual (Save 20%) |\n|------|---------|-------------------|\n| Monthly | $2,500/mo | — |\n| Annual | — | $2,000/mo ($24,000/yr) |\n\n**ROI Projection:**\n- Current manual process cost: ~$45,000/yr\n- With NuCRM: ~$24,000/yr\n- **Net Savings: $21,000/year**\n\n**Next Steps:**\n1. Review proposal (attached PDF)\n2. Schedule call to answer questions\n3. Sign & onboard (takes 2 days)\n\nProposal valid until Aug 21, 2026.\n\nLooking forward to partnering with {company}!\n\nBest,\n[Your Name]\n---\n\n**Attached:** proposal-{company}-enterprise.pdf"
    },
    {
        "human": "Write a re-engagement email for {name} who hasn't logged in for 30 days",
        "gpt": "Re-engagement email for **{name}**:\n\n---\n**Subject:** We miss you, {name}! Here's what's new\n\nHi {name},\n\nIt's been a while since you logged into NuCRM — we wanted to check in and share some exciting updates:\n\n🆕 **What's New Since Your Last Visit:**\n- AI-powered email composer (saves 2 hours/week)\n- New dashboard with real-time pipeline view\n- WhatsApp integration for instant lead responses\n- Custom report builder (no coding needed)\n\n🎁 **Special Offer:**\nAs a valued customer, we're extending your trial of AI features for 30 more days — free.\n\n**Quick Win:** Log in today and try the AI lead scorer — it takes 2 minutes and gives you instant insights on your pipeline.\n\n[Log In to NuCRM]\n\nNeed help getting started? Reply to this email and I'll personally walk you through the new features.\n\nBest,\n[Your Name]\n---\n\n**Strategy:**\n- Showed concrete value of returning\n- Free offer to reduce friction\n- Personal assistance offer\n- One specific action to take"
    },
    {
        "human": "Create a newsletter draft for all leads this month",
        "gpt": "Monthly newsletter draft — August 2026:\n\n---\n**Subject:** 🚀 August Insights: 3 strategies to close more deals\n\n**Preview Text:** Plus: New AI features, customer success story, and exclusive webinar invite\n\n---\n\n**Hi {{first_name}},**\n\nAugust has been packed! Here's what you need to know:\n\n📊 **This Month's Key Insight**\nCompanies using AI-assisted lead scoring see 34% higher conversion rates. Here's how to implement it in 3 steps:\n1. Define your ideal customer profile\n2. Set scoring criteria (engagement + fit)\n3. Let AI analyze patterns you might miss\n\n🆕 **New Features**\n- **AI Email Composer:** Write personalized emails in seconds\n- **Pipeline Forecasting:** Predict revenue with 90% accuracy\n- **Smart Automations:** Set it and forget it\n\n🏆 **Customer Spotlight**\n*\"We closed 40% more deals in Q2 after implementing NuCRM's AI scoring.\"*\n— Sarah Chen, VP Sales at TechCorp\n\n📅 **Upcoming Webinar**\n**\"Mastering Pipeline Management\"** — Aug 20, 2 PM EST\n[Register Free]\n\n---\n\n**Stats:**\n- Open rate (last month): 28%\n- Click rate: 4.2%\n- Unsubscribe rate: 0.3%\n\n**Segmentation:** Sending to 2,847 contacts (engaged in last 90 days)"
    },
]

# 7. EMAIL SEQUENCES
TEMPLATES["email_sequences"] = [
    {
        "human": "Create a 3-step follow-up sequence for new leads",
        "gpt": "3-step follow-up sequence created:\n\n| Step | Day | Subject | Goal |\n|------|-----|---------|------|\n| 1 | 0 | Welcome to NuCRM | Introduce value prop |\n| 2 | 3 | Quick question about your needs | Engage |\n| 3 | 7 | Last thing before I close your file | Urgency |\n\n**Settings:**\n- Start: Immediately on lead creation\n- Pause if: Lead replies or books meeting\n- Skip if: Lead is already in another sequence\n- Timezone: Lead's local time (9 AM)\n\n**Expected Performance:**\n- Open rate: 35-45%\n- Reply rate: 8-12%\n- Meeting book rate: 3-5%\n\nSequence is active. Want to customize the emails?"
    },
    {
        "human": "A/B test the subject lines in my email sequence",
        "gpt": "A/B test configured for email sequence:\n\n**Test:** Subject Line Optimization\n**Variant A:** \"Quick question about {{company}}'s growth\"\n**Variant B:** \"{{first_name}}, saw something interesting\"\n\n**Test Parameters:**\n- Sample size: 20% of recipients (200 contacts)\n- Duration: 48 hours\n- Success metric: Open rate\n- Auto-winner: Yes (after 48h)\n\n**Projected Results:**\n| Variant | Est. Open Rate | Est. Click Rate |\n|---------|----------------|------------------|\n| A | 32% | 4.5% |\n| B | 38% | 5.2% |\n\nTest starts with next batch. Winner automatically applied to remaining 80%."
    },
    {
        "human": "Show me sequence performance this month",
        "gpt": "📊 **Email Sequence Performance — August 2026**\n\n| Sequence | Sent | Opened | Clicked | Replied | Meetings |\n|----------|------|--------|---------|---------|----------|\n| New Lead Welcome | 847 | 312 (37%) | 48 (6%) | 23 (3%) | 8 |\n| Demo Follow-up | 234 | 98 (42%) | 31 (13%) | 18 (8%) | 12 |\n| Re-engagement | 456 | 134 (29%) | 22 (5%) | 9 (2%) | 3 |\n| Proposal Nurture | 89 | 52 (58%) | 18 (20%) | 14 (16%) | 9 |\n\n**Top Performer:** Proposal Nurriage (58% open rate, 16% reply rate)\n**Needs Attention:** Re-engagement (low reply rate — consider new angles)\n\n**Revenue Impact:**\n- Meetings booked: 32\n- Deals influenced: 8\n- Revenue attributed: $184,000"
    },
]

# 8. AI SCORING
TEMPLATES["ai_scoring"] = [
    {
        "human": "Score all leads based on engagement and fit",
        "gpt": "🎯 **AI Lead Scoring Complete**\n\nAnalyzed **342 leads** using engagement + fit criteria:\n\n**Scoring Model:**\n| Factor | Weight | Data Points |\n|--------|--------|-------------|\n| Engagement | 40% | Email opens, clicks, site visits, form fills |\n| Fit | 35% | Company size, industry, title, budget |\n| Behavior | 25% | Recency, frequency, page views, content downloads |\n\n**Results:**\n| Score Range | Leads | Avg Value | Win Probability |\n|-------------|-------|-----------|------------------|\n| 90-100 | 12 | $85,000 | 72% |\n| 70-89 | 45 | $42,000 | 48% |\n| 50-69 | 98 | $28,000 | 25% |\n| 30-49 | 127 | $15,000 | 12% |\n| 0-29 | 60 | $8,000 | 3% |\n\n**Top 5 Hot Leads:**\n1. {name1} (94) — $120,000 — CEO at {company1}\n2. {name2} (91) — $85,000 — VP Sales at {company2}\n3. {name3} (88) — $65,000 — Director at {company3}\n4. {name4} (86) — $95,000 — CTO at {company4}\n5. {name5} (83) — $45,000 — Manager at {company5}\n\n**Action:** Auto-assigned hot leads to senior reps. Want to review individual scores?"
    },
    {
        "human": "Predict which deals will close this month",
        "gpt": "🔮 **Deal Close Prediction — August 2026**\n\nAnalyzed **34 active deals** using win probability model:\n\n**High Confidence (80%+ likely to close):**\n| Deal | Value | Probability | Key Signals |\n|------|-------|-------------|-------------|\n| {company1} | $85,000 | 92% | Contract reviewed, budget confirmed |\n| {company2} | $42,000 | 87% | Verbal commitment, legal review |\n| {company3} | $67,000 | 81% | Decision maker engaged, timeline set |\n\n**Medium Confidence (50-79%):**\n| Deal | Value | Probability | Risk Factors |\n|------|-------|-------------|--------------|\n| {company4} | $120,000 | 65% | Competitor in final round |\n| {company5} | $38,000 | 58% | Budget approval pending |\n\n**Forecast:**\n- Expected Revenue: $425,000\n- Conservative: $295,000\n- Best Case: $520,000\n\n**Recommendations:**\n1. {company4} needs immediate attention — schedule decision call\n2. {company5} — offer payment terms to speed approval"
    },
    {
        "human": "Which customers are at risk of churning?",
        "gpt": "⚠️ **Churn Risk Analysis**\n\nAnalyzed **89 active customers**:\n\n**High Risk (40%+ churn probability):**\n| Customer | ARR | Risk Score | Signals |\n|----------|-----|------------|----------|\n| {company1} | $85,000 | 78% | Login dropped 80%, support tickets ↑ |\n| {company2} | $42,000 | 65% | Feature usage ↓ 60%, no renewal talk |\n| {company3} | $28,000 | 52% | Competitor evaluation detected |\n\n**Medium Risk (20-39%):**\n| Customer | ARR | Risk Score | Signals |\n|----------|-----|------------|----------|\n| {company4} | $120,000 | 35% | Reduced team usage |\n| {company5} | $55,000 | 28% | Support escalation unresolved |\n\n**Total ARR at Risk: $330,000**\n\n**Immediate Actions:**\n1. Schedule QBR with {company1} — highest risk, highest ARR\n2. Assign CSM to {company2} for proactive outreach\n3. Resolve {company5} support ticket with priority\n\nWant me to draft retention emails for at-risk accounts?"
    },
    {
        "human": "Score this lead: {name}, CEO at {company}, opened 5 emails, visited pricing page 3 times",
        "gpt": "🎯 **Lead Score: {name}**\n\n| Factor | Score | Details |\n|--------|-------|----------|\n| Engagement | 85/100 | 5 email opens (high), 3 pricing page visits (very high) |\n| Fit | 78/100 | CEO (decision maker), {company} (mid-market tech) |\n| Behavior | 92/100 | Pricing page visits = high intent signal |\n\n**Overall Score: 85/100 🔥 HOT LEAD**\n\n**Analysis:**\n- Pricing page visits are your #1 buying signal\n- CEO title means no approval chain delay\n- Email engagement shows sustained interest\n\n**Recommended Next Steps:**\n1. **Immediate:** Personal email from sales director\n2. **Today:** LinkedIn connection request\n3. **Tomorrow:** Phone call (best time: 10 AM)\n\n**Expected Conversion:** 68% if contacted within 24 hours\n\nWant me to draft the email or schedule the call?"
    },
]

# 9. AI SUGGESTIONS
TEMPLATES["ai_suggestions"] = [
    {
        "human": "What should I focus on today?",
        "gpt": "🎯 **Your Priority Focus for Today**\n\nBased on your pipeline, deadlines, and AI analysis:\n\n**🔴 Critical (Do First):**\n1. **Send proposal to {name1}** — Deal ($85K) closes in 5 days, competitor circling\n2. **Call {name2}** — Went silent after demo, deal at risk ($42K)\n\n**🟠 Important (Do Next):**\n3. **Review contract for {name3}** — Legal review needed before Friday\n4. **Follow up on invoice #INV-2847** — 7 days overdue ($12K)\n\n**🟡有价值 (If Time Permits):**\n5. **Qualify 3 new leads** — All from enterprise segment\n6. **Update deal probabilities** — Weekly pipeline review due\n\n**📊 Today's Opportunity:**\n- 2 hot leads ready for outreach ($165K potential)\n- 1 at-risk deal needs immediate attention\n- Pipeline review could surface hidden opportunities\n\n**⏱️ Suggested Schedule:**\n- 9:00-9:30: Send proposals\n- 9:30-10:00: Cold calls\n- 10:00-11:00: Meetings\n- 11:00-12:00: Admin & CRM updates\n\nWant me to block time on your calendar?"
    },
    {
        "human": "Suggest ways to increase my win rate",
        "gpt": "📈 **Win Rate Optimization Suggestions**\n\nYour current win rate: **28%** (industry avg: 22%)\n\n**AI-Identified Opportunities:**\n\n1. **Speed to Lead (Impact: +5% win rate)**\n   - Current avg response time: 4.2 hours\n   - Best practice: Under 1 hour\n   - Action: Set up instant lead notifications\n\n2. **Discovery Call Quality (Impact: +3% win rate)**\n   - 40% of lost deals cite \"didn't understand our needs\"\n   - Action: Use discovery call template with BANT questions\n\n3. **Proposal Timing (Impact: +4% win rate)**\n   - Deals with proposals sent within 24h of demo close at 42%\n   - Your avg: 3.2 days\n   - Action: Create proposal template, send same day\n\n4. **Multi-Threading (Impact: +6% win rate)**\n   - Single-threaded deals: 18% win rate\n   - Multi-threaded (3+ stakeholders): 35% win rate\n   - Action: Map org chart for top 10 deals\n\n5. **Social Proof (Impact: +2% win rate)**\n   - Only 30% of proposals include case studies\n   - Action: Add relevant customer success stories\n\n**Projected Impact:** Implementing all 5 could increase win rate from 28% to 40%+"
    },
    {
        "human": "How can I improve this deal with {name}?",
        "gpt": "💡 **Deal Improvement Suggestions for {name}** ({company})\n\n**Current Status:**\n- Value: $85,000\n- Stage: Proposal (50%)\n- Days in stage: 7\n- Last activity: 3 days ago\n\n**AI Analysis:**\n1. **Risk Detected:** No engagement with proposal (0 opens)\n   - **Suggestion:** Send follow-up email with different angle\n   - **Template:** Share ROI calculator or case study\n\n2. **Missing Stakeholder:** Only talking to {name}\n   - **Suggestion:** Ask for intro to finance/procurement\n   - **Script:** \"To move forward smoothly, who else needs to weigh in?\"\n\n3. **Competitive Threat:** LinkedIn shows competitor connections\n   - **Suggestion:** Schedule call to address concerns directly\n   - **Focus:** Differentiation and implementation speed\n\n4. **Timeline Gap:** No close date confirmed\n   - **Suggestion:** Create urgency with limited-time offer\n   - **Option:** \"Annual plan discount expires Aug 15\"\n\n5. **Value Reinforcement:** Proposal may not highlight ROI\n   - **Suggestion:** Add personalized ROI section\n   - **Data:** Their manual process costs ~$45K/yr, NuCRM saves $21K\n\n**Recommended Action Plan:**\n- Today: Send ROI email with case study\n- Tomorrow: Call to schedule stakeholder meeting\n- Friday: Propose pilot program to reduce risk"
    },
    {
        "human": "What's the best time to call my leads?",
        "gpt": "📞 **Optimal Call Timing Analysis**\n\nBased on **1,247 call attempts** and **342 conversations**:\n\n**Best Times to Call:**\n| Day | Best Window | Connect Rate |\n|-----|-------------|---------------|\n| Tuesday | 10:00-11:30 AM | 42% |\n| Wednesday | 9:00-10:30 AM | 39% |\n| Thursday | 2:00-3:30 PM | 37% |\n| Monday | 4:00-5:00 PM | 34% |\n\n**Worst Times:**\n- Friday afternoon (12% connect rate)\n- Monday morning (18% — in meetings)\n- Lunch hours (15% — away from desk)\n\n**By Industry:**\n| Industry | Best Time | Notes |\n|----------|-----------|-------|\n| Technology | 10-11 AM | After standup, before lunch |\n| Healthcare | 7-8 AM | Before patients |\n| Finance | 8-9 AM | Before markets open |\n| Manufacturing | 6-7 AM | Shift start |\n\n**Personalized Recommendation for Your Pipeline:**\n- {name1} (TechCorp): Call Tuesday 10 AM\n- {name2} (Healthcare Inc): Call Wednesday 7:30 AM\n- {name3} (Finance Co): Call Thursday 8 AM\n\nWant me to schedule these calls?"
    },
]

# 10. AI CHAT
TEMPLATES["ai_chat"] = [
    {
        "human": "Hey, how are you?",
        "gpt": "Hey! I'm doing great — ready to help you crush your sales targets today 💪\n\nWhat's on your mind? I can help with:\n- Pipeline management\n- Lead scoring & prioritizing\n- Email drafting\n- Deal strategy\n- Task management\n- Or just brainstorm\n\nWhat would you like to tackle?"
    },
    {
        "human": "I'm feeling overwhelmed with my pipeline",
        "gpt": "I hear you — pipeline overload is real. Let's break it down.\n\n**Quick Triage:**\n1. How many active deals do you have?\n2. Which ones are closing this month?\n3. Which ones need attention TODAY?\n\n**Here's what I'd do:**\n\n🎯 **Step 1: Sort by urgency**\n- Deals closing in <7 days: Focus here first\n- Deals stuck >14 days: Need action or disqualify\n- New leads: Can wait 24-48 hours\n\n🎯 **Step 2: Block time**\n- 9-10 AM: Proposals & follow-ups\n- 10-12 PM: Calls & meetings\n- 1-2 PM: Admin & CRM updates\n- 2-4 PM: New lead outreach\n\n🎯 **Step 3: Delegate**\n- What tasks can your SDR handle?\n- What can wait until next week?\n\nWant me to analyze your actual pipeline and create a prioritized action plan?"
    },
    {
        "human": "Help me think through whether I should offer a discount to {name}",
        "gpt": "Let's think through this strategically.\n\n**Discount Analysis for {name}:**\n\n**Arguments FOR discounting:**\n✅ Deal value: $85,000 (significant)\n✅ Competitor is 20% cheaper\n✅ End of quarter approaching\n✅ {name} is a good fit (low churn risk)\n\n**Arguments AGAINST discounting:**\n❌ Sets precedent for future negotiations\n❌ Reduces margin by ~$17,000\n❌ May signal desperation\n❌ Other clients may expect same treatment\n\n**Alternative Approaches:**\n1. **Value-add instead of discount:** Add 3 months free, premium support, or extra seats\n2. **Payment terms:** Offer monthly instead of annual (same total, easier budget approval)\n3. **Phased approach:** Start with 10 users, expand after 90 days\n4. **Pilot program:** 30-day trial at full price, then commit\n\n**My Recommendation:**\nDon't discount price — add value. Offer:\n- 3 months free (worth $7,500 to them, costs you $2,000)\n- Premium support tier\n- Custom onboarding\n\nThis preserves your price point while making the offer compelling.\n\nWant me to draft this counter-offer?"
    },
    {
        "human": "What do you think about my sales process?",
        "gpt": "Based on analyzing your last 90 days of activity, here's my take:\n\n**What's Working:** ✅\n- Lead response time: 2.1 hours (excellent)\n- Demo-to-proposal rate: 78% (above avg)\n- Customer satisfaction: 4.7/5\n\n**Areas to Improve:** ⚠️\n1. **Lead qualification** — 35% of disqualified leads were \"good fit\" (over-qualifying?)\n2. **Pipeline velocity** — Average 42 days to close (industry: 35)\n3. **Multi-threading** — 60% of lost deals had single stakeholder\n4. **Follow-up consistency** — 28% of leads get 0 follow-ups after first touch\n\n**Quick Wins:**\n- Add qualification criteria checklist (save 2 days per lead)\n- Set up automated follow-up sequences (recover 15% of silent leads)\n- Require org chart for deals >$50K (increase win rate 6%)\n\n**Biggest Opportunity:**\nYour proposal stage has the biggest drop-off (50% → 25%). Adding same-day proposals with ROI calculators could boost this by 15-20%.\n\nWant me to implement any of these improvements?"
    },
    {
        "human": "Give me a pep talk about my quota",
        "gpt": "Listen up — you're closer than you think! 🎯\n\n**Your Q3 Numbers:**\n- Quota: $900,000\n- Closed: $425,000 (47%)\n- Pipeline: $981,500\n- Days left: 55\n\n**The Math:**\n- Need: $475,000 more\n- Pipeline coverage: 2.1x (healthy!)\n- Your win rate: 28%\n- **You need ~$1.7M in pipeline to close $475K**\n\n**Reality Check:**\n- You have $981K in active pipeline\n- 3 deals in negotiation ($247K)\n- 8 deals in proposal ($275K)\n- 15 qualified leads ($342K)\n\n**You CAN do this IF:**\n1. Close the 3 negotiation deals this week\n2. Convert 50% of proposals\n3. Accelerate 3 qualified leads to proposal\n\n**My Prediction:** You'll hit $750-800K (85-90% of quota)\n\n**To hit 100%:**\n- Need 2 more enterprise deals ($100K+)\n- Focus on {company1} and {company3} — highest potential\n\n**You've got this.** Your activity levels are strong, your conversion rates are solid, and your pipeline is healthy. Now execute!\n\nWant me to create a daily action plan to close the gap?"
    },
]

# 11. ANALYTICS
TEMPLATES["analytics"] = [
    {
        "human": "Show me this month's sales performance",
        "gpt": "📊 **Sales Performance — August 2026**\n\n**Revenue:**\n| Metric | Value | vs Last Month |\n|--------|-------|---------------|\n| Closed Won | $142,000 | +18% |\n| Pipeline Created | $385,000 | +12% |\n| Average Deal Size | $28,400 | +5% |\n| Win Rate | 32% | +4% |\n\n**Activity:**\n| Metric | Count | vs Last Month |\n|--------|-------|---------------|\n| Calls Made | 234 | +22% |\n| Emails Sent | 892 | +15% |\n| Meetings Held | 67 | +8% |\n| Demos Completed | 23 | +30% |\n\n**Leaderboard:**\n| Rep | Revenue | Deals | Win Rate |\n|-----|---------|-------|----------|\n| {name1} | $52,000 | 2 | 40% |\n| {name2} | $45,000 | 3 | 35% |\n| {name3} | $45,000 | 2 | 28% |\n\n**Top Opportunity:** {company1} ($85K) — in negotiation\n**At Risk:** {company2} ($42K) — competitor evaluation"
    },
    {
        "human": "What's my conversion rate by lead source?",
        "gpt": "📈 **Conversion Rate by Lead Source**\n\n| Source | Leads | Qualified | Converted | Conv. Rate | CAC |\n|--------|-------|-----------|-----------|------------|-----|\n| Website | 423 | 156 | 42 | 9.9% | $120 |\n| LinkedIn | 189 | 87 | 28 | 14.8% | $85 |\n| Referral | 67 | 45 | 18 | 26.9% | $45 |\n| Cold Outbound | 312 | 78 | 12 | 3.8% | $280 |\n| Events | 45 | 23 | 8 | 17.8% | $350 |\n| Paid Ads | 234 | 56 | 11 | 4.7% | $420 |\n\n**Key Insights:**\n1. **Referrals** convert 3x better than average (26.9% vs 8.2%)\n2. **LinkedIn** has best cost-efficiency ($85 CAC)\n3. **Events** have high CAC but high deal value ($45K avg)\n4. **Cold Outbound** needs optimization (lowest conv. rate)\n\n**Recommendations:**\n- Double referral program investment\n- Scale LinkedIn outreach\n- Revamp cold outbound messaging\n- Events: Focus on quality over quantity"
    },
    {
        "human": "Generate a pipeline velocity report",
        "gpt": "⚡ **Pipeline Velocity Report**\n\n**Current Velocity:**\n- Leads → Qualified: 8.2 days (↓ 1.3 days from last month)\n- Qualified → Proposal: 5.4 days (↓ 0.8 days)\n- Proposal → Closed: 12.6 days (↑ 1.2 days ⚠️)\n- **Total Cycle:** 26.2 days (↑ 0.9 days)\n\n**Velocity by Stage:**\n| Transition | Days | Benchmark | Status |\n|------------|------|-----------|--------|\n| Lead → Contacted | 1.2 | <2 | ✅ |\n| Contacted → Qualified | 7.0 | <10 | ✅ |\n| Qualified → Proposal | 5.4 | <7 | ✅ |\n| Proposal → Negotiation | 6.8 | <5 | ⚠️ |\n| Negotiation → Closed | 5.8 | <7 | ✅ |\n\n**Bottleneck Identified:** Proposal → Negotiation (6.8 days, benchmark: 5)\n\n**Root Cause:**\n- 40% of proposals require 2+ revision cycles\n- Average 2.3 stakeholders involved (need 3+ for faster approval)\n\n**Improvement Actions:**\n1. Create proposal template with pre-approved pricing\n2. Map stakeholder org chart before proposal\n3. Include ROI calculator in initial proposal"
    },
]

# 12. AUTOMATION
TEMPLATES["automation"] = [
    {
        "human": "Set up an automation to notify me when a deal goes above $50K",
        "gpt": "Automation created:\n\n**Trigger:** Deal value updated to >$50,000\n**Actions:**\n1. Send Slack notification to #sales channel\n2. Send email alert to you\n3. Add \"enterprise\" tag to deal\n4. Create task: \"Schedule executive review\"\n\n**Conditions:**\n- Only for deals in active stages (not closed)\n- Only once per deal (no duplicate alerts)\n\n**Test:** Found 3 existing deals that would trigger this automation.\n\nAutomation is live. Want to add more conditions?"
    },
    {
        "human": "Auto-assign leads based on territory",
        "gpt": "Lead routing automation configured:\n\n**Rules:**\n| Territory | Rep | Condition |\n|-----------|-----|------------|\n| North America | {name1} | State in US/CA |\n| Europe | {name2} | Country in EU/UK |\n| Asia Pacific | {name3} | Country in APAC |\n| Enterprise | {name4} | Company size >500 |\n| Inbound | Round Robin | Source = Website/Form |\n\n**Fallback:** Unassigned leads go to sales pool\n\n**Current Impact:**\n- 23 unassigned leads will be auto-routed\n- Avg assignment time: Instant (was 4.2 hours)\n\nAutomation active. Want to add more rules?"
    },
    {
        "human": "Create a workflow that follows up if a lead doesn't respond in 3 days",
        "gpt": "Follow-up automation created:\n\n**Trigger:** Lead created + no response after 3 days\n**Workflow:**\n\n```\nDay 3: Auto-send follow-up email (Template: Gentle Nudge)\n  ↓\nDay 5: If no response → Send case study email\n  ↓\nDay 7: If no response → Create task for personal call\n  ↓\nDay 10: If no response → Move to \"Cold\" status\n  ↓\nDay 14: If no response → Archive lead\n```\n\n**Exclusions:**\n- Skip if lead is in active deal\n- Skip if lead replied to any email\n- Skip if lead visited website in last 24h\n\n**Expected Impact:**\n- 15% recovery of currently lost leads\n- 30% faster identification of uninterested leads\n\nAutomation is active. Want to customize the email templates?"
    },
]

# 13. INVOICING
TEMPLATES["invoicing"] = [
    {
        "human": "Create an invoice for {name} — $12,500 for Q3 services",
        "gpt": "Invoice created:\n\n- **Invoice:** #INV-2847\n- **Client:** {name} ({company})\n- **Amount:** $12,500.00\n- **Due Date:** Sep 7, 2026 (Net 30)\n- **Status:** Sent\n\n**Line Items:**\n| Description | Qty | Rate | Amount |\n|-------------|-----|------|--------|\n| Q3 Platform License | 1 | $10,000 | $10,000 |\n| Premium Support | 1 | $2,500 | $2,500 |\n\n**Payment Options:**\n- ACH: [Link]\n- Credit Card: [Link]\n- Wire: Details in invoice\n\nInvoice sent to {email}. Payment reminder scheduled for Aug 28."
    },
    {
        "human": "Show me overdue invoices",
        "gpt": "⚠️ **Overdue Invoices (4 total)**\n\n| Invoice | Client | Amount | Due | Days Overdue |\n|---------|--------|--------|-----|-------------|\n| #INV-2801 | {company1} | $8,500 | Jul 28 | 10 |\n| #INV-2815 | {company2} | $12,000 | Aug 1 | 6 |\n| #INV-2823 | {company3} | $4,200 | Aug 3 | 4 |\n| #INV-2831 | {company4} | $6,800 | Aug 5 | 2 |\n\n**Total Overdue:** $31,500\n\n**Status:**\n- Payment reminders sent for all\n- {company1}: Second reminder sent, no response\n- {company2}: Payment processing (ETA 2 days)\n- {company3}: Disputed charge (needs resolution)\n- {company4}: Reminder acknowledged, paying this week\n\n**Recommended Actions:**\n1. Call {company1} — 10 days overdue, escalate\n2. Resolve {company3} dispute before it becomes a ticket"
    },
    {
        "human": "Send payment reminder for invoice #INV-2801",
        "gpt": "Payment reminder sent:\n\n- **Invoice:** #INV-2801\n- **Client:** {company1}\n- **Amount:** $8,500\n- **Days Overdue:** 10\n- **Reminder Type:** Second Notice\n\n**Email sent to:** ap@{company1}.com\n**Subject:** \"Second Notice: Invoice #INV-2801 — $8,500 — 10 Days Overdue\"\n\n**Escalation plan if no payment in 48 hours:**\n1. Call {name1} directly\n2. CC account manager\n3. Put account on hold if >15 days\n\nNext reminder: Aug 9, 2026"
    },
]

# 14. MEETING MANAGEMENT
TEMPLATES["meeting_management"] = [
    {
        "human": "Schedule a demo with {name} for next Tuesday at 2pm",
        "gpt": "Demo scheduled:\n\n- **Title:** NuCRM Demo — {company}\n- **Date:** Tuesday, Aug 12, 2026\n- **Time:** 2:00-2:45 PM (EST)\n- **Attendees:** {name}, Your Sales Team\n- **Meeting Link:** [Zoom Link]\n\n**Pre-Meeting Checklist:**\n- [ ] Review {company}'s industry & pain points\n- [ ] Customize demo environment with their data\n- [ ] Prepare 3 relevant case studies\n- [ ] Share agenda with {name} (24h before)\n\n**Suggested Agenda:**\n1. Introductions (5 min)\n2. {company}'s current challenges (10 min)\n3. NuCRM demo — focused on solutions (20 min)\n4. Q&A (10 min)\n\nCalendar invite sent. Meeting prep task created."
    },
    {
        "human": "What meetings do I have this week?",
        "gpt": "📅 **This Week's Meetings**\n\n**Today (Aug 7):**\n| Time | Meeting | Attendees |\n|------|---------|----------|\n| 10:00 AM | Pipeline Review | Sales Team |\n| 2:00 PM | Discovery Call | {name1}, {name2} |\n| 4:00 PM | Demo Prep | Internal |\n\n**Tomorrow (Aug 8):**\n| Time | Meeting | Attendees |\n|------|---------|----------|\n| 9:30 AM | Follow-up | {name3} |\n| 11:00 AM | QBR Prep | CS Team |\n| 3:00 PM | Proposal Review | {name4} |\n\n**Friday (Aug 9):**\n| Time | Meeting | Attendees |\n|------|---------|----------|\n| 10:00 AM | Demo | {name5} |\n| 2:00 PM | Team Standup | All Hands |\n\n**Summary:** 8 meetings | 12 hours total | 3 client-facing\n\n**Prep needed:** Demo for {name5} (prepare custom environment)"
    },
    {
        "human": "Summarize my meeting notes from today's demo with {name}",
        "gpt": "📝 **Meeting Summary: NuCRM Demo — {company}**\n\n**Date:** Aug 7, 2026, 2:00-2:45 PM\n**Attendees:** {name} (CEO), Sarah (CTO), Mike (VP Sales)\n\n**Key Discussion Points:**\n1. Current pain: Manual lead tracking causing 40% lead leakage\n2. Goal: Automate lead scoring and pipeline management\n3. Concern: Integration with existing Salesforce setup\n4. Timeline: Want to implement by Q4\n\n**Action Items:**\n| Task | Owner | Due |\n|------|-------|-----|\n| Send Salesforce integration guide | You | Aug 8 |\n| Provide 3 enterprise case studies | You | Aug 9 |\n| Schedule technical deep-dive | {name} | Aug 12 |\n| Send proposal with custom pricing | You | Aug 11 |\n\n**Sentiment:** 🟢 Positive — impressed with AI features\n**Next Step:** Technical deep-dive on Aug 12\n**Deal Probability:** Increased to 75%\n\nNotes saved to contact record. Follow-up tasks created."
    },
]

# 15. DOCUMENT MANAGEMENT
TEMPLATES["document_management"] = [
    {
        "human": "Generate a proposal for {name}'s deal",
        "gpt": "Proposal generated:\n\n- **Document:** NuCRM Proposal — {company}\n- **Pages:** 12\n- **Version:** 1.0\n\n**Sections:**\n1. Executive Summary\n2. {company}'s Challenges (personalized)\n3. NuCRM Solution\n4. Implementation Timeline\n5. Pricing & ROI\n6. Case Studies (3 relevant)\n7. Terms & Conditions\n\n**Customizations:**\n- ROI calculator: Based on {company}'s 50-user team\n- Case studies: Similar industry (Tech), similar size\n- Pricing: Enterprise plan with 20% annual discount\n\n**Attached Files:**\n- proposal-{company}.pdf (2.3 MB)\n- roi-calculator.xlsx (156 KB)\n- case-study-techcorp.pdf (1.1 MB)\n\nProposal ready for review. Want to edit before sending?"
    },
    {
        "human": "Create a contract for the {company} deal",
        "gpt": "Contract created:\n\n- **Document:** Master Service Agreement\n- **Client:** {company}\n- **Term:** 12 months\n- **Value:** $85,000\n\n**Key Terms:**\n| Term | Value |\n|------|-------|\n| Contract Value | $85,000 |\n| Payment Terms | Annual upfront |\n| Start Date | Sep 1, 2026 |\n| End Date | Aug 31, 2027 |\n| Auto-Renewal | Yes, 60-day notice |\n| SLA | 99.9% uptime, 4-hour response |\n\n**Attached:**\n- MSA-{company}.pdf (420 KB)\n- SOW-{company}.pdf (180 KB)\n- Data Processing Agreement (if applicable)\n\nContract sent for legal review. Expected approval: 2 business days."
    },
]

# 16. COMMUNICATION
TEMPLATES["communication"] = [
    {
        "human": "Log a call with {name} — discussed pricing concerns",
        "gpt": "Call logged:\n\n- **Contact:** {name} ({company})\n- **Duration:** 18 minutes\n- **Type:** Outbound\n- **Summary:** Discussed pricing concerns\n\n**Key Points:**\n1. {name} thinks our pricing is 15% above competitors\n2. Budget is $75K, our quote is $85K\n3. Asked for discount or value justification\n4. Offered ROI calculator and payment terms\n5. Follow-up scheduled for Friday\n\n**Sentiment:** 🟡 Neutral — interested but price-sensitive\n\n**Next Steps:**\n- Send ROI calculator showing $21K annual savings\n- Prepare payment terms proposal\n- Research competitor pricing\n\nCall notes added to contact timeline. Deal probability adjusted to 60%."
    },
    {
        "human": "Send a WhatsApp message to {name} about the meeting tomorrow",
        "gpt": "WhatsApp message sent to **{name}**:\n\n---\nHi {name}! 👋\n\nJust confirming our meeting tomorrow at 2 PM. I've prepared a custom demo focusing on:\n\n• Lead scoring automation\n• Pipeline management\n• ROI analysis for {company}\n\nSee you then! Here's the meeting link: [Zoom]\n---\n\n**Message Status:** Delivered ✅\n**Read:** Pending\n\nWould you like to send a calendar reminder as well?"
    },
    {
        "human": "What's the communication history with {name}?",
        "gpt": "📞 **Communication History: {name}** ({company})\n\n| Date | Channel | Direction | Summary |\n|------|---------|-----------|---------|\n| Aug 7 | Phone | Outbound | Pricing concerns discussed |\n| Aug 5 | Email | Inbound | Requested demo |\n| Aug 3 | Email | Outbound | Initial outreach |\n| Jul 30 | LinkedIn | Outbound | Connection request accepted |\n| Jul 28 | Email | Outbound | Cold outreach #1 |\n\n**Summary:**\n- Total interactions: 5\n- Last contact: Today (phone call)\n- Preferred channel: Email\n- Response rate: 60%\n\n**Engagement Trend:** 📈 Increasing — went from cold to active conversation in 10 days."
    },
]

# 17. PIPELINE MANAGEMENT
TEMPLATES["pipeline_management"] = [
    {
        "human": "Show me the pipeline by stage with values",
        "gpt": "📊 **Pipeline Overview**\n\n| Stage | Deals | Total Value | Avg Value | Win Prob |\n|-------|-------|-------------|-----------|----------|\n| Lead | 23 | $184,500 | $8,022 | 10% |\n| Qualified | 15 | $342,000 | $22,800 | 25% |\n| Proposal | 8 | $275,000 | $34,375 | 50% |\n| Negotiation | 4 | $180,000 | $45,000 | 75% |\n| **Total** | **50** | **$981,500** | **$19,630** | — |\n\n**Weighted Pipeline:** $452,475\n\n**Velocity by Stage:**\n- Lead → Qualified: 8.2 days\n- Qualified → Proposal: 5.4 days\n- Proposal → Negotiation: 6.8 days\n- Negotiation → Closed: 5.8 days\n\n**Bottleneck:** Proposal stage (highest drop-off rate: 50%)\n\n**Recommendations:**\n1. Focus on converting 8 proposal-stage deals\n2. Accelerate 4 negotiation deals to close\n3. Add 10 more qualified leads to maintain coverage"
    },
    {
        "human": "What's blocking the {company} deal?",
        "gpt": "🔍 **Deal Blocker Analysis: {company}**\n\n**Deal Details:**\n- Value: $85,000\n- Stage: Negotiation (75%)\n- Days in stage: 8\n- Last activity: 3 days ago\n\n**Identified Blockers:**\n\n1. 🔴 **Budget Approval** — CFO hasn't signed off\n   - Contact: {name} (CEO) — supportive\n   - Missing: CFO approval\n   - Action: Offer pilot program to reduce risk\n\n2. 🟠 **Legal Review** — Contract terms under review\n   - Issue: Indemnification clause\n   - Status: Legal team reviewing\n   - Action: Provide standard terms from similar clients\n\n3. 🟡 **Competitor** — Evaluating Apex Solutions\n   - Intel: Apex is 20% cheaper\n   - Counter: Emphasize ROI and support quality\n\n**Recommended Actions:**\n1. Schedule call with CFO (you + {name})\n2. Send comparison sheet (NuCRM vs Apex)\n3. Offer 30-day pilot at full price\n\n**Probability Impact:** Resolving blockers could increase win probability from 75% to 90%."
    },
]

# 18. REPORTING
TEMPLATES["reporting"] = [
    {
        "human": "Generate a monthly revenue report",
        "gpt": "📊 **Monthly Revenue Report — August 2026**\n\n**Revenue Summary:**\n| Metric | This Month | Last Month | Change |\n|--------|------------|------------|--------|\n| Closed Won | $142,000 | $120,000 | +18% |\n| MRR Added | $11,833 | $10,000 | +18% |\n| ARR Run Rate | $142,000 | $120,000 | +18% |\n| Avg Deal Size | $28,400 | $27,000 | +5% |\n\n**Revenue by Source:**\n| Source | Revenue | % of Total |\n|--------|---------|-------------|\n| Inbound | $67,000 | 47% |\n| Outbound | $45,000 | 32% |\n| Referral | $30,000 | 21% |\n\n**Revenue by Segment:**\n| Segment | Revenue | Deals |\n|---------|---------|-------|\n| Enterprise (>$50K) | $85,000 | 2 |\n| Mid-Market ($10-50K) | $42,000 | 5 |\n| SMB (<$10K) | $15,000 | 8 |\n\n**Forecast:**\n- Expected August Total: $210,000\n- Pipeline Coverage: 3.2x\n- Confidence: High"
    },
    {
        "human": "Show team performance this quarter",
        "gpt": "🏆 **Q3 2026 Team Performance**\n\n| Rep | Revenue | Deals | Win Rate | Avg Cycle | Quota % |\n|-----|---------|-------|----------|-----------|----------|\n| {name1} | $285,000 | 12 | 35% | 24 days | 95% |\n| {name2} | $245,000 | 10 | 32% | 28 days | 82% |\n| {name3} | $198,000 | 8 | 28% | 32 days | 66% |\n| {name4} | $119,000 | 6 | 25% | 35 days | 40% |\n\n**Team Totals:**\n- Total Revenue: $847,000\n- Total Deals: 36\n- Team Win Rate: 30%\n- Avg Deal Cycle: 29.8 days\n\n**Top Performers:**\n- 🥇 {name1}: Highest revenue, best win rate\n- 🥈 {name2}: Most improved (+25% vs Q2)\n- 🥉 {name3}: Best enterprise deals ($42K avg)\n\n**Coaching Opportunities:**\n- {name4}: Focus on qualification (high disqualification rate)\n- Team: Improve proposal speed (avg 3.2 days → target 1 day)"
    },
]

# 19. INTEGRATION
TEMPLATES["integration"] = [
    {
        "human": "Connect NuCRM to our Slack workspace",
        "gpt": "Slack integration configured:\n\n**Settings:**\n- Workspace: Your Company Slack\n- Channel: #sales-notifications\n- Bot: NuCRM Bot\n\n**Notifications:**\n| Event | Channel | Frequency |\n|-------|---------|------------|\n| New lead | #sales | Instant |\n| Deal won | #sales-celebrations | Instant |\n| Task due | #sales | Daily digest |\n| Pipeline update | #sales | Weekly summary |\n\n**Slash Commands:**\n- `/nucrm lead [name]` — Quick lead lookup\n- `/nucrm deal [name]` — Deal status\n- `/nucrm task` — Today's tasks\n\nIntegration active. Test notification sent to #sales."
    },
    {
        "human": "Set up a webhook for when deals close",
        "gpt": "Webhook configured:\n\n**Trigger:** Deal status changed to \"won\"\n**URL:** https://your-api.com/webhooks/deal-won\n**Method:** POST\n\n**Payload:**\n```json\n{\n  \"event\": \"deal.won\",\n  \"deal\": {\n    \"id\": \"deal_123\",\n    \"name\": \"Company Enterprise Plan\",\n    \"value\": 85000,\n    \"contact\": { \"name\": \"...\", \"email\": \"...\" },\n    \"closed_at\": \"2026-08-07T10:00:00Z\"\n  }\n}\n```\n\n**Security:**\n- Secret: `whsec_...` (for signature verification)\n- Retry: 3 attempts with exponential backoff\n\n**Test:** Sent test payload — received 200 OK.\n\nWebhook active. Want to add more events?"
    },
]

# 20. AI STRATEGY
TEMPLATES["ai_strategy"] = [
    {
        "human": "What's my competitive advantage in this market?",
        "gpt": "🎯 **Competitive Analysis**\n\n**Your Position:** NuCRM vs Market\n\n| Factor | NuCRM | Competitor A | Competitor B |\n|--------|-------|--------------|--------------|\n| AI Features | ✅ Advanced | ⚠️ Basic | ❌ None |\n| Price | $$ | $$$ | $ |\n| Ease of Use | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ |\n| Integrations | 50+ | 30+ | 100+ |\n| Support | 24/7 | Business hrs | Community |\n\n**Your Competitive Advantages:**\n1. **AI-Powered Insights** — Only CRM with native AI scoring, predictions, and auto-drafting\n2. **Speed to Value** — 2-day implementation vs 2-4 weeks for competitors\n3. **Total Cost of Ownership** — 40% lower than Enterprise alternatives\n\n**Vulnerabilities:**\n1. Integration ecosystem (behind Competitor B)\n2. Brand recognition (newer entrant)\n3. Enterprise features (catching up)\n\n**Strategic Recommendations:**\n1. Double down on AI narrative — it's your differentiator\n2. Build integration partnerships (Zapier, HubSpot)\n3. Create enterprise case studies to build credibility\n\n**Market Opportunity:**\n- TAM: $50B CRM market\n- SAM: $12B SMB/Mid-Market segment\n- Target Share: 0.5% ($60M ARR) by 2028"
    },
    {
        "human": "Help me plan my growth strategy for next quarter",
        "gpt": "📈 **Q4 2026 Growth Strategy**\n\n**Current State:**\n- ARR: $1.2M\n- Customers: 89\n- MRR: $100K\n- Growth Rate: 15% MoM\n\n**Q4 Target:** $1.8M ARR (50% growth)\n\n**Growth Levers:**\n\n| Lever | Strategy | Target Impact |\n|-------|----------|---------------|\n| New Customers | Double outbound team | +$300K ARR |\n| Expansion | Land & expand program | +$150K ARR |\n| Retention | Reduce churn to <5% | +$100K ARR |\n| Pricing | Introduce Enterprise tier | +$50K ARR |\n\n**Initiatives:**\n\n1. **Outbound Blitz (Oct)**\n   - Hire 2 SDRs\n   - Target 500 new accounts/month\n   - Expected: 25 new customers\n\n2. **Expansion Program (Nov)**\n   - Identify top 20 accounts for upsell\n   - Offer volume discounts\n   - Expected: $150K expansion revenue\n\n3. **Retention Push (Dec)**\n   - Launch health score system\n   - Proactive CSM outreach\n   - Expected: Reduce churn from 8% to 5%\n\n**Budget:**\n- Marketing: $50K\n- Sales: $80K\n- Product: $30K\n- Total: $160K\n\n**ROI:** $600K incremental ARR / $160K investment = 3.75x ROI"
    },
]

# 21. CUSTOMER SUCCESS
TEMPLATES["customer_success"] = [
    {
        "human": "What's the health score for {company}?",
        "gpt": "🏥 **Customer Health Score: {company}**\n\n**Overall Score: 72/100** 🟢\n\n| Factor | Score | Weight | Details |\n|--------|-------|--------|----------|\n| Product Usage | 85 | 30% | 12 active users, 85% feature adoption |\n| Support Tickets | 60 | 20% | 3 open tickets, 1 escalation |\n| Engagement | 78 | 25% | Regular check-ins, attends webinars |\n| Payment | 95 | 15% | Always on time |\n| NPS | 65 | 10% | Score: 8 (Promoter) |\n\n**Risk Factors:**\n⚠️ 3 open support tickets (1 escalation pending)\n⚠️ Login frequency dropped 15% last month\n\n**Positive Signals:**\n✅ Attended 2 webinars this quarter\n✅ Referred 1 new customer\n✅ Expanded user count by 20%\n\n**Recommendations:**\n1. Resolve escalation within 24 hours\n2. Schedule QBR to re-engage\n3. Offer training session to boost usage\n\n**Retention Risk:** Low (15% churn probability)\n**Expansion Potential:** High — could add 10 more seats ($12K ARR)"
    },
    {
        "human": "Create an onboarding plan for new customer {company}",
        "gpt": "📋 **Onboarding Plan: {company}**\n\n**Customer Details:**\n- Plan: Enterprise\n- Users: 25\n- Contract: $45,000/yr\n- Go-Live Target: Aug 21, 2026\n\n**30-Day Onboarding Roadmap:**\n\n| Week | Focus | Activities | Owner |\n|------|-------|------------|-------|\n| 1 | Setup | Account config, SSO, data import | CSM |\n| 1 | Training | Admin training (2 sessions) | Trainer |\n| 2 | Integration | Connect email, calendar, Slack | CSM |\n| 2 | Training | End-user training (4 sessions) | Trainer |\n| 3 | Go-Live | Launch to first team (10 users) | CSM |\n| 3 | Support | Daily check-ins, quick fixes | Support |\n| 4 | Expand | Roll out to full team (25 users) | CSM |\n| 4 | Review | 30-day success review | CSM + Exec |\n\n**Success Metrics (30 days):**\n- [ ] All 25 users activated\n- [ ] 80% feature adoption\n- [ ] 3+ workflows created\n- [ ] 0 critical issues\n- [ ] NPS survey sent\n\n**Risks:**\n- Data migration complexity (10K records)\n- SSO configuration (customer uses Okta)\n\nOnboarding tasks created. Kickoff call scheduled for Aug 8."
    },
]

# 22. DATA QUALITY
TEMPLATES["data_quality"] = [
    {
        "human": "Check for duplicate contacts",
        "gpt": "🔍 **Duplicate Detection Results**\n\nFound **23 potential duplicates** across **1,847 contacts**:\n\n**High Confidence (90%+):**\n| Contact 1 | Contact 2 | Match Score | Suggested Action |\n|-----------|-----------|-------------|------------------|\n| {name1} ({email1}) | {name1} ({email2}) | 98% | Merge |\n| {name2} ({email3}) | {name2} ({email4}) | 95% | Merge |\n| {name3} ({email5}) | {name3} ({email6}) | 92% | Merge |\n\n**Medium Confidence (70-89%):**\n| Contact 1 | Contact 2 | Match Score | Suggested Action |\n|-----------|-----------|-------------|------------------|\n| {name4} | {name4} | 85% | Review manually |\n| {name5} | {name5} | 78% | Review manually |\n\n**Auto-Merge Ready:** 8 contacts (high confidence)\n**Manual Review Needed:** 15 contacts\n\n**Impact:** Merging will clean 0.6% of database\n\nWant me to auto-merge the high-confidence duplicates?"
    },
    {
        "human": "Enrich contact data for leads from last week",
        "gpt": "📊 **Data Enrichment Results**\n\nEnriched **47 leads** from last week:\n\n**Enrichment Summary:**\n| Field | Enriched | Already Had |\n|-------|----------|-------------|\n| Company Size | 38 (81%) | 9 |\n| Industry | 42 (89%) | 5 |\n| LinkedIn Profile | 35 (74%) | 12 |\n| Revenue | 28 (60%) | 19 |\n| Tech Stack | 31 (66%) | 16 |\n\n**New Insights:**\n- 12 leads are Series B+ ($10M+ funding)\n- 8 leads use Salesforce (integration opportunity)\n- 15 leads have 100+ employees (enterprise segment)\n\n**Data Quality Score:** Improved from 72% to 89%\n\n**Enrichment Sources:**\n- Company data: Clearbit\n- LinkedIn: Profile matching\n- Tech stack: BuiltWith\n\nWant me to update the CRM records with enriched data?"
    },
]

# 23. COLLABORATION
TEMPLATES["collaboration"] = [
    {
        "human": "Mention @sarah in a note on {name}'s deal",
        "gpt": "Note added with mention:\n\n**Deal:** {company} Enterprise Plan\n**Mentioned:** @sarah (Sarah Chen, Solutions Architect)\n**Note:**\n\"@sarah Can you review the technical requirements for this deal? {name} needs API integration with their Salesforce instance. They have 12 custom objects and need real-time sync. Available for a quick sync tomorrow?\"\n\n**Notification:** Sarah will receive:\n- In-app notification\n- Email notification\n- Slack mention (if connected)\n\nNote saved. Sarah can respond directly from any channel."
    },
    {
        "human": "Share my pipeline view with the sales team",
        "gpt": "Pipeline view shared:\n\n**Shared View:** My Pipeline — August 2026\n**Shared With:** Sales Team (5 members)\n**Permissions:** View only\n\n**View Contents:**\n- 50 active deals\n- Total value: $981,500\n- Filters applied: My deals, Open status\n\n**Recipients:**\n- {name1} — Can view\n- {name2} — Can view\n- {name3} — Can view\n- {name4} — Can view\n- {name5} — Can view\n\n**Link:** [Shared Pipeline View]\n\nView shared. Team members can bookmark for quick access."
    },
]

# 24. MOBILE
TEMPLATES["mobile"] = [
    {
        "human": "What's my schedule for today on mobile?",
        "gpt": "📱 **Today's Mobile Schedule**\n\n**Upcoming:**\n| Time | Event | Location |\n|------|-------|----------|\n| 10:00 AM | Pipeline Review | Zoom |\n| 2:00 PM | Discovery Call — {name1} | Phone |\n| 4:00 PM | Demo Prep | Office |\n\n**Quick Actions:**\n- 📞 Call {name1} (tap to dial)\n- 📧 Email {name2} (tap to compose)\n- ✅ Complete task: Send proposal\n- 📝 Add note to {name3}'s deal\n\n**Offline Access:**\n- 12 contacts cached\n- 8 deals cached\n- Last sync: 5 minutes ago\n\n**Notifications:**\n- 3 unread\n- 1 urgent: Deal {company} needs attention\n\nWant me to navigate to any of these?"
    },
]

# 25. COMPLIANCE
TEMPLATES["compliance"] = [
    {
        "human": "Check GDPR compliance for EU contacts",
        "gpt": "🔒 **GDPR Compliance Report**\n\n**EU Contacts:** 234 (13% of database)\n\n**Compliance Status:**\n| Requirement | Status | Details |\n|-------------|--------|---------|\n| Consent Record | ✅ 98% | 229/234 have consent logged |\n| Right to Access | ✅ Ready | Export tool available |\n| Right to Erasure | ⚠️ 95% | 12 contacts missing deletion request handling |\n| Data Retention | ✅ Compliant | 90-day auto-archive for inactive |\n| DPA | ✅ Signed | Updated: Jan 2026 |\n\n**Issues Found:**\n1. ⚠️ 5 contacts without consent record (need to obtain or delete)\n2. ⚠️ 12 contacts missing deletion request workflow\n3. 📋 3 contacts requested data export (pending)\n\n**Recommended Actions:**\n1. Obtain consent from 5 contacts or remove them\n2. Configure deletion request automation\n3. Fulfill 3 pending export requests (deadline: 5 days)\n\n**Compliance Score:** 94/100 🟢\n\nWant me to generate a detailed report or fix the issues?"
    },
    {
        "human": "Show audit log for contact changes this week",
        "gpt": "📋 **Audit Log — Contact Changes (Aug 1-7, 2026)**\n\n**Total Changes:** 847\n**Users Involved:** 5\n\n**By Action:**\n| Action | Count | User |\n|--------|-------|------|\n| Created | 156 | {name1} (89), {name2} (67) |\n| Updated | 534 | {name1} (234), {name3} (189), {name4} (111) |\n| Merged | 12 | {name5} |\n| Deleted | 8 | {name1} |\n| Exported | 3 | {name2} |\n\n**Sensitive Changes:**\n| Time | User | Contact | Change |\n|------|------|---------|--------|\n| Aug 5 14:32 | {name1} | {name5} | Email changed |\n| Aug 6 09:15 | {name2} | {name6} | Phone changed |\n| Aug 6 11:45 | {name3} | {name7} | Address changed |\n\n**Compliance Notes:**\n- All changes logged with timestamp and user\n- Export actions flagged for review\n- Deletion actions require manager approval\n\n**Report Exported:** audit-log-aug-1-7-2026.csv"
    },
]

# ============================================================
# GENERATOR
# ============================================================

def fill_template(template, context):
    """Fill a template with context values."""
    human = template["human"]
    gpt = template["gpt"]
    
    for key, value in context.items():
        human = human.replace("{" + key + "}", str(value))
        gpt = gpt.replace("{" + key + "}", str(value))
    
    # Fill any remaining {name1}, {email1} etc with random values
    import re
    placeholders = set(re.findall(r'\{(\w+)\}', human + gpt))
    for ph in placeholders:
        if ph.startswith("name"):
            val = rand_name()
        elif ph.startswith("email"):
            val = rand_email(rand_name())
        elif ph.startswith("company"):
            val = rand_company()
        elif ph.startswith("phone"):
            val = rand_phone()
        elif ph.startswith("title"):
            val = random.choice(TITLES)
        elif ph.startswith("amount"):
            val = f"{rand_amount():,.2f}"
        else:
            val = rand_name()
        
        human = human.replace("{" + ph + "}", val)
        gpt = gpt.replace("{" + ph + "}", val)
    
    return human, gpt

def generate_conversations(target_per_category=400, total_target=10000):
    """Generate conversations across all categories."""
    
    categories = list(TEMPLATES.keys())
    conversations = []
    
    # Calculate per-category target
    per_category = total_target // len(categories)
    
    print(f"Generating {total_target} conversations across {len(categories)} categories...")
    print(f"Target per category: {per_category}")
    print()
    
    for cat in categories:
        templates = TEMPLATES[cat]
        cat_count = 0
        
        for _ in range(per_category // len(templates) + 1):
            if cat_count >= per_category:
                break
            
            for template in templates:
                if cat_count >= per_category:
                    break
                
                # Generate context
                name = rand_name()
                context = {
                    "name": name,
                    "email": rand_email(name),
                    "company": rand_company(),
                    "phone": rand_phone(),
                    "amount": f"{rand_amount():,.2f}",
                    "amount2": f"{rand_amount():,.2f}",
                    "title": random.choice(TITLES),
                    "industry": random.choice(INDUSTRIES),
                }
                
                # Add extra names/emails for multi-contact templates
                for i in range(1, 5):
                    n = rand_name()
                    context[f"name{i}"] = n
                    context[f"email{i}"] = rand_email(n)
                    context[f"company{i}"] = rand_company()
                    context[f"title{i}"] = random.choice(TITLES)
                
                human, gpt = fill_template(template, context)
                
                conv = {
                    "id": str(uuid.uuid4()),
                    "conversations": [
                        {
                            "from": "system",
                            "value": "You are NuCRM, an intelligent CRM assistant. You help sales teams manage leads, contacts, deals, tickets, and customer relationships. You can analyze data, generate insights, compose emails, score leads, predict outcomes, and provide strategic advice. Be professional, concise, and actionable."
                        },
                        {"from": "human", "value": human},
                        {"from": "gpt", "value": gpt}
                    ],
                    "metadata": {
                        "category": cat,
                        "created_at": datetime.now().isoformat(),
                        "version": "2.0"
                    }
                }
                conversations.append(conv)
                cat_count += 1
        
        print(f"  {cat}: {cat_count} conversations")
    
    # Trim to exact target
    random.shuffle(conversations)
    conversations = conversations[:total_target]
    
    return conversations

def main():
    print("=" * 60)
    print("NuCRM Gemma Training Data Generator v2.0")
    print("Full CRM Coverage — 25 Categories")
    print("=" * 60)
    print()
    
    conversations = generate_conversations(total_target=10000)
    
    # Save
    output_dir = "/home/vinayak_shruti_biz/nucrm/synthetic-data/gemma-training"
    output_file = f"{output_dir}/nucrm-gemma-training-full.jsonl"
    
    import os
    os.makedirs(output_dir, exist_ok=True)
    
    with open(output_file, "w") as f:
        for conv in conversations:
            f.write(json.dumps(conv, ensure_ascii=False) + "\n")
    
    # Stats
    file_size = os.path.getsize(output_file)
    categories = {}
    for conv in conversations:
        cat = conv["metadata"]["category"]
        categories[cat] = categories.get(cat, 0) + 1
    
    print()
    print("=" * 60)
    print("GENERATION COMPLETE")
    print("=" * 60)
    print(f"Total conversations: {len(conversations)}")
    print(f"Output file: {output_file}")
    print(f"File size: {file_size / (1024*1024):.1f} MB")
    print()
    print("Category breakdown:")
    for k, v in sorted(categories.items()):
        print(f"  {k:30s} {v:,}")
    
    # Also copy to website for download
    website_dir = "/home/vinayak_shruti_biz/website"
    import shutil
    shutil.copy2(output_file, website_dir)
    print(f"\nCopied to website: {website_dir}/")

if __name__ == "__main__":
    main()
