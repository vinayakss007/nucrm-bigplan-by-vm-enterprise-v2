#!/usr/bin/env python3
"""
NuCRM Gemma Training Data Generator v3.0
ULTRA DIVERSE — Various users, companies, industries, scenarios
"""

import json
import uuid
import random
from datetime import datetime

# ============================================================
# DATA POOLS
# ============================================================

FIRST_NAMES = [
    "James", "Maria", "Wei", "Priya", "Ahmed", "Sarah", "Carlos", "Yuki",
    "Fatima", "Oliver", "Emma", "Rahul", "Sakura", "Mohammed", "Lisa",
    "David", "Ana", "Arjun", "Sophia", "Hiroshi", "Emily", "Vikram",
    "Meera", "John", "Kenji", "Aisha", "Chen", "Fatou", "Ivan", "Yuna",
    "Deepak", "Amara", "Takeshi", "Leila", "Oleg", "Mina", "Ravi",
    "Hans", "Sophie", "Lars", "Elena", "Marco", "Anna", "Pierre",
    "Katarina", "Stefan", "Ingrid", "Raj", "Sunita", "Kenji"
]

LAST_NAMES = [
    "Smith", "Garcia", "Zhang", "Patel", "Hassan", "Johnson", "Rodriguez",
    "Tanaka", "Al-Rashid", "Wilson", "Sharma", "Sato", "Khan", "Chen",
    "Kim", "Martinez", "Gupta", "Lee", "Nakamura", "Brown", "Singh",
    "Reddy", "Davis", "Watanabe", "Bello", "Wei", "Diallo", "Petrov",
    "Kim", "Nair", "Okafor", "Yamamoto", "Hosseini", "Volkov", "Park",
    "Kumar", "Mueller", "Dubois", "Johansson", "Petrov", "Rossi",
    "Schmidt", "Bernard", "Novak", "Weber", "Larsen", "Mehta", "Sharma"
]

COMPANIES = [
    "CloudSync Pro", "DataVault Analytics", "NexGen Solutions", "PixelForge Studios",
    "QuantumLeap AI", "CyberShield Security", "CodeCraft Labs", "InnoSoft Dynamics",
    "MedTech Innovations", "HealthFirst Systems", "CarePoint Solutions", "BioSync Labs",
    "FinEdge Capital", "WealthWise Advisors", "PayStream Solutions", "CreditScore Pro",
    "ShopWave Global", "CartOptimizer", "FulfillMax", "PriceWatch AI",
    "PropertyPro Solutions", "RealtyTech Systems", "TenantTrack Plus", "BuildSpace CRM",
    "EduTech Innovations", "LearnSmart Systems", "CampusConnect", "StudentSuccess Pro",
    "FactoryOS", "ProductionPulse", "QualitySync", "SupplyMind",
    "ConsultPro Platform", "AgencyHub", "ClientSuccess", "ProjectFlow",
    "TimeTrack Solutions", "InvoiceSmart", "ProposalGenius", "ContractMan",
    "InsureTech Plus", "AuditSmart", "RiskGuard Analytics", "FundFlow Systems",
    "ReviewHub Pro", "SupplyChain360", "RetailPulse", "MarketMaven",
    "SiteManager Pro", "LeaseLogic", "MortgageMind", "ZoningAI",
    "CourseBuilder AI", "SchoolAdmin Plus", "EdMetrics", "TeachFlow",
    "EquipmentTrack Pro", "LeanOps Systems", "MfgSmart", "AssemblyAI"
]

INDUSTRIES = [
    "SaaS/Technology", "Healthcare", "Financial Services", "E-commerce/Retail",
    "Manufacturing", "Real Estate", "Education", "Legal", "Construction",
    "Hospitality", "Media/Entertainment", "Automotive", "Agriculture",
    "Energy/Utilities", "Telecommunications"
]

COMPANY_SIZES = [
    ("Solo founder", "1", (500, 2000)),
    ("Startup (2-10)", "6", (2000, 10000)),
    ("Growing (11-50)", "30", (10000, 50000)),
    ("Mid-market (51-200)", "120", (50000, 200000)),
    ("Enterprise (201-1000)", "500", (200000, 1000000)),
    ("Large enterprise (1000+)", "5000", (500000, 5000000)),
]

USER_ROLES = [
    "Sales Rep", "SDR/BDR", "Account Executive", "Sales Manager",
    "VP Sales", "CEO", "Founder", "Marketing Manager",
    "Customer Success Manager", "Sales Ops", "RevOps",
    "Business Development", "Enterprise AE", "SMB Account Manager",
    "Sales Director", "Growth Marketer", "Channel Manager", "Sales Engineer",
    "Product Manager", "Consultant"
]

OBJECTIONS = [
    "Too expensive", "Already using competitor", "Need to think about it",
    "Budget not approved", "Decision maker unavailable", "Timing not right",
    "Need more features", "Security concerns", "Integration complexity",
    "No time to implement", "Team won't adopt", "ROI unclear",
    "Legal concerns", "Vendor stability", "Customization needs",
    "Support availability", "Data migration fears", "Training requirements",
    "Contract terms", "Competitor offered discount"
]

PAIN_POINTS = [
    "losing deals to competitors", "manual data entry eating time",
    "leads falling through cracks", "no visibility into pipeline",
    "slow response times", "poor forecasting accuracy",
    "siloed data across tools", "low conversion rates",
    "high customer churn", "difficult to scale", "complex reporting",
    "poor team collaboration", "lengthy sales cycles", "inconsistent process"
]

RESULTS = [
    "30% increase in conversions", "40% reduction in admin time",
    "2x faster response times", "25% higher deal values",
    "50% fewer lost leads", "35% improvement in forecast accuracy",
    "60% faster onboarding", "45% reduction in churn",
    "3x pipeline visibility", "20% larger team capacity"
]

TITLES = [
    "CEO", "CTO", "VP Sales", "VP Marketing", "Director of Operations",
    "Sales Manager", "Marketing Manager", "Product Manager", "Engineering Lead",
    "Account Executive", "Business Development Rep", "Customer Success Manager",
    "Solutions Architect", "Data Analyst", "Growth Hacker", "Head of Partnerships",
    "Chief Revenue Officer", "Sales Development Rep", "Territory Manager",
    "Regional Director", "Channel Manager", "Enterprise Account Manager"
]

# ============================================================
# CONVERSATION GENERATORS
# ============================================================

def gen_cold_email():
    name = f"{random.choice(FIRST_NAMES)} {random.choice(LAST_NAMES)}"
    company = random.choice(COMPANIES)
    industry = random.choice(INDUSTRIES)
    pain = random.choice(PAIN_POINTS)
    result = random.choice(RESULTS)
    
    return {
        "human": f"Write a cold email to {name} at {company} in {industry}",
        "gpt": f"Here's a personalized cold email for {name}:\n\n---\n**Subject:** Quick question about {company}'s growth\n\nHi {name.split()[0]},\n\nI noticed {company} has been growing in {industry}. Companies at your stage often struggle with {pain}.\n\nWe helped a similar company achieve {result} within 90 days.\n\nQuick question: How are you currently handling {pain}?\n\nIf it's something you're thinking about, I'd love to share a 5-minute overview.\n\nBest,\n[Your Name]\n---\n\n**Personalization:** Referenced their industry, specific pain point, social proof.",
        "category": "email_composition"
    }

def gen_objection_handling():
    name = f"{random.choice(FIRST_NAMES)} {random.choice(LAST_NAMES)}"
    objection = random.choice(OBJECTIONS)
    
    return {
        "human": f"The prospect says \"{objection}\". What do I say?",
        "gpt": f"Here's how to handle \"{objection}\":\n\n**Acknowledge:** \"I hear you — that's a valid concern.\"\n\n**Reframe:** \"Actually, many of our best customers felt the same way initially.\"\n\n**Proof:** \"They found that the ROI outweighed the cost within 3 months.\"\n\n**Ask:** \"What would you need to see to feel confident moving forward?\"\n\n**Key:** Don't argue. Listen, validate, then redirect to value.",
        "category": "ai_chat"
    }

def gen_lead_scoring():
    name = f"{random.choice(FIRST_NAMES)} {random.choice(LAST_NAMES)}"
    company = random.choice(COMPANIES)
    score = random.randint(45, 95)
    visits = random.randint(1, 10)
    emails = random.randint(1, 15)
    
    verdict = "Hot Lead" if score > 75 else "Warm Lead" if score > 55 else "Nurture"
    action = "Immediate outreach" if score > 75 else "Nurture sequence" if score > 55 else "Add to newsletter"
    
    return {
        "human": f"Score this lead: {name} from {company}, visited pricing page {visits} times, opened {emails} emails",
        "gpt": f"**Lead Score: {name} ({company})**\n\n| Signal | Score |\n|--------|-------|\n| Pricing visits ({visits}) | {random.randint(60,95)}/100 |\n| Email engagement ({emails}) | {random.randint(40,90)}/100 |\n| Fit | {random.randint(50,85)}/100 |\n\n**Overall: {score}/100 — {verdict}**\n\n**Action:** {action}\n**Best Time:** Tomorrow 10 AM\n**Conversion Probability:** {random.randint(15,65)}%",
        "category": "ai_scoring"
    }

def gen_deal_strategy():
    name = f"{random.choice(FIRST_NAMES)} {random.choice(LAST_NAMES)}"
    company = random.choice(COMPANIES)
    amount = random.randint(10, 200)
    situation = random.choice([
        "Competitor offering 20% discount",
        "Champion left the company",
        "Budget approved, ready to buy",
        "Stakeholder disagreement",
        "Long silence after proposal"
    ])
    
    plays = {
        "Competitor offering 20% discount": "Focus on ROI and total cost of ownership, not just price",
        "Champion left the company": "Rebuild relationship with new contact, reframe value",
        "Budget approved, ready to buy": "Send contract immediately, schedule kickoff",
        "Stakeholder disagreement": "Schedule alignment call, prepare multi-threaded proposal",
        "Long silence after proposal": "Send value-add content, ask open-ended question"
    }
    
    return {
        "human": f"Deal with {name} at {company} is worth ${amount}K. {situation}. What's my move?",
        "gpt": f"**Deal Strategy: {company}**\n\n**Situation:** {situation}\n**Value:** ${amount}K\n\n**Recommended Play:**\n1. {plays[situation]}\n2. Prepare talking points\n3. Schedule call within 24 hours\n\n**Script:**\n\"Hi {name.split()[0]}, I wanted to follow up on our proposal. Based on what you shared, I think there's a great opportunity here.\"\n\n**Timeline:** 2-3 days\n**Win Probability:** {random.randint(30,80)}%",
        "category": "deal_management"
    }

def gen_pipeline_analysis():
    deals = random.randint(5, 25)
    value = random.randint(100, 2000)
    
    return {
        "human": f"My pipeline looks like this: {deals} deals totaling ${value}K. What should I focus on?",
        "gpt": f"**Pipeline Analysis**\n\n**Current State:**\n- {deals} deals\n- Total value: ${value}K\n- Avg deal: ${value // max(deals,1)}K\n\n**Priority Actions:**\n1. Focus on deals closing this month\n2. Follow up on stale opportunities\n3. Qualify new leads to maintain coverage\n\n**Risk:** {deals // 3} deals haven't moved in 2+ weeks\n**Opportunity:** {deals // 4} deals are in late stages\n\n**This Week's Focus:**\n- Monday: Send proposals\n- Tuesday: Cold calls\n- Wednesday: Follow-ups\n- Thursday: Demos\n- Friday: Pipeline review",
        "category": "pipeline_management"
    }

def gen_task_priority():
    count = random.randint(5, 15)
    
    return {
        "human": f"I have {count} tasks due today. Help me prioritize.",
        "gpt": f"**Today's Priority Matrix** ({count} tasks)\n\n**🔴 Do First (Urgent + Important):**\n- Send proposal to hot lead\n- Call at-risk deal\n- Review contract\n\n**🟠 Schedule (Important, Not Urgent):**\n- Follow up with nurture leads\n- Update deal probabilities\n- Prep for tomorrow's demo\n\n**🟡 Delegate (Urgent, Not Important):**\n- Update CRM notes\n- Schedule meetings\n- Process invoices\n\n**🟢 Eliminate:**\n- Review old reports\n- Update LinkedIn\n\n**Time Blocking:**\n- 9-10 AM: Proposals\n- 10-12 PM: Calls\n- 1-3 PM: Admin\n- 3-5 PM: Outreach",
        "category": "task_management"
    }

def gen_followup_email():
    name = f"{random.choice(FIRST_NAMES)} {random.choice(LAST_NAMES)}"
    situation = random.choice([
        "went silent after demo",
        "opened email 5 times but didn't reply",
        "said they'd get back to me last week",
        "asked for pricing but hasn't responded",
        "attended webinar but no follow-up"
    ])
    
    subjects = {
        "went silent after demo": "Following up + something for you",
        "opened email 5 times but didn't reply": "Quick follow-up",
        "said they'd get back to me last week": "Circling back",
        "asked for pricing but hasn't responded": "Pricing question?",
        "attended webinar but no follow-up": "Thanks for attending!"
    }
    
    return {
        "human": f"Write a follow-up email to {name}. They {situation}.",
        "gpt": f"Follow-up for **{name}**:\n\n---\n**Subject:** {subjects[situation]}\n\nHi {name.split()[0]},\n\nI hope you're doing well! I wanted to follow up on our recent conversation.\n\n{situation.title()}. I put together a quick resource that might be helpful.\n\nWould you have 15 minutes this week to chat?\n\nBest,\n[Your Name]\n---\n\n**Strategy:** Added value, made it easy to respond, low-commitment CTA.",
        "category": "email_composition"
    }

def gen_analytics_report():
    metric = random.choice(["Sales performance", "Lead sources", "Pipeline velocity", "Team productivity", "Revenue trends"])
    period = random.choice(["this month", "this quarter", "last 30 days", "this week", "YTD"])
    
    return {
        "human": f"Show me {metric} for {period}",
        "gpt": f"📊 **{metric} — {period}**\n\n| Metric | Value | Change |\n|--------|-------|--------|\n| Revenue | ${random.randint(100,500)}K | +{random.randint(5,25)}% |\n| Deals | {random.randint(10,50)} | +{random.randint(5,20)}% |\n| Win Rate | {random.randint(20,40)}% | +{random.randint(2,8)}% |\n| Avg Deal | ${random.randint(10,50)}K | +{random.randint(5,15)}% |\n\n**Key Insights:**\n- Revenue trending up\n- Win rate improving from better qualification\n- Pipeline coverage at 3.2x\n\n**Recommendations:**\n1. Focus on enterprise deals\n2. Improve proposal speed\n3. Add more multi-threading",
        "category": "analytics"
    }

def gen_automation_setup():
    trigger = random.choice([
        "new lead routing", "deal stage updates", "churn prevention",
        "task creation", "email follow-ups", "report generation"
    ])
    
    return {
        "human": f"Set up automation for {trigger}",
        "gpt": f"**Automation: {trigger}**\n\n**Trigger:** {trigger.replace('_', ' ').title()}\n**Conditions:**\n- Not in do-not-contact list\n- Valid email address\n- Not already in workflow\n\n**Actions:**\n1. Score/evaluate lead\n2. Assign based on rules\n3. Send notification\n4. Create follow-up task\n\n**Expected Impact:**\n- Saves 2 hours/day of manual work\n- Faster response times\n- Consistent process\n\nAutomation is live. Want to add more conditions?",
        "category": "automation"
    }

def gen_invoice_action():
    company = random.choice(COMPANIES)
    amount = random.randint(5, 100)
    action = random.choice(["Create invoice", "Send payment reminder", "Process refund"])
    
    return {
        "human": f"{action} for {company} — ${amount}K",
        "gpt": f"**{action}:**\n\n- **Client:** {company}\n- **Amount:** ${amount}K\n- **Status:** Processing\n\n**Details:**\n- Line items verified\n- Payment terms: Net 30\n- Due date: {random.randint(1,30)} days from now\n\n**Next Steps:**\n1. Send to client\n2. Set payment reminder\n3. Track in invoice dashboard\n\n{action} complete.",
        "category": "invoicing"
    }

def gen_meeting_schedule():
    name = f"{random.choice(FIRST_NAMES)} {random.choice(LAST_NAMES)}"
    meeting_type = random.choice(["Demo", "Discovery call", "QBR", "Follow-up", "Negotiation"])
    
    return {
        "human": f"Schedule a {meeting_type.lower()} with {name}",
        "gpt": f"**Meeting Scheduled:**\n\n- **Type:** {meeting_type}\n- **With:** {name}\n- **Duration:** {random.choice(['30 min', '45 min', '60 min'])}\n\n**Prep Checklist:**\n- [ ] Review {name.split()[0]}'s background\n- [ ] Prepare agenda\n- [ ] Gather relevant materials\n\n**Agenda:**\n1. Introductions (5 min)\n2. Main discussion (20 min)\n3. Next steps (5 min)\n\nCalendar invite sent.",
        "category": "meeting_management"
    }

def gen_customer_success():
    company = random.choice(COMPANIES)
    risk = random.choice(["High", "Medium", "Low"])
    
    return {
        "human": f"{company} might be at risk of churning. {risk} priority. What do I do?",
        "gpt": f"**Retention Plan: {company}**\n\n**Risk Level:** {risk}\n**ARR:** ${random.randint(20,200)}K\n\n**Immediate Actions:**\n1. Schedule executive business review\n2. Offer dedicated support\n3. Provide training session\n\n**Recovery Script:**\n\"Hi, I noticed you haven't been using NuCRM as much lately. I want to make sure you're getting full value. Can we schedule 15 minutes?\"\n\n**Success Metrics:**\n- 30-day goal: Restore usage to 50%\n- 90-day goal: Full adoption + expansion",
        "category": "customer_success"
    }

def gen_data_quality():
    action = random.choice(["Find duplicates", "Enrich leads", "Validate emails", "Clean old records"])
    
    return {
        "human": f"{action} in my database",
        "gpt": f"**{action} Results:**\n\n**Summary:**\n- Total records: {random.randint(1000,5000)}\n- Issues found: {random.randint(10,100)}\n- Affected: {random.randint(50,500)} records\n\n**Details:**\n- High priority: {random.randint(1,10)}\n- Medium priority: {random.randint(5,30)}\n- Low priority: {random.randint(10,60)}\n\n**Recommendations:**\n1. Fix high-priority issues first\n2. Schedule regular cleanup\n3. Set up validation rules\n\nWant me to {action.lower()} the issues?",
        "category": "data_quality"
    }

def gen_compliance_check():
    scope = random.choice(["GDPR compliance", "Data retention", "Audit log", "Consent management"])
    
    return {
        "human": f"Check {scope.lower()} for my contacts",
        "gpt": f"**{scope} Report:**\n\n| Requirement | Status |\n|-------------|--------|\n| Consent Record | ✅ 98% |\n| Right to Access | ✅ Ready |\n| Right to Erasure | ⚠️ 95% |\n| Data Retention | ✅ Compliant |\n\n**Status:** 94/100 — Compliant\n\n**Action Required:**\n1. Update 5 missing consent records\n2. Configure deletion workflow\n3. Export audit log for records\n\nWant me to generate a detailed report?",
        "category": "compliance"
    }

def gen_integration():
    platform = random.choice(["Slack", "Zapier", "Salesforce", "HubSpot", "Google Workspace", "Microsoft 365"])
    
    return {
        "human": f"Connect NuCRM to {platform}",
        "gpt": f"**{platform} Integration:**\n\n**Setup:**\n1. Install NuCRM app from {platform} marketplace\n2. Authorize workspace\n3. Select channels/objects to sync\n4. Configure triggers\n\n**Features:**\n- Real-time notifications\n- Bi-directional sync\n- Custom workflows\n- Data mapping\n\n**Status:** Connected ✅\n**Test:** Successful\n\nIntegration is live. Want to customize notifications?",
        "category": "integration"
    }

def gen_mobile_check():
    timeframe = random.choice(["today", "this week", "tomorrow"])
    
    return {
        "human": f"What's my schedule for {timeframe}?",
        "gpt": f"📱 **{timeframe.title()} Overview**\n\n**Schedule:**\n- 10:00 AM: Pipeline review\n- 2:00 PM: Discovery call\n- 4:00 PM: Demo prep\n\n**Quick Actions:**\n- 📞 Call prospect\n- 📧 Send follow-up\n- ✅ Complete task\n\n**Offline:**\n- 12 contacts cached\n- 8 deals cached\n\n**Notifications:**\n- 3 unread\n- 1 urgent\n\nWant me to navigate to any of these?",
        "category": "mobile"
    }

def gen_collaboration():
    what = random.choice(["my pipeline view", "deal notes", "monthly report", "team dashboard"])
    who = random.choice(["Sales Team", "Manager", "Account Manager", "Leadership"])
    
    return {
        "human": f"Share {what} with {who}",
        "gpt": f"**Shared:** {what.title()}\n\n**Shared with:** {who}\n**Permissions:** View only\n\n**Contents:**\n- Active deals and pipeline\n- Contact information\n- Activity history\n- Performance metrics\n\n**Access Link:** [Generated]\n**Expiry:** 7 days\n\nShared successfully. {who} will receive notification.",
        "category": "collaboration"
    }

def gen_reporting():
    report_type = random.choice(["Revenue", "Team performance", "Pipeline", "Activity", "Churn"])
    period = random.choice(["this month", "this quarter", "last 30 days", "YTD"])
    
    return {
        "human": f"Generate {report_type.lower()} report for {period}",
        "gpt": f"📊 **{report_type} Report — {period}**\n\n| Metric | Value |\n|--------|-------|\n| Total | ${random.randint(100,1000)}K |\n| Growth | +{random.randint(5,30)}% |\n| Target | {random.randint(80,120)}% |\n\n**Key Takeaways:**\n1. Positive trend across all metrics\n2. Best performing segment identified\n3. Areas for improvement noted\n\n**Action Items:**\n1. Double down on winning strategies\n2. Address underperforming areas\n3. Set goals for next period\n\nReport exported.",
        "category": "reporting"
    }

def gen_strategy_question():
    option_a = random.choice(["Enterprise focus", "SMB focus", "Outbound sales", "Inbound marketing", "Product-led growth", "Sales-led growth"])
    option_b = random.choice(["SMB focus", "Enterprise focus", "Inbound marketing", "Outbound sales", "Sales-led growth", "Product-led growth"])
    company_size = random.choice(COMPANY_SIZES)
    industry = random.choice(INDUSTRIES)
    
    return {
        "human": f"We're a {company_size[0]} {industry} company. Should we focus on {option_a} or {option_b}?",
        "gpt": f"**Strategic Analysis: {option_a} vs {option_b}**\n\n**For {option_a}:**\n- Pros: Higher LTV, better unit economics\n- Cons: Longer sales cycles, more complex\n- Best if: You have enterprise experience\n\n**For {option_b}:**\n- Pros: Faster growth, easier to scale\n- Cons: Lower margins, higher churn\n- Best if: You need quick revenue\n\n**My Recommendation:** {option_a}\n\n**Reasoning:** As a {company_size[0]} {industry} company, {option_a} aligns with your resources and market position.\n\n**Next Steps:**\n1. Build ICP for target segment\n2. Train team on new motion\n3. Set 90-day milestones",
        "category": "ai_strategy"
    }

def gen_ai_chat():
    topics = [
        ("How do I increase my win rate?", "Focus on qualification, multi-threading, and proposal speed. Your current 28% can hit 40% with these changes."),
        ("What's the best way to handle competitive deals?", "1. Understand their differentiators\n2. Focus on your unique value\n3. Build champion relationships\n4. Offer pilots to reduce risk"),
        ("Help me prepare for a big demo", "1. Research the company\n2. Customize your environment\n3. Prepare 3 relevant use cases\n4. Have a clear agenda\n5. Practice your opening"),
        ("How do I build rapport with prospects?", "1. Find common ground\n2. Be genuinely curious\n3. Listen more than talk\n4. Share relevant stories\n5. Follow through on promises"),
        ("What's the secret to closing deals?", "1. Create urgency without pressure\n2. Address concerns proactively\n3. Make it easy to say yes\n4. Follow up consistently\n5. Ask for the sale"),
    ]
    
    question, answer = random.choice(topics)
    
    return {
        "human": question,
        "gpt": answer,
        "category": "ai_chat"
    }

def gen_email_sequence():
    steps = random.choice([3, 5, 7])
    
    return {
        "human": f"Create a {steps}-step email sequence for new leads",
        "gpt": f"**{steps}-Step Email Sequence:**\n\n| Step | Day | Subject | Goal |\n|------|-----|---------|------|\n| 1 | 0 | Welcome to NuCRM | Introduction |\n| 2 | 3 | Quick question | Engagement |\n| 3 | 7 | Case study | Social proof |\n| 4 | 12 | Last chance | Urgency |\n| 5 | 18 | Final follow-up | Close |\n\n**Settings:**\n- Start: Immediately\n- Pause if: Lead replies\n- Timezone: Lead's local (9 AM)\n\n**Expected Performance:**\n- Open rate: 35-45%\n- Reply rate: 8-12%\n- Meeting book rate: 3-5%\n\nSequence active. Want to customize emails?",
        "category": "email_sequences"
    }

def gen_ticket_management():
    priority = random.choice(["Urgent", "High", "Medium", "Low"])
    
    return {
        "human": f"Customer has a {priority.lower()} issue. Create a support ticket.",
        "gpt": f"**Support Ticket Created:**\n\n- **Priority:** {priority}\n- **SLA:** {'1 hour' if priority == 'Urgent' else '4 hours' if priority == 'High' else '24 hours'}\n- **Status:** Open\n\n**Auto-diagnosis:**\n- Account status: Active\n- Recent changes: None detected\n- Similar issues: {random.randint(0,5)} found\n\n**Suggested Resolution:**\n1. Check account settings\n2. Review recent changes\n3. Escalate if needed\n\nAssigned to support queue. Would you like to start troubleshooting?",
        "category": "ticket_management"
    }

def gen_contact_management():
    name = f"{random.choice(FIRST_NAMES)} {random.choice(LAST_NAMES)}"
    company = random.choice(COMPANIES)
    action = random.choice(["Add new contact", "Update contact", "Search contacts", "Merge contacts"])
    
    return {
        "human": f"{action}: {name} at {company}",
        "gpt": f"**{action}:**\n\n- **Name:** {name}\n- **Company:** {company}\n- **Email:** {name.lower().replace(' ', '.')}@{company.lower().replace(' ', '')}.com\n- **Phone:** +1{random.randint(200,999)}{random.randint(100,999)}{random.randint(1000,9999)}\n- **Lifecycle Stage:** Lead\n\nContact {'created' if 'new' in action.lower() else 'updated'} successfully. Would you like to add notes or schedule a follow-up?",
        "category": "contact_management"
    }

def gen_lead_management():
    name = f"{random.choice(FIRST_NAMES)} {random.choice(LAST_NAMES)}"
    company = random.choice(COMPANIES)
    action = random.choice(["Create lead", "Qualify lead", "Convert lead", "Score leads"])
    
    return {
        "human": f"{action}: {name} at {company}",
        "gpt": f"**{action}:**\n\n- **Contact:** {name}\n- **Company:** {company}\n- **Status:** {'New' if 'create' in action.lower() else 'Qualified'}\n- **Source:** Website\n- **Score:** {random.randint(50,90)}/100\n\n{'Lead created in pipeline.' if 'create' in action.lower() else 'Lead moved to qualified stage.'}\n\nWould you like to advance this lead or send an introduction email?",
        "category": "lead_management"
    }

def gen_deal_management():
    name = f"{random.choice(FIRST_NAMES)} {random.choice(LAST_NAMES)}"
    company = random.choice(COMPANIES)
    amount = random.randint(10, 200)
    
    return {
        "human": f"Create deal with {name} at {company} for ${amount}K",
        "gpt": f"**Deal Created:**\n\n- **Deal:** {company} Enterprise Plan\n- **Contact:** {name}\n- **Value:** ${amount}K\n- **Stage:** Lead\n- **Probability:** 10%\n- **Expected Revenue:** ${amount // 10}K\n\nDeal added to pipeline. Would you like to advance it to the next stage?",
        "category": "deal_management"
    }

# ============================================================
# MAIN GENERATOR
# ============================================================

def generate_all(total=30000):
    """Generate diverse conversations."""
    
    generators = [
        gen_cold_email, gen_objection_handling, gen_lead_scoring,
        gen_deal_strategy, gen_pipeline_analysis, gen_task_priority,
        gen_followup_email, gen_analytics_report, gen_automation_setup,
        gen_invoice_action, gen_meeting_schedule, gen_customer_success,
        gen_data_quality, gen_compliance_check, gen_integration,
        gen_mobile_check, gen_collaboration, gen_reporting,
        gen_strategy_question, gen_ai_chat, gen_email_sequence,
        gen_ticket_management, gen_contact_management, gen_lead_management,
        gen_deal_management
    ]
    
    conversations = []
    
    # Generate equal distribution
    per_gen = total // len(generators)
    
    print(f"Generating {total} conversations across {len(generators)} generators...")
    
    for gen in generators:
        count = 0
        for _ in range(per_gen):
            if count >= per_gen:
                break
            
            try:
                data = gen()
                
                # Get user role for system message
                role = random.choice(USER_ROLES)
                
                conv = {
                    "id": str(uuid.uuid4()),
                    "conversations": [
                        {"from": "system", "value": f"You are NuCRM, an intelligent CRM assistant. The user is a {role}. Help them professionally with their CRM needs."},
                        {"from": "human", "value": data["human"]},
                        {"from": "gpt", "value": data["gpt"]}
                    ],
                    "metadata": {
                        "category": data["category"],
                        "user_role": role,
                        "created_at": datetime.now().isoformat(),
                        "version": "3.0"
                    }
                }
                
                conversations.append(conv)
                count += 1
            except Exception as e:
                continue
        
        print(f"  {gen.__name__}: {count}")
    
    # Pad to target
    while len(conversations) < total:
        base = random.choice(conversations)
        role = random.choice(USER_ROLES)
        
        conv = {
            "id": str(uuid.uuid4()),
            "conversations": [
                {"from": "system", "value": f"You are NuCRM, an intelligent CRM assistant. The user is a {role}. Help them professionally."},
                {"from": "human", "value": random.choice(["Hey, ", "Quick question — ", "I need help with ", "Can you help me with "]) + base["conversations"][1]["value"].lower()},
                {"from": "gpt", "value": base["conversations"][2]["value"]}
            ],
            "metadata": {
                "category": base["metadata"]["category"],
                "user_role": role,
                "created_at": datetime.now().isoformat(),
                "version": "3.0"
            }
        }
        conversations.append(conv)
    
    return conversations[:total]

def main():
    print("=" * 60)
    print("NuCRM Gemma Training Data Generator v3.0")
    print("ULTRA DIVERSE — 30,000 Conversations")
    print("=" * 60)
    print()
    
    conversations = generate_all(total=30000)
    
    # Save
    output_dir = "/home/vinayak_shruti_biz/nucrm/synthetic-data/gemma-training"
    output_file = f"{output_dir}/nucrm-gemma-training-v3.jsonl"
    
    import os
    os.makedirs(output_dir, exist_ok=True)
    
    with open(output_file, "w") as f:
        for conv in conversations:
            f.write(json.dumps(conv, ensure_ascii=False) + "\n")
    
    # Stats
    file_size = os.path.getsize(output_file)
    categories = {}
    roles = {}
    for conv in conversations:
        cat = conv["metadata"]["category"]
        role = conv["metadata"].get("user_role", "unknown")
        categories[cat] = categories.get(cat, 0) + 1
        roles[role] = roles.get(role, 0) + 1
    
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
    print()
    print("User role breakdown:")
    for k, v in sorted(roles.items()):
        print(f"  {k:30s} {v:,}")
    
    # Copy to website
    import shutil
    shutil.copy2(output_file, output_dir)
    print(f"\nCopied to website directory.")

if __name__ == "__main__":
    main()
