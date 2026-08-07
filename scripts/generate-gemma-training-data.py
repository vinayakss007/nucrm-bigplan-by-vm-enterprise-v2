#!/usr/bin/env python3
"""
NuCRM Gemma Training Data Generator
Generates ShareGPT-style conversational data for Gemma fine-tuning.
Output: JSONL with human/gpt conversation pairs.
"""

import json
import random
import uuid
from datetime import datetime, timedelta
from pathlib import Path

OUTPUT_DIR = Path("/home/vinayak_shruti_biz/nucrm/synthetic-data/gemma-training")
SEED = 42
random.seed(SEED)

# ═══════════════════════════════════════════════════════════════
# DATA POOLS
# ═══════════════════════════════════════════════════════════════

FIRST_NAMES = ["James","Mary","Robert","Patricia","John","Jennifer","Michael","Linda","David","Elizabeth","William","Barbara","Richard","Susan","Joseph","Jessica","Thomas","Sarah","Christopher","Karen","Charles","Lisa","Daniel","Nancy","Matthew","Betty","Anthony","Margaret","Mark","Sandra","Steven","Ashley","Paul","Emily","Andrew","Donna","Joshua","Michelle","Kenneth","Dorothy","Kevin","Carol","Brian","Amanda","George","Melissa","Timothy","Deborah","Ronald","Stephanie"]
LAST_NAMES = ["Smith","Johnson","Williams","Brown","Jones","Garcia","Miller","Davis","Rodriguez","Martinez","Hernandez","Lopez","Gonzalez","Wilson","Anderson","Thomas","Taylor","Moore","Jackson","Martin","Lee","Perez","Thompson","White","Harris","Sanchez","Clark","Ramirez","Lewis","Robinson","Walker","Young","Allen","King","Wright","Scott","Torres","Nguyen","Hill","Flores"]
COMPANY_NAMES = ["TechNova Solutions","DataFlow Systems","CloudPeak Analytics","NexGen Software","Quantum Dynamics","BlueShift Labs","IronClad Security","SilverLine Corp","GreenField Capital","RedRock Ventures","Apex Innovations","Zenith Partners","Pulse Digital","Forge Industries","Summit Analytics","Catalyst Group","Velocity Labs","Atlas Computing","Prism Technologies","Vanguard Systems"]
INDUSTRIES = ["Technology","Healthcare","Finance","Education","Manufacturing","Retail","Real Estate","Marketing","Legal","Consulting"]
CITIES = ["New York","Los Angeles","Chicago","Houston","Phoenix","Philadelphia","San Antonio","San Diego","Dallas","San Jose"]
JOB_TITLES = ["CEO","CTO","CFO","VP Sales","VP Marketing","Director","Manager","Engineer","Analyst","Consultant","Account Executive","Product Manager","Sales Rep","Support Engineer"]
LEAD_SOURCES = ["website","referral","linkedin","cold_call","email_campaign","trade_show","social_media","partner"]
LEAD_STATUSES = ["new","contacted","qualified","unqualified","converted","lost"]
DEAL_STAGES = ["Prospecting","Qualification","Proposal","Negotiation","Closed Won","Closed Lost"]
TICKET_STATUSES = ["open","in_progress","resolved","closed"]
TICKET_PRIORITIES = ["low","medium","high","urgent"]
INVOICE_STATUSES = ["draft","sent","viewed","paid","overdue","cancelled"]
TASK_STATUSES = ["pending","in_progress","completed"]
TASK_PRIORITIES = ["low","medium","high","urgent"]

# ═══════════════════════════════════════════════════════════════
# CRM CONVERSATION TEMPLATES
# ═══════════════════════════════════════════════════════════════

SYSTEM_PROMPT = "You are NuCRM, an intelligent CRM assistant. You help sales teams manage leads, contacts, deals, tickets, and customer relationships. Be professional, concise, and actionable."

# Each template: (user_prompt_variations, assistant_response_template)
CRM_TASKS = [
    # ─── LEAD MANAGEMENT ───
    {
        "category": "lead_management",
        "templates": [
            {
                "user": ["Create a new lead for {name} from {company}", "Add lead: {name} at {company}", "I need to add a new lead named {name} from {company}"],
                "assistant": "I've created a new lead:\n\n**{name}**\n- Company: {company}\n- Source: {source}\n- Status: New\n- Score: 0\n\nThe lead has been added to your pipeline. Would you like to assign it to a team member or add contact details?"
            },
            {
                "user": ["What's the status of lead {name}?", "Check lead status for {name}", "Tell me about lead {name}"],
                "assistant": "Here's the status for lead **{name}**:\n\n- **Status:** {status}\n- **Score:** {score}/100\n- **Value:** ${value:,.2f}\n- **Source:** {source}\n- **Last Activity:** {days_ago} days ago\n- **Assigned To:** {assignee}\n\n{recommendation}"
            },
            {
                "user": ["Convert lead {name} to a contact", "Convert {name} from lead to contact", "Move {name} to contacts"],
                "assistant": "Lead **{name}** has been converted to a contact:\n\n- **Contact Created:** {name} ({email})\n- **Company:** {company}\n- **Lifecycle Stage:** Marketing Qualified Lead\n- **Lead Status:** Converted\n\nThe contact is now available in your contacts database. Would you like to create a deal for this contact?"
            },
            {
                "user": ["Assign lead {name} to {assignee}", "Give lead {name} to {assignee}", "Route {name} to {assignee}"],
                "assistant": "Lead **{name}** has been assigned to **{assignee}**.\n\n- **Previous Owner:** {prev_owner}\n- **New Owner:** {assignee}\n- **Reassignment Reason:** Manual routing\n\n{assignee} will receive a notification about this assignment."
            },
            {
                "user": ["How many leads did we get this month?", "Monthly lead count", "Lead generation summary for this month"],
                "assistant": "**Monthly Lead Summary:**\n\n- **New Leads:** {count} this month\n- **Conversion Rate:** {rate}%\n- **Top Source:** {top_source}\n- **Average Score:** {avg_score}\n- **Pipeline Value:** ${pipeline_value:,.2f}\n\n{insight}"
            },
        ]
    },
    # ─── CONTACT MANAGEMENT ───
    {
        "category": "contact_management",
        "templates": [
            {
                "user": ["Add a new contact {name} from {company}", "Create contact: {name}, {title} at {company}", "New contact entry for {name}"],
                "assistant": "Contact **{name}** has been created:\n\n- **Email:** {email}\n- **Phone:** {phone}\n- **Company:** {company}\n- **Title:** {title}\n- **Department:** {department}\n- **Lifecycle Stage:** Subscriber\n\nContact is now in your database. Would you like to log an activity or schedule a follow-up?"
            },
            {
                "user": ["Find contacts at {company}", "Show me everyone at {company}", "List all contacts from {company}"],
                "assistant": "Found **{count} contacts** at {company}:\n\n1. **{contact1_name}** — {contact1_title} ({contact1_email})\n2. **{contact2_name}** — {contact2_title} ({contact2_email})\n3. **{contact3_name}** — {contact3_title} ({contact3_email})\n\n{more_text}\n\nWould you like to filter by status, score, or last activity?"
            },
            {
                "user": ["What's the engagement score for {name}?", "Check {name}'s engagement", "How engaged is {name}?"],
                "assistant": "**Engagement Score for {name}:**\n\n- **Overall Score:** {score}/100\n- **Engagement Score:** {engagement}/100\n- **Fit Score:** {fit}/100\n- **Intent Score:** {intent}/100\n\n**Recent Activity:**\n- Last email: {email_days} days ago\n- Last call: {call_days} days ago\n- Last meeting: {meeting_days} days ago\n\n{recommendation}"
            },
            {
                "user": ["Update contact info for {name}", "Change {name}'s phone number to {phone}", "Edit {name}'s details"],
                "assistant": "Contact **{name}** has been updated:\n\n- **Phone:** {phone}\n- **Updated Fields:** Contact information\n- **Last Modified:** Just now\n\nThe changes are saved. Would you like to log this update as an activity?"
            },
        ]
    },
    # ─── DEAL MANAGEMENT ───
    {
        "category": "deal_management",
        "templates": [
            {
                "user": ["Create a deal for {company}", "New deal: {deal_title}", "Add a deal worth ${amount} for {company}"],
                "assistant": "Deal created successfully:\n\n**{deal_title}**\n- **Amount:** ${amount:,.2f}\n- **Company:** {company}\n- **Stage:** Prospecting\n- **Close Date:** {close_date}\n- **Assigned To:** {assignee}\n\nThe deal is now in your pipeline. Would you like to add products or schedule a follow-up?"
            },
            {
                "user": ["Move deal {deal_title} to {stage}", "Update deal stage to {stage}", "Advance {deal_title} to {stage}"],
                "assistant": "Deal **{deal_title}** has been moved to **{stage}**.\n\n- **Previous Stage:** {prev_stage}\n- **New Stage:** {stage}\n- **Stage Entered:** Just now\n- **Days in Previous Stage:** {days} days\n\n{stage_advice}"
            },
            {
                "user": ["Show me all deals closing this month", "Deals closing soon", "What deals are expected to close?"],
                "assistant": "**Deals Closing This Month:**\n\n| Deal | Amount | Stage | Days Left |\n|------|--------|-------|----------|\n| {deal1} | ${amount1:,.2f} | {stage1} | {days1} |\n| {deal2} | ${amount2:,.2f} | {stage2} | {days2} |\n| {deal3} | ${amount3:,.2f} | {stage3} | {days3} |\n\n**Total Pipeline:** ${total:,.2f}\n**Weighted Value:** ${weighted:,.2f}\n\n{recommendation}"
            },
            {
                "user": ["What's our win rate this quarter?", "Quarterly win rate", "How many deals have we closed?"],
                "assistant": "**Quarterly Performance:**\n\n- **Total Deals:** {total_deals}\n- **Won:** {won} ({win_rate}%)\n- **Lost:** {lost}\n- **Open:** {open}\n- **Total Revenue:** ${revenue:,.2f}\n- **Average Deal Size:** ${avg_deal:,.2f}\n- **Average Sales Cycle:** {avg_cycle} days\n\n{insight}"
            },
            {
                "user": ["Mark deal {deal_title} as won", "Close deal as won", "Mark {deal_title} as closed won"],
                "assistant": "Congratulations! Deal **{deal_title}** has been marked as **Won**! 🎉\n\n- **Amount:** ${amount:,.2f}\n- **Close Date:** Today\n- **Company:** {company}\n- **Contact:** {contact}\n\nWould you like to:\n1. Create an invoice for this deal\n2. Send a thank-you email\n3. Schedule a kickoff meeting"
            },
        ]
    },
    # ─── TASK MANAGEMENT ───
    {
        "category": "task_management",
        "templates": [
            {
                "user": ["Create a task to follow up with {name}", "Remind me to call {name}", "Add task: follow up with {name}"],
                "assistant": "Task created:\n\n**Follow up with {name}**\n- **Due Date:** {due_date}\n- **Priority:** Medium\n- **Status:** Pending\n- **Assigned To:** You\n\nThe task has been added to your task list. Would you like to set a reminder?"
            },
            {
                "user": ["What tasks are overdue?", "Show me overdue tasks", "Which tasks am I behind on?"],
                "assistant": "**Overdue Tasks:**\n\n| Task | Priority | Due Date | Days Overdue |\n|------|----------|----------|-------------|\n| {task1} | {priority1} | {due1} | {overdue1} |\n| {task2} | {priority2} | {due2} | {overdue2} |\n| {task3} | {priority3} | {due3} | {overdue3} |\n\n**Total Overdue:** {count} tasks\n\n{recommendation}"
            },
            {
                "user": ["Complete task {task_name}", "Mark task as done", "Finish {task_name}"],
                "assistant": "Task **{task_name}** has been marked as completed.\n\n- **Completed At:** Just now\n- **Time Taken:** {time_taken}\n\nWould you like to log this activity or move on to the next task?"
            },
        ]
    },
    # ─── SUPPORT TICKETS ───
    {
        "category": "ticket_management",
        "templates": [
            {
                "user": ["Create a support ticket for {name}: {issue}", "New ticket: {issue}", "Customer {name} has an issue: {issue}"],
                "assistant": "Support ticket created:\n\n**Ticket #{ticket_id}**\n- **Customer:** {name}\n- **Issue:** {issue}\n- **Priority:** {priority}\n- **Status:** Open\n- **Category:** {category}\n\nThe ticket has been assigned to the support team. Would you like to set an SLA policy?"
            },
            {
                "user": ["What's the SLA status for ticket #{ticket_id}?", "Check SLA compliance", "Is ticket #{ticket_id} within SLA?"],
                "assistant": "**SLA Status for Ticket #{ticket_id}:**\n\n- **Status:** {sla_status}\n- **First Response:** {response_time} (SLA: {sla_target})\n- **Time Remaining:** {time_remaining}\n- **Priority:** {priority}\n\n{sla_recommendation}"
            },
            {
                "user": ["Resolve ticket #{ticket_id}", "Close ticket #{ticket_id}", "Mark ticket as resolved"],
                "assistant": "Ticket #{ticket_id} has been resolved.\n\n- **Resolution:** {resolution}\n- **Resolved At:** Just now\n- **First Response Time:** {first_response}\n- **Resolution Time:** {resolution_time}\n\nWould you like to send a CSAT survey to the customer?"
            },
        ]
    },
    # ─── INVOICING ───
    {
        "category": "invoicing",
        "templates": [
            {
                "user": ["Create an invoice for {company}", "Generate invoice for {amount} of work", "Bill {company} for services"],
                "assistant": "Invoice created:\n\n**Invoice #{invoice_number}**\n- **Client:** {company}\n- **Amount:** ${amount:,.2f}\n- **Due Date:** {due_date}\n- **Status:** Draft\n\nThe invoice is ready for review. Would you like to send it to the client?"
            },
            {
                "user": ["What invoices are overdue?", "Show overdue payments", "Which invoices haven't been paid?"],
                "assistant": "**Overdue Invoices:**\n\n| Invoice | Client | Amount | Due Date | Days Overdue |\n|---------|--------|--------|----------|-------------|\n| {inv1} | {client1} | ${amount1:,.2f} | {due1} | {overdue1} |\n| {inv2} | {client2} | ${amount2:,.2f} | {due2} | {overdue2} |\n\n**Total Overdue:** ${total_overdue:,.2f}\n\n{collection_recommendation}"
            },
        ]
    },
    # ─── ANALYTICS ───
    {
        "category": "analytics",
        "templates": [
            {
                "user": ["Give me a sales summary", "Sales dashboard overview", "How are sales doing?"],
                "assistant": "**Sales Dashboard Overview:**\n\n**Pipeline:**\n- Total Deals: {total_deals}\n- Pipeline Value: ${pipeline_value:,.2f}\n- Weighted Value: ${weighted_value:,.2f}\n\n**Performance:**\n- Win Rate: {win_rate}%\n- Avg Deal Size: ${avg_deal:,.2f}\n- Avg Sales Cycle: {avg_cycle} days\n- Revenue (MTD): ${mtd_revenue:,.2f}\n\n**Trends:**\n- {trend_1}\n- {trend_2}\n\n{recommendation}"
            },
            {
                "user": ["Which leads have the highest scores?", "Top scored leads", "Show me hot leads"],
                "assistant": "**Top 5 Highest-Scored Leads:**\n\n| Rank | Name | Score | Status | Value |\n|------|------|-------|--------|-------|\n| 1 | {lead1} | {score1} | {status1} | ${value1:,.2f} |\n| 2 | {lead2} | {score2} | {status2} | ${value2:,.2f} |\n| 3 | {lead3} | {score3} | {status3} | ${value3:,.2f} |\n| 4 | {lead4} | {score4} | {status4} | ${value4:,.2f} |\n| 5 | {lead5} | {score5} | {status5} | ${value5:,.2f} |\n\n{insight}"
            },
            {
                "user": ["What's our customer churn rate?", "Customer retention metrics", "How many customers have we lost?"],
                "assistant": "**Customer Retention Metrics:**\n\n- **Current Customers:** {customers}\n- **Churned (Last Quarter):** {churned}\n- **Churn Rate:** {churn_rate}%\n- **Retention Rate:** {retention_rate}%\n- **Avg Customer Lifetime:** {avg_lifetime} months\n- **NPS Score:** {nps}\n\n**Risk Factors:**\n- {risk_1}\n- {risk_2}\n\n{recommendation}"
            },
        ]
    },
    # ─── DATA MANAGEMENT ───
    {
        "category": "data_management",
        "templates": [
            {
                "user": ["Import contacts from CSV", "Bulk upload contacts", "How do I import data?"],
                "assistant": "**CSV Import Guide:**\n\n1. **Prepare your CSV** with these columns:\n   - Required: first_name, last_name, email\n   - Optional: phone, company, title, city, state, country\n\n2. **Upload** via Settings > Import > Contacts\n\n3. **Map columns** to CRM fields\n\n4. **Choose import options:**\n   - Skip duplicates (recommended)\n   - Update existing records\n   - Assign to team member\n\n5. **Review and confirm**\n\nMax file size: 10MB. Max rows: 10,000.\n\nNeed help with a specific import?"
            },
            {
                "user": ["Merge duplicate contacts", "How do I merge contacts?", "Combine duplicate records"],
                "assistant": "**Contact Merge Guide:**\n\n1. **Find duplicates:** Go to Contacts > Merge Duplicates\n2. **Select records:** Choose primary and duplicate\n3. **Review merge preview:**\n   - Primary contact keeps: name, email, phone\n   - Merged data: tags, activities, notes\n4. **Confirm merge**\n\n**What gets merged:**\n- Activities and notes\n- Deal associations\n- Task assignments\n- Tags and custom fields\n\n**What happens to duplicate:**\n- Soft deleted\n- Redirects to primary\n\nWould you like to find potential duplicates now?"
            },
        ]
    },
    # ─── AUTOMATION ───
    {
        "category": "automation",
        "templates": [
            {
                "user": ["Set up an automated follow-up sequence", "Create email automation", "Automate lead nurturing"],
                "assistant": "**Email Automation Setup:**\n\n**Sequence: Lead Nurture**\n\n| Step | Day | Action | Template |\n|------|-----|--------|----------|\n| 1 | 0 | Welcome Email | welcome_series |\n| 2 | 3 | Value Proposition | value_prop |\n| 3 | 7 | Case Study | case_study |\n| 4 | 14 | Demo Request | demo_ask |\n| 5 | 21 | Final Follow-up | last_chance |\n\n**Triggers:**\n- Lead score > 50\n- Form submission\n- Website visit (3+ pages)\n\n**Exit Conditions:**\n- Reply received\n- Unsubscribed\n- Converted to customer\n\nActivate this sequence?"
            },
            {
                "user": ["Create a workflow for deal stage changes", "Automate deal notifications", "Set up deal stage automation"],
                "assistant": "**Deal Stage Automation:**\n\n**Workflow: Deal Stage Notifications**\n\n**Trigger:** Deal stage changed\n\n**Actions:**\n1. **If stage = Proposal:**\n   - Notify assigned sales rep\n   - Create follow-up task (3 days)\n   - Log activity\n\n2. **If stage = Negotiation:**\n   - Notify manager\n   - Send internal Slack message\n   - Update deal forecast\n\n3. **If stage = Closed Won:**\n   - Send thank-you email\n   - Create onboarding task\n   - Notify customer success\n   - Generate invoice\n\n4. **If stage = Closed Lost:**\n   - Send feedback survey\n   - Log loss reason\n   - Move to re-engagement pool\n\nActivate this workflow?"
            },
        ]
    },
]

# ═══════════════════════════════════════════════════════════════
# GENERATORS
# ═══════════════════════════════════════════════════════════════

def gen_uuid():
    return str(uuid.uuid4())

def random_date(start, end):
    delta = end - start
    if delta.total_seconds() <= 0:
        return start
    return start + timedelta(days=random.randint(0, max(0, delta.days)))

def fill_template(template, context):
    """Fill template with context variables."""
    result = template
    for key, value in context.items():
        result = result.replace("{" + key + "}", str(value))
    return result

def generate_conversation(category_data):
    """Generate a single conversation pair."""
    template = random.choice(category_data["templates"])
    user_template = random.choice(template["user"])
    assistant_template = template["assistant"]

    # Generate random context
    first = random.choice(FIRST_NAMES)
    last = random.choice(LAST_NAMES)
    name = f"{first} {last}"
    company = random.choice(COMPANY_NAMES) + " " + random.choice(["Inc","LLC","Corp","Ltd"])

    stages = ["Prospecting","Qualification","Proposal","Negotiation","Closed Won","Closed Lost"]
    stage_idx = random.randint(0, len(stages)-1)

    context = {
        "name": name,
        "company": company,
        "email": f"{first.lower()}.{last.lower()}@{random.choice(['gmail.com','yahoo.com','outlook.com'])}",
        "phone": f"+1{random.randint(2000000000,9999999999)}",
        "title": random.choice(JOB_TITLES),
        "department": random.choice(["Engineering","Sales","Marketing","Finance","HR","Operations"]),
        "source": random.choice(LEAD_SOURCES),
        "status": random.choice(LEAD_STATUSES),
        "score": random.randint(10, 100),
        "value": random.randint(5000, 500000),
        "amount": random.randint(1000, 100000),
        "assignee": random.choice(FIRST_NAMES) + " " + random.choice(LAST_NAMES),
        "prev_owner": random.choice(FIRST_NAMES) + " " + random.choice(LAST_NAMES),
        "days_ago": random.randint(1, 30),
        "due_date": "End of " + random.choice(["this week","next week","this month"]),
        "close_date": f"{random.randint(1,28)} {random.choice(['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'])}",
        "recommendation": random.choice([
            "I recommend reaching out with a personalized message.",
            "This lead looks promising. Consider scheduling a demo.",
            "Follow up within 48 hours for best conversion chances.",
            "Add this lead to your priority outreach list.",
        ]),
        "deal_title": f"{random.choice(['Enterprise','Growth','Starter','Premium'])} Deal - {company}",
        "stage": random.choice(stages),
        "prev_stage": stages[max(0, stage_idx-1)],
        "days": random.randint(1, 30),
        "stage_advice": random.choice([
            "Consider scheduling a call to move this forward.",
            "Great progress! Prepare the proposal.",
            "Time to negotiate terms.",
            "Congratulations on closing this deal!",
        ]),
        "ticket_id": random.randint(1000, 9999),
        "issue": random.choice([
            "Login not working",
            "Payment failed",
            "Feature not available",
            "Data export issue",
            "API returning errors",
        ]),
        "priority": random.choice(TICKET_PRIORITIES),
        "category": random.choice(["technical","billing","feature_request","bug"]),
        "resolution": random.choice(["Fixed configuration","Updated permissions","Applied patch","Provided workaround"]),
        "sla_status": random.choice(["Within SLA","At Risk","Breached"]),
        "response_time": f"{random.randint(5,120)} minutes",
        "sla_target": f"{random.choice(['1','4','24'])} hour",
        "time_remaining": f"{random.randint(1,23)} hours",
        "sla_recommendation": random.choice([
            "Respond immediately to avoid breach.",
            "Still within acceptable range.",
            "Priority response needed.",
        ]),
        "task_name": random.choice(["Follow up with lead","Send proposal","Schedule demo","Update records"]),
        "time_taken": f"{random.randint(5,60)} minutes",
        "invoice_number": f"INV-{random.randint(1000,9999)}",
        "due_date": f"{random.randint(1,28)} {random.choice(['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'])}",
        "inv1": f"INV-{random.randint(1000,9999)}",
        "client1": random.choice(COMPANY_NAMES),
        "amount1": random.randint(1000, 50000),
        "due1": "Last month",
        "overdue1": random.randint(5, 30),
        "inv2": f"INV-{random.randint(1000,9999)}",
        "client2": random.choice(COMPANY_NAMES),
        "amount2": random.randint(1000, 50000),
        "due2": "2 weeks ago",
        "overdue2": random.randint(10, 45),
        "total_overdue": random.randint(5000, 100000),
        "collection_recommendation": random.choice([
            "Send payment reminders to all overdue clients.",
            "Consider offering payment plans for large overdue amounts.",
            "Escalate to collections for invoices over 30 days.",
        ]),
        "total_deals": random.randint(10, 50),
        "won": random.randint(3, 15),
        "lost": random.randint(1, 5),
        "open": random.randint(5, 20),
        "win_rate": random.randint(20, 60),
        "revenue": random.randint(50000, 500000),
        "avg_deal": random.randint(5000, 50000),
        "avg_cycle": random.randint(15, 60),
        "mtd_revenue": random.randint(10000, 100000),
        "pipeline_value": random.randint(100000, 1000000),
        "weighted_value": random.randint(50000, 500000),
        "trend_1": random.choice(["Revenue up 15% vs last month","Deals closing faster","New leads increased"]),
        "trend_2": random.choice(["Win rate improved","Pipeline growing","Avg deal size increasing"]),
        "insight": random.choice([
            "Focus on high-value deals in negotiation stage.",
            "Consider expanding into new markets.",
            "Customer referrals are your top source.",
        ]),
        "customers": random.randint(50, 500),
        "churned": random.randint(2, 20),
        "churn_rate": random.randint(2, 10),
        "retention_rate": random.randint(90, 98),
        "avg_lifetime": random.randint(6, 24),
        "nps": random.randint(30, 70),
        "risk_1": random.choice(["Low engagement in last 30 days","Payment delays","Support ticket spikes"]),
        "risk_2": random.choice(["Contract expiring soon","Competitor mentioned","Budget cuts announced"]),
        "contact1": random.choice(FIRST_NAMES) + " " + random.choice(LAST_NAMES),
        "contact2": random.choice(FIRST_NAMES) + " " + random.choice(LAST_NAMES),
        "contact3": random.choice(FIRST_NAMES) + " " + random.choice(LAST_NAMES),
        "contact1_title": random.choice(JOB_TITLES),
        "contact2_title": random.choice(JOB_TITLES),
        "contact3_title": random.choice(JOB_TITLES),
        "contact1_email": f"{random.choice(FIRST_NAMES).lower()}@{random.choice(COMPANY_NAMES).lower().replace(' ','')}.com",
        "contact2_email": f"{random.choice(FIRST_NAMES).lower()}@{random.choice(COMPANY_NAMES).lower().replace(' ','')}.com",
        "contact3_email": f"{random.choice(FIRST_NAMES).lower()}@{random.choice(COMPANY_NAMES).lower().replace(' ','')}.com",
        "count": random.randint(3, 20),
        "more_text": random.choice(["","And 2 more contacts...","And 5 more contacts..."]),
        "engagement": random.randint(20, 90),
        "fit": random.randint(30, 95),
        "intent": random.randint(10, 80),
        "email_days": random.randint(0, 14),
        "call_days": random.randint(0, 30),
        "meeting_days": random.randint(0, 60),
        "deal1": f"{random.choice(COMPANY_NAMES)} Deal",
        "amount1": random.randint(10000, 200000),
        "stage1": random.choice(stages),
        "days1": random.randint(1, 15),
        "deal2": f"{random.choice(COMPANY_NAMES)} Deal",
        "amount2": random.randint(10000, 200000),
        "stage2": random.choice(stages),
        "days2": random.randint(1, 15),
        "deal3": f"{random.choice(COMPANY_NAMES)} Deal",
        "amount3": random.randint(10000, 200000),
        "stage3": random.choice(stages),
        "days3": random.randint(1, 15),
        "total": random.randint(100000, 1000000),
        "weighted": random.randint(50000, 500000),
        "lead1": random.choice(FIRST_NAMES) + " " + random.choice(LAST_NAMES),
        "score1": random.randint(80, 100),
        "status1": "qualified",
        "value1": random.randint(50000, 500000),
        "lead2": random.choice(FIRST_NAMES) + " " + random.choice(LAST_NAMES),
        "score2": random.randint(70, 95),
        "status2": "contacted",
        "value2": random.randint(30000, 300000),
        "lead3": random.choice(FIRST_NAMES) + " " + random.choice(LAST_NAMES),
        "score3": random.randint(60, 90),
        "status3": "new",
        "value3": random.randint(20000, 200000),
        "lead4": random.choice(FIRST_NAMES) + " " + random.choice(LAST_NAMES),
        "score4": random.randint(50, 85),
        "status4": "qualified",
        "value4": random.randint(10000, 150000),
        "lead5": random.choice(FIRST_NAMES) + " " + random.choice(LAST_NAMES),
        "score5": random.randint(40, 80),
        "status5": "new",
        "value5": random.randint(5000, 100000),
        "task1": random.choice(["Follow up with lead","Send proposal","Schedule demo"]),
        "priority1": random.choice(TASK_PRIORITIES),
        "due1": "Last week",
        "overdue1": random.randint(1, 14),
        "task2": random.choice(["Update pipeline","Review analytics","Prepare report"]),
        "priority2": random.choice(TASK_PRIORITIES),
        "due2": "3 days ago",
        "overdue2": random.randint(3, 21),
        "task3": random.choice(["Call customer","Review contract","Team meeting"]),
        "priority3": random.choice(TASK_PRIORITIES),
        "due3": "Yesterday",
        "overdue3": random.randint(1, 7),
    }

    # Fill templates
    user_msg = fill_template(user_template, context)
    assistant_msg = fill_template(assistant_template, context)

    return {
        "id": gen_uuid(),
        "conversations": [
            {"from": "system", "value": SYSTEM_PROMPT},
            {"from": "human", "value": user_msg},
            {"from": "gpt", "value": assistant_msg},
        ],
        "metadata": {
            "category": category_data["category"],
            "created_at": datetime.now().isoformat(),
            "version": "1.0",
        }
    }

# ═══════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════

def generate_dataset(num_conversations=10000):
    print("=" * 60)
    print("NuCRM Gemma Training Data Generator")
    print("=" * 60)
    print(f"Generating {num_conversations} conversations...")
    print()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    conversations = []
    category_counts = {}

    for i in range(num_conversations):
        category_data = random.choice(CRM_TASKS)
        conv = generate_conversation(category_data)
        conversations.append(conv)

        cat = category_data["category"]
        category_counts[cat] = category_counts.get(cat, 0) + 1

        if (i + 1) % 1000 == 0:
            print(f"  Generated {i+1}/{num_conversations}...")

    # Write JSONL
    output_file = OUTPUT_DIR / "nucrm-gemma-training.jsonl"
    with open(output_file, "w") as f:
        for conv in conversations:
            f.write(json.dumps(conv) + "\n")

    # Write metadata
    metadata = {
        "dataset_name": "NuCRM Gemma Training Data",
        "version": "1.0",
        "total_conversations": len(conversations),
        "categories": category_counts,
        "format": "ShareGPT",
        "model": "Google Gemma",
        "system_prompt": SYSTEM_PROMPT,
        "created_at": datetime.now().isoformat(),
        "license": "Apache 2.0",
    }

    with open(OUTPUT_DIR / "metadata.json", "w") as f:
        json.dump(metadata, f, indent=2)

    # Print summary
    print()
    print("=" * 60)
    print("GENERATION COMPLETE")
    print("=" * 60)
    print(f"Total conversations: {len(conversations)}")
    print(f"Output file: {output_file}")
    print(f"File size: {output_file.stat().st_size / 1024 / 1024:.1f} MB")
    print()
    print("Category breakdown:")
    for cat, count in sorted(category_counts.items()):
        print(f"  {cat:25s} {count:>6,}")
    print()
    print("Sample conversation:")
    print(json.dumps(conversations[0], indent=2))

if __name__ == "__main__":
    generate_dataset(10000)
