#!/usr/bin/env python3
"""
NuCRM Synthetic Data Generator
Generates realistic CRM data for ML training.
Outputs: JSON (ndjson), CSV, SQL
"""

import json
import csv
import os
import random
import uuid
import hashlib
from datetime import datetime, timedelta
from pathlib import Path

# ═══════════════════════════════════════════════════════════════
# CONFIG
# ═══════════════════════════════════════════════════════════════

OUTPUT_DIR = Path("/home/vinayak_shruti_biz/nucrm/synthetic-data")
SEED = 42
random.seed(SEED)

# Scale
NUM_TENANTS = 5
NUM_USERS_PER_TENANT = 15
NUM_COMPANIES_PER_TENANT = 200
NUM_CONTACTS_PER_TENANT = 2000
NUM_LEADS_PER_TENANT = 1500
NUM_DEALS_PER_TENANT = 500
NUM_TASKS_PER_TENANT = 3000
NUM_TICKETS_PER_TENANT = 800
NUM_INVOICES_PER_TENANT = 600
NUM_MEETINGS_PER_TENANT = 400
NUM_NOTES_PER_TENANT = 5000
NUM_ACTIVITIES_PER_TENANT = 8000
NUM_FORMS_PER_TENANT = 20
NUM_PRODUCTS_PER_TENANT = 50
NUM_SERVICES_PER_TENANT = 30

# ═══════════════════════════════════════════════════════════════
# DATA POOLS
# ═══════════════════════════════════════════════════════════════

FIRST_NAMES = [
    "James","Mary","Robert","Patricia","John","Jennifer","Michael","Linda",
    "David","Elizabeth","William","Barbara","Richard","Susan","Joseph","Jessica",
    "Thomas","Sarah","Christopher","Karen","Charles","Lisa","Daniel","Nancy",
    "Matthew","Betty","Anthony","Margaret","Mark","Sandra","Donald","Ashley",
    "Steven","Kimberly","Paul","Emily","Andrew","Donna","Joshua","Michelle",
    "Kenneth","Dorothy","Kevin","Carol","Brian","Amanda","George","Melissa",
    "Timothy","Deborah","Ronald","Stephanie","Edward","Rebecca","Jason","Sharon",
    "Jeffrey","Laura","Ryan","Cynthia","Jacob","Kathleen","Gary","Amy",
    "Nicholas","Angela","Eric","Shirley","Jonathan","Anna","Stephen","Brenda",
    "Larry","Pamela","Justin","Emma","Scott","Nicole","Brandon","Helen",
    "Benjamin","Samantha","Samuel","Katherine","Raymond","Christine","Gregory","Debra",
    "Frank","Rachel","Alexander","Carolyn","Patrick","Janet","Jack","Catherine",
    "Dennis","Maria","Jerry","Heather","Tyler","Diane","Aaron","Ruth",
    "Jose","Julie","Adam","Olivia","Nathan","Joyce","Henry","Virginia",
    "Douglas","Victoria","Zachary","Kelly","Peter","Lauren","Kyle","Christina",
    "Noah","Joan","Ethan","Evelyn","Jeremy","Judith","Walter","Megan",
    "Christian","Andrea","Keith","Cheryl","Roger","Hannah","Terry","Jacqueline",
    "Austin","Martha","Sean","Gloria","Gerald","Teresa","Carl","Ann",
    "Harold","Sara","Dylan","Madison","Arthur","Frances","Lawrence","Kathryn",
    "Jordan","Janice","Jesse","Jean","Bryan","Abigail","Billy","Alice",
    "Bruce","Judy","Gabriel","Sophia","Joe","Grace","Logan","Denise",
    "Albert","Amber","Willie","Doris","Alan","Marilyn","Eugene","Danielle",
    "Russell","Beverly","Vincent","Isabella","Philip","Theresa","Bobby","Diana",
    "Johnny","Natalie","Bradley","Brittany","Roy","Charlotte","Elijah","Marie",
    "Randy","Kayla","Wayne","Alexis","Howard","Lori"
]

LAST_NAMES = [
    "Smith","Johnson","Williams","Brown","Jones","Garcia","Miller","Davis",
    "Rodriguez","Martinez","Hernandez","Lopez","Gonzalez","Wilson","Anderson",
    "Thomas","Taylor","Moore","Jackson","Martin","Lee","Perez","Thompson",
    "White","Harris","Sanchez","Clark","Ramirez","Lewis","Robinson","Walker",
    "Young","Allen","King","Wright","Scott","Torres","Nguyen","Hill",
    "Flores","Green","Adams","Nelson","Baker","Hall","Rivera","Campbell",
    "Mitchell","Carter","Roberts","Gomez","Phillips","Evans","Turner","Diaz",
    "Parker","Cruz","Edwards","Collins","Reyes","Stewart","Morris","Morales",
    "Murphy","Cook","Rogers","Gutierrez","Ortiz","Morgan","Cooper","Peterson",
    "Bailey","Reed","Kelly","Howard","Ramos","Kim","Cox","Ward",
    "Richardson","Watson","Brooks","Chavez","Wood","James","Bennett","Gray",
    "Mendoza","Ruiz","Hughes","Price","Alvarez","Castillo","Sanders","Patel",
    "Myers","Long","Ross","Foster","Jimenez","Powell","Jenkins","Perry",
    "Russell","Sullivan","Bell","Coleman","Butler","Henderson","Barnes","Gonzales",
    "Fisher","Vasquez","Simmons","Patterson","Jordan","Reynolds","Hamilton","Graham",
    "Wallace","Gibson","Bryant","Alexander","Tucker","Harvey","Marshall","Hunt",
    "Freeman","Webb","Burns","Spencer","Wagner","Hayes","Hart","Cole",
    "West","Ford","Mason","Griffin","Boyd","Rose","Black","Wallace",
    "Dixon","Stone","Sullivan","Fox","Warren","Mills","Kennedy","Stone",
    "Dean","Burr","Hansen","Frazier","Spencer","Lawson","Nichols","Carroll"
]

COMPANY_NAMES = [
    "TechNova Solutions","DataFlow Systems","CloudPeak Analytics","NexGen Software",
    "Quantum Dynamics","BlueShift Labs","IronClad Security","SilverLine Corp",
    "GreenField Capital","RedRock Ventures","Apex Innovations","Zenith Partners",
    "Pulse Digital","Forge Industries","Summit Analytics","Catalyst Group",
    "Velocity Labs","Atlas Computing","Prism Technologies","Vanguard Systems",
    "Horizon Media","Sterling Finance","Apex Health","NovaTech Solutions",
    "Fusion Analytics","ClearView Corp","EverGreen Solutions","BrightStar Inc",
    "SwiftScale","Nimbus Networks","Cobalt Systems","Amber Industries",
    "Coral Health","Ember Labs","Jade Consulting","Onyx Data",
    "Pearl Analytics","Ruby Software","Sapphire Tech","Topaz Digital",
    "Opal Solutions","Crystal Clear","Copper Systems","Platinum Partners",
    "Titan Industries","Steel Bridge","Iron Mountain","Bronze Gate",
    "Silver Stream","Golden Ratio","Diamond Edge","Crystal Corp"
]

INDUSTRIES = [
    "Technology","Healthcare","Finance","Education","Manufacturing",
    "Retail","Real Estate","Marketing","Legal","Consulting",
    "Energy","Transportation","Hospitality","Media","Telecommunications",
    "Agriculture","Construction","Insurance","Automotive","Aerospace"
]

CITIES = [
    "New York","Los Angeles","Chicago","Houston","Phoenix",
    "Philadelphia","San Antonio","San Diego","Dallas","San Jose",
    "Austin","Jacksonville","Fort Worth","Columbus","Charlotte",
    "Indianapolis","San Francisco","Seattle","Denver","Washington DC",
    "Nashville","Oklahoma City","El Paso","Boston","Portland",
    "Las Vegas","Memphis","Louisville","Baltimore","Milwaukee",
    "Albuquerque","Tucson","Fresno","Mesa","Sacramento",
    "Atlanta","Kansas City","Colorado Springs","Omaha","Raleigh",
    "Miami","Long Beach","Virginia Beach","Oakland","Minneapolis",
    "Tulsa","Tampa","Arlington","New Orleans","Wichita"
]

STATES = [
    "NY","CA","IL","TX","AZ","PA","TX","CA","TX","CA",
    "TX","FL","TX","OH","NC","IN","CA","WA","CO","DC",
    "TN","OK","TX","MA","OR","NV","TN","KY","MD","WI",
    "NM","AZ","CA","AZ","CA","GA","KS","CO","NE","NC",
    "FL","CA","VA","CA","MN","OK","FL","TX","LA","KS"
]

COUNTRIES = ["US","CA","GB","DE","FR","AU","IN","BR","JP","MX"]

JOB_TITLES = [
    "CEO","CTO","CFO","COO","VP Sales","VP Marketing","VP Engineering",
    "Director of Operations","Director of Sales","Director of Marketing",
    "Senior Manager","Manager","Team Lead","Senior Engineer","Engineer",
    "Software Developer","Data Analyst","Product Manager","Account Executive",
    "Account Manager","Sales Representative","Marketing Specialist",
    "Customer Success Manager","Support Engineer","HR Manager",
    "Finance Manager","Operations Manager","Business Analyst",
    "Project Manager","Executive Assistant","Administrative Assistant",
    "Consultant","Analyst","Coordinator","Specialist","Representative",
    "Technician","Designer","Architect","Strategist"
]

DEPARTMENTS = [
    "Engineering","Sales","Marketing","Finance","Human Resources",
    "Operations","Customer Success","Support","Legal","Product",
    "Design","Data Science","IT","Security","Administrative"
]

LEAD_SOURCES = [
    "website","referral","linkedin","cold_call","email_campaign",
    "trade_show","social_media","partner","organic_search","paid_ads",
    "webinar","content_marketing","word_of_mouth","demo_request","other"
]

LEAD_STATUSES = ["new","contacted","qualified","unqualified","converted","lost"]
CONTACT_STATUSES = ["new","contacted","qualified","proposal","negotiation","won","lost","archived","disqualified","unqualified","converted"]
LIFECYCLE_STAGES = ["subscriber","lead","marketing_qualified_lead","sales_qualified_lead","opportunity","customer","evangelist","churned"]
DEAL_STATUSES = ["open","won","lost"]
TICKET_STATUSES = ["open","in_progress","resolved","closed"]
TICKET_PRIORITIES = ["low","medium","high","urgent"]
TASK_STATUSES = ["pending","in_progress","completed","cancelled","deferred","on_hold"]
TASK_PRIORITIES = ["low","medium","high","urgent"]
INVOICE_STATUSES = ["draft","sent","viewed","paid","overdue","cancelled","partial"]
QUOTE_STATUSES = ["draft","sent","viewed","accepted","declined","expired","cancelled"]
MEETING_STATUSES = ["scheduled","completed","cancelled","no_show"]
FOLLOW_UP_STATUSES = ["pending","completed","missed"]

ACTIVITY_TYPES = [
    "email_sent","email_received","call_made","call_received",
    "meeting_scheduled","meeting_completed","note_added",
    "status_change","assignment_change","form_submission",
    "document_shared","task_created","task_completed"
]

PLAN_TYPES = ["free","starter","professional","enterprise"]

TAGS = [
    "vip","enterprise","startup","hot_lead","cold_lead","nurture",
    "at_risk","renewal","upsell","cross_sell","trial","demo",
    "webinar_attendee","content_downloader","pricing_page",
    "high_priority","low_priority","new_market","existing_customer",
    "referral_partner","churned","win_back","seasonal","bulk_order"
]

# ═══════════════════════════════════════════════════════════════
# UTILITIES
# ═══════════════════════════════════════════════════════════════

def gen_uuid():
    return str(uuid.uuid4())

def gen_email(first, last, domain=None):
    if not domain:
        domain = random.choice(["gmail.com","yahoo.com","outlook.com","hotmail.com","company.com","work.org"])
    sep = random.choice([".","_",""])
    num = random.choice(["",str(random.randint(1,99)),""])
    return f"{first.lower()}{sep}{last.lower()}{num}@{domain}"

def gen_phone():
    return f"+1{random.randint(2000000000,9999999999)}"

def gen_password_hash():
    return hashlib.sha256(gen_uuid().encode()).hexdigest()

def random_date(start, end):
    delta = end - start
    if delta.total_seconds() <= 0:
        return start
    random_days = random.randint(0, max(0, delta.days))
    random_seconds = random.randint(0, 86399)
    return start + timedelta(days=random_days, seconds=random_seconds)

def random_past_date(years_back=2):
    return random_date(
        datetime.now() - timedelta(days=years_back*365),
        datetime.now()
    )

def random_future_date(years_ahead=1):
    return random_date(
        datetime.now(),
        datetime.now() + timedelta(days=years_ahead*365)
    )

def random_amount(min_val, max_val):
    return round(random.uniform(min_val, max_val), 2)

def pick_tags(min_count=0, max_count=3):
    count = random.randint(min_count, max_count)
    return random.sample(TAGS, min(count, len(TAGS)))

def gen_oid(prefix, counter):
    return f"{prefix}-2026-{counter:06d}"

def sql_string(val):
    if val is None:
        return "NULL"
    return "'" + str(val).replace("'", "''") + "'"

def sql_array(arr):
    if not arr:
        return "'{}'"
    return "'{" + ",".join(arr) + "}'"

# ═══════════════════════════════════════════════════════════════
# GENERATORS
# ═══════════════════════════════════════════════════════════════

class SyntheticGenerator:
    def __init__(self):
        self.tenants = []
        self.users = []
        self.tenant_members = []
        self.companies = []
        self.contacts = []
        self.leads = []
        self.pipelines = []
        self.deal_stages = []
        self.deals = []
        self.tasks = []
        self.tickets = []
        self.ticket_replies = []
        self.invoices = []
        self.invoice_line_items = []
        self.meetings = []
        self.notes = []
        self.activities = []
        self.products = []
        self.services = []
        self.quotes = []
        self.quote_line_items = []
        self.forms = []
        self.form_submissions = []
        self.tags = []
        self.entity_tags = []
        self.follow_ups = []
        self.calls = []
        self.webhooks = []
        self.notifications = []

        self.user_counter = 0
        self.company_counter = 0
        self.contact_counter = 0
        self.lead_counter = 0
        self.deal_counter = 0
        self.invoice_counter = 0
        self.quote_counter = 0

    def generate_tenants(self):
        print("Generating tenants...")
        for i in range(NUM_TENANTS):
            tenant = {
                "id": gen_uuid(),
                "name": f"{random.choice(COMPANY_NAMES)} CRM",
                "slug": f"tenant-{i+1}",
                "short_code": f"T{i+1:03d}",
                "status": random.choice(["active","active","active","trialing"]),
                "plan_id": random.choice(PLAN_TYPES),
                "trial_ends_at": random_future_date(0.5).isoformat(),
                "primary_color": f"#{random.randint(0,0xFFFFFF):06x}",
                "billing_email": gen_email("billing","admin"),
                "industry": random.choice(INDUSTRIES),
                "company_size": random.choice(["1-10","11-50","51-200","201-500","500+"]),
                "country": random.choice(COUNTRIES),
                "current_users": 0,
                "current_contacts": 0,
                "current_deals": 0,
                "storage_used_bytes": random.randint(0, 10*1024*1024*1024),
                "billing_type": random.choice(["trial","subscription","manual"]),
                "created_at": random_past_date(1.5).isoformat(),
            }
            self.tenants.append(tenant)
        return self.tenants

    def generate_users(self):
        print("Generating users...")
        for tenant in self.tenants:
            for j in range(NUM_USERS_PER_TENANT):
                first = random.choice(FIRST_NAMES)
                last = random.choice(LAST_NAMES)
                user = {
                    "id": gen_uuid(),
                    "email": gen_email(first, last),
                    "password_hash": gen_password_hash(),
                    "full_name": f"{first} {last}",
                    "avatar_url": f"https://i.pravatar.cc/150?u={gen_uuid()[:8]}",
                    "phone": gen_phone(),
                    "timezone": random.choice(["UTC","US/Eastern","US/Central","US/Pacific","Europe/London","Europe/Berlin","Asia/Tokyo"]),
                    "is_super_admin": j == 0 and random.random() < 0.3,
                    "email_verified": random.random() > 0.1,
                    "locale": "en",
                    "theme": random.choice(["light","dark","system"]),
                    "created_at": random_past_date(1.5).isoformat(),
                    "_tenant_id": tenant["id"],
                }
                self.users.append(user)
                self.user_counter += 1
        return self.users

    def generate_tenant_members(self):
        print("Generating tenant members...")
        for user in self.users:
            member = {
                "id": gen_uuid(),
                "tenant_id": user["_tenant_id"],
                "user_id": user["id"],
                "role_slug": random.choice(["admin","admin","manager","member","member","member"]),
                "status": "active",
                "invited_at": user["created_at"],
                "joined_at": user["created_at"],
                "last_seen_at": random_past_date(0.1).isoformat(),
                "created_at": user["created_at"],
            }
            self.tenant_members.append(member)
        return self.tenant_members

    def generate_companies(self):
        print("Generating companies...")
        for tenant in self.tenants:
            tenant_users = [u for u in self.users if u["_tenant_id"] == tenant["id"]]
            for j in range(NUM_COMPANIES_PER_TENANT):
                name = f"{random.choice(COMPANY_NAMES)} {random.choice(['Inc','LLC','Corp','Ltd','Group','Partners','Co'])}"
                domain = name.lower().replace(" ","").replace(",","").replace("'","") + ".com"
                city = random.choice(CITIES)
                company = {
                    "id": gen_uuid(),
                    "tenant_id": tenant["id"],
                    "name": name,
                    "domain": domain,
                    "industry": random.choice(INDUSTRIES),
                    "company_size": random.choice(["1-10","11-50","51-200","201-500","500+","1000+"]),
                    "annual_revenue": random_amount(50000, 500000000),
                    "founded_year": random.randint(1980, 2025),
                    "headquarters": f"{city}, {random.choice(STATES)}",
                    "description": f"A leading company in the {random.choice(INDUSTRIES).lower()} sector.",
                    "website": f"https://{domain}",
                    "phone": gen_phone(),
                    "address": f"{random.randint(100,9999)} {random.choice(['Main','Oak','Pine','Elm','Cedar'])} {random.choice(['St','Ave','Blvd','Dr','Rd'])}",
                    "city": city,
                    "state": random.choice(STATES),
                    "country": random.choice(COUNTRIES),
                    "postal_code": f"{random.randint(10000,99999)}",
                    "timezone": random.choice(["UTC","US/Eastern","US/Central","US/Pacific"]),
                    "is_customer": random.random() < 0.3,
                    "tags": pick_tags(0, 3),
                    "created_at": random_past_date(1.5).isoformat(),
                    "created_by": random.choice(tenant_users)["id"] if tenant_users else None,
                    "_tenant_idx": self.tenants.index(tenant),
                }
                self.companies.append(company)
                self.company_counter += 1
        return self.companies

    def generate_contacts(self):
        print("Generating contacts...")
        for tenant in self.tenants:
            tenant_companies = [c for c in self.companies if c["tenant_id"] == tenant["id"]]
            tenant_users = [u for u in self.users if u["_tenant_id"] == tenant["id"]]
            for j in range(NUM_CONTACTS_PER_TENANT):
                first = random.choice(FIRST_NAMES)
                last = random.choice(LAST_NAMES)
                company = random.choice(tenant_companies) if random.random() < 0.7 else None
                contact = {
                    "id": gen_uuid(),
                    "tenant_id": tenant["id"],
                    "company_id": company["id"] if company else None,
                    "assigned_to": random.choice(tenant_users)["id"] if tenant_users else None,
                    "first_name": first,
                    "last_name": last,
                    "email": gen_email(first, last),
                    "secondary_email": gen_email(first, last) if random.random() < 0.2 else None,
                    "phone": gen_phone() if random.random() < 0.8 else None,
                    "mobile_phone": gen_phone() if random.random() < 0.4 else None,
                    "job_title": random.choice(JOB_TITLES) if random.random() < 0.7 else None,
                    "department": random.choice(DEPARTMENTS) if random.random() < 0.5 else None,
                    "address": f"{random.randint(100,9999)} {random.choice(['Main','Oak','Pine'])} {random.choice(['St','Ave','Blvd'])}" if random.random() < 0.6 else None,
                    "city": random.choice(CITIES) if random.random() < 0.7 else None,
                    "state": random.choice(STATES) if random.random() < 0.6 else None,
                    "country": random.choice(COUNTRIES),
                    "postal_code": f"{random.randint(10000,99999)}" if random.random() < 0.5 else None,
                    "timezone": random.choice(["UTC","US/Eastern","US/Central","US/Pacific"]),
                    "birthday": random_date(datetime(1960,1,1), datetime(2000,12,31)).date().isoformat() if random.random() < 0.3 else None,
                    "lead_source": random.choice(LEAD_SOURCES),
                    "lead_status": random.choice(LEAD_STATUSES),
                    "lifecycle_stage": random.choice(LIFECYCLE_STAGES),
                    "score": random.randint(0, 100),
                    "do_not_contact": random.random() < 0.05,
                    "unsubscribed": random.random() < 0.03,
                    "is_archived": random.random() < 0.02,
                    "is_customer": random.random() < 0.25,
                    "tags": pick_tags(0, 4),
                    "times_contacted": random.randint(0, 50),
                    "linkedin_url": f"https://linkedin.com/in/{first.lower()}-{last.lower()}" if random.random() < 0.3 else None,
                    "created_at": random_past_date(1.5).isoformat(),
                    "created_by": random.choice(tenant_users)["id"] if tenant_users else None,
                    "_tenant_idx": self.tenants.index(tenant),
                }
                self.contacts.append(contact)
                self.contact_counter += 1
        return self.contacts

    def generate_leads(self):
        print("Generating leads...")
        for tenant in self.tenants:
            tenant_companies = [c for c in self.companies if c["tenant_id"] == tenant["id"]]
            tenant_users = [u for u in self.users if u["_tenant_id"] == tenant["id"]]
            for j in range(NUM_LEADS_PER_TENANT):
                first = random.choice(FIRST_NAMES)
                last = random.choice(LAST_NAMES)
                status = random.choice(LEAD_STATUSES)
                is_converted = status == "converted"
                company = random.choice(tenant_companies) if random.random() < 0.5 else None
                lead = {
                    "id": gen_uuid(),
                    "tenant_id": tenant["id"],
                    "first_name": first,
                    "last_name": last,
                    "full_name": f"{first} {last}",
                    "email": gen_email(first, last),
                    "phone": gen_phone() if random.random() < 0.6 else None,
                    "company_name": company["name"] if company else f"{random.choice(COMPANY_NAMES)} {random.choice(['Inc','LLC','Corp'])}",
                    "lead_source": random.choice(LEAD_SOURCES),
                    "lead_status": status,
                    "score": random.randint(0, 100),
                    "value": random_amount(500, 500000),
                    "budget": random_amount(1000, 1000000) if random.random() < 0.4 else None,
                    "assigned_to": random.choice(tenant_users)["id"] if tenant_users else None,
                    "owner_id": random.choice(tenant_users)["id"] if tenant_users else None,
                    "company_id": company["id"] if company else None,
                    "title": random.choice(JOB_TITLES) if random.random() < 0.5 else None,
                    "website": f"https://{random.choice(COMPANY_NAMES).lower().replace(' ','')}.com" if random.random() < 0.3 else None,
                    "city": random.choice(CITIES) if random.random() < 0.5 else None,
                    "state": random.choice(STATES) if random.random() < 0.4 else None,
                    "country": random.choice(COUNTRIES),
                    "company_size": random.choice(["1-10","11-50","51-200","201-500","500+"]),
                    "company_industry": random.choice(INDUSTRIES),
                    "lifecycle_stage": "lead",
                    "budget_currency": "USD",
                    "authority_level": random.choice(["decision_maker","influencer","gatekeeper","unknown"]),
                    "need_description": random.choice([
                        "Looking to upgrade their CRM system",
                        "Need better sales tracking",
                        "Want to automate marketing",
                        "Seeking enterprise solution",
                        "Small business growth",
                        "Team collaboration tools",
                        "Data analytics platform",
                        "Customer support system"
                    ]) if random.random() < 0.4 else None,
                    "timeline": random.choice(["immediate","1-3_months","3-6_months","6-12_months","exploring"]),
                    "utm_source": random.choice(["google","facebook","linkedin","twitter","email"]) if random.random() < 0.3 else None,
                    "utm_medium": random.choice(["cpc","social","email","organic"]) if random.random() < 0.3 else None,
                    "tags": pick_tags(0, 3),
                    "is_archived": random.random() < 0.05,
                    "is_converted": is_converted,
                    "converted_at": random_past_date(0.5).isoformat() if is_converted else None,
                    "lead_oid": gen_oid("LD", self.lead_counter + 1),
                    "created_at": random_past_date(1.5).isoformat(),
                    "created_by": random.choice(tenant_users)["id"] if tenant_users else None,
                    "_tenant_idx": self.tenants.index(tenant),
                }
                self.leads.append(lead)
                self.lead_counter += 1
        return self.leads

    def generate_pipelines_and_stages(self):
        print("Generating pipelines and stages...")
        stage_names = ["Prospecting","Qualification","Proposal","Negotiation","Closed Won","Closed Lost"]
        for tenant in self.tenants:
            pipeline = {
                "id": gen_uuid(),
                "tenant_id": tenant["id"],
                "name": "Sales Pipeline",
                "description": "Main sales pipeline",
                "is_default": True,
                "created_at": random_past_date(1.5).isoformat(),
            }
            self.pipelines.append(pipeline)
            for idx, name in enumerate(stage_names):
                stage = {
                    "id": gen_uuid(),
                    "tenant_id": tenant["id"],
                    "pipeline_id": pipeline["id"],
                    "name": name,
                    "order": idx,
                    "created_at": pipeline["created_at"],
                }
                self.deal_stages.append(stage)
        return self.pipelines, self.deal_stages

    def generate_deals(self):
        print("Generating deals...")
        for tenant in self.tenants:
            tenant_contacts = [c for c in self.contacts if c["tenant_id"] == tenant["id"]]
            tenant_companies = [c for c in self.companies if c["tenant_id"] == tenant["id"]]
            tenant_users = [u for u in self.users if u["_tenant_id"] == tenant["id"]]
            tenant_stages = [s for s in self.deal_stages if s["tenant_id"] == tenant["id"]]
            tenant_pipelines = [p for p in self.pipelines if p["tenant_id"] == tenant["id"]]

            for j in range(NUM_DEALS_PER_TENANT):
                stage = random.choice(tenant_stages)
                stage_name = stage["name"]
                status = "won" if stage_name == "Closed Won" else ("lost" if stage_name == "Closed Lost" else "open")
                contact = random.choice(tenant_contacts) if random.random() < 0.7 else None
                company = random.choice(tenant_companies) if random.random() < 0.5 else None
                amount = random_amount(1000, 500000)
                created = random_past_date(1)
                deal = {
                    "id": gen_uuid(),
                    "tenant_id": tenant["id"],
                    "contact_id": contact["id"] if contact else None,
                    "company_id": company["id"] if company else None,
                    "pipeline_id": random.choice(tenant_pipelines)["id"],
                    "stage_id": stage["id"],
                    "stage_entered_at": random_date(created, datetime.now()).isoformat(),
                    "title": f"{random.choice(['Enterprise','Growth','Starter','Premium','Custom'])} Deal - {random.choice(COMPANY_NAMES)}",
                    "amount": amount,
                    "close_date": random_future_date(0.5).isoformat() if status == "open" else random_past_date(0.3).isoformat(),
                    "assigned_to": random.choice(tenant_users)["id"] if tenant_users else None,
                    "created_at": created.isoformat(),
                    "created_by": random.choice(tenant_users)["id"] if tenant_users else None,
                    "_tenant_idx": self.tenants.index(tenant),
                }
                self.deals.append(deal)
                self.deal_counter += 1
        return self.deals

    def generate_tasks(self):
        print("Generating tasks...")
        task_titles = [
            "Follow up with lead","Send proposal","Schedule demo",
            "Update CRM records","Review contract","Prepare presentation",
            "Call back customer","Send invoice","Process payment",
            "Update pipeline","Review analytics","Team meeting prep",
            "Onboard new client","Training session","Product demo",
            "Security audit","Performance review","Budget planning",
            "Marketing campaign","Content creation","Social media post",
            "Email newsletter","Blog article","Webinar prep",
            "Customer survey","Feedback collection","Quality check"
        ]
        for tenant in self.tenants:
            tenant_users = [u for u in self.users if u["_tenant_id"] == tenant["id"]]
            tenant_contacts = [c for c in self.contacts if c["tenant_id"] == tenant["id"]]
            tenant_deals = [d for d in self.deals if d["tenant_id"] == tenant["id"]]
            for j in range(NUM_TASKS_PER_TENANT):
                status = random.choice(TASK_STATUSES)
                completed = status == "completed"
                task = {
                    "id": gen_uuid(),
                    "tenant_id": tenant["id"],
                    "title": random.choice(task_titles),
                    "description": f"Task description for {random.choice(task_titles).lower()}",
                    "priority": random.choice(TASK_PRIORITIES),
                    "status": status,
                    "due_date": random_future_date(0.5).isoformat() if not completed else None,
                    "completed": completed,
                    "completed_at": random_past_date(0.3).isoformat() if completed else None,
                    "contact_id": random.choice(tenant_contacts)["id"] if random.random() < 0.4 and tenant_contacts else None,
                    "deal_id": random.choice(tenant_deals)["id"] if random.random() < 0.3 and tenant_deals else None,
                    "assigned_to": random.choice(tenant_users)["id"] if tenant_users else None,
                    "created_at": random_past_date(1).isoformat(),
                    "created_by": random.choice(tenant_users)["id"] if tenant_users else None,
                }
                self.tasks.append(task)
        return self.tasks

    def generate_tickets(self):
        print("Generating tickets...")
        ticket_subjects = [
            "Login issue","Payment failed","Feature request","Bug report",
            "Account access","Data export","Integration problem","Performance issue",
            "Security concern","Billing question","Cancellation request","Upgrade inquiry",
            "API error","Sync failure","Missing data","Duplicate records",
            "Permission denied","Email not sending","Report wrong","Dashboard slow"
        ]
        for tenant in self.tenants:
            tenant_contacts = [c for c in self.contacts if c["tenant_id"] == tenant["id"]]
            tenant_companies = [c for c in self.companies if c["tenant_id"] == tenant["id"]]
            tenant_users = [u for u in self.users if u["_tenant_id"] == tenant["id"]]
            for j in range(NUM_TICKETS_PER_TENANT):
                status = random.choice(TICKET_STATUSES)
                ticket = {
                    "id": gen_uuid(),
                    "tenant_id": tenant["id"],
                    "contact_id": random.choice(tenant_contacts)["id"] if random.random() < 0.6 and tenant_contacts else None,
                    "company_id": random.choice(tenant_companies)["id"] if random.random() < 0.3 and tenant_companies else None,
                    "subject": random.choice(ticket_subjects),
                    "body": f"Issue description: {random.choice(ticket_subjects).lower()}. Need assistance with this matter.",
                    "status": status,
                    "priority": random.choice(TICKET_PRIORITIES),
                    "category": random.choice(["general","technical","billing","feature_request","bug"]),
                    "assigned_to": random.choice(tenant_users)["id"] if random.random() < 0.7 and tenant_users else None,
                    "first_response_at": random_past_date(0.5).isoformat() if status != "open" else None,
                    "resolved_at": random_past_date(0.3).isoformat() if status in ["resolved","closed"] else None,
                    "created_at": random_past_date(1).isoformat(),
                    "created_by": random.choice(tenant_users)["id"] if tenant_users else None,
                }
                self.tickets.append(ticket)
        return self.tickets

    def generate_invoices(self):
        print("Generating invoices...")
        for tenant in self.tenants:
            tenant_contacts = [c for c in self.contacts if c["tenant_id"] == tenant["id"]]
            tenant_companies = [c for c in self.companies if c["tenant_id"] == tenant["id"]]
            tenant_deals = [d for d in self.deals if d["tenant_id"] == tenant["id"]]
            for j in range(NUM_INVOICES_PER_TENANT):
                self.invoice_counter += 1
                status = random.choice(INVOICE_STATUSES)
                subtotal = random_amount(100, 100000)
                tax_rate = random.choice([0, 5, 7.5, 8, 10, 15, 20])
                tax_amount = round(subtotal * tax_rate / 100, 2)
                total = round(subtotal + tax_amount, 2)
                contact = random.choice(tenant_contacts) if random.random() < 0.6 else None
                invoice = {
                    "id": gen_uuid(),
                    "tenant_id": tenant["id"],
                    "contact_id": contact["id"] if contact else None,
                    "company_id": random.choice(tenant_companies)["id"] if random.random() < 0.4 and tenant_companies else None,
                    "invoice_number": f"INV-{self.invoice_counter:06d}",
                    "title": f"Invoice for {random.choice(['Services','Products','Subscription','Consulting','Support'])}",
                    "status": status,
                    "issue_date": random_past_date(1).date().isoformat(),
                    "due_date": random_future_date(0.5).date().isoformat(),
                    "sent_at": random_past_date(0.5).isoformat() if status != "draft" else None,
                    "paid_at": random_past_date(0.3).isoformat() if status == "paid" else None,
                    "subtotal": subtotal,
                    "tax_rate": tax_rate,
                    "tax_amount": tax_amount,
                    "total_amount": total,
                    "amount_paid": total if status == "paid" else (total * 0.5 if status == "partial" else 0),
                    "balance_due": 0 if status == "paid" else (total * 0.5 if status == "partial" else total),
                    "currency": "USD",
                    "notes": "Thank you for your business!" if random.random() < 0.5 else None,
                    "deal_id": random.choice(tenant_deals)["id"] if random.random() < 0.2 and tenant_deals else None,
                    "created_at": random_past_date(1).isoformat(),
                    "created_by": None,
                }
                self.invoices.append(invoice)
        return self.invoices

    def generate_meetings(self):
        print("Generating meetings...")
        meeting_titles = [
            "Product Demo","Sales Call","Quarterly Review","Onboarding Session",
            "Strategy Meeting","Training Workshop","Client Check-in","Project Update",
            "Board Meeting","Team Standup","Budget Review","Performance Review",
            "Partnership Discussion","Contract Negotiation","Support Call"
        ]
        for tenant in self.tenants:
            tenant_contacts = [c for c in self.contacts if c["tenant_id"] == tenant["id"]]
            tenant_deals = [d for d in self.deals if d["tenant_id"] == tenant["id"]]
            tenant_users = [u for u in self.users if u["_tenant_id"] == tenant["id"]]
            for j in range(NUM_MEETINGS_PER_TENANT):
                start = random_date(datetime.now() - timedelta(days=90), datetime.now() + timedelta(days=90))
                duration = random.choice([15,30,45,60,90,120])
                meeting = {
                    "id": gen_uuid(),
                    "tenant_id": tenant["id"],
                    "user_id": random.choice(tenant_users)["id"] if tenant_users else None,
                    "contact_id": random.choice(tenant_contacts)["id"] if random.random() < 0.5 and tenant_contacts else None,
                    "deal_id": random.choice(tenant_deals)["id"] if random.random() < 0.3 and tenant_deals else None,
                    "title": random.choice(meeting_titles),
                    "description": f"Meeting about {random.choice(meeting_titles).lower()}",
                    "start_time": start.isoformat(),
                    "end_time": (start + timedelta(minutes=duration)).isoformat(),
                    "location": random.choice(["Zoom","Google Meet","In Person","Teams","Phone"]) if random.random() < 0.8 else None,
                    "status": random.choice(MEETING_STATUSES),
                    "created_at": random_past_date(1).isoformat(),
                    "created_by": random.choice(tenant_users)["id"] if tenant_users else None,
                }
                self.meetings.append(meeting)
        return self.meetings

    def generate_notes(self):
        print("Generating notes...")
        note_contents = [
            "Discussed pricing options with client","Follow-up needed after demo",
            "Client interested in enterprise plan","Sent proposal via email",
            "Call scheduled for next week","Client has budget constraints",
            "Decision maker is VP of Sales","Need to involve technical team",
            "Client comparing with competitor","Contract renewal in Q2",
            "Strong interest in API integration","Client needs custom reporting",
            "Budget approved for Q3","Stakeholder meeting went well",
            "Client requested case studies","Technical requirements documented"
        ]
        for tenant in self.tenants:
            tenant_contacts = [c for c in self.contacts if c["tenant_id"] == tenant["id"]]
            tenant_deals = [d for d in self.deals if d["tenant_id"] == tenant["id"]]
            tenant_companies = [c for c in self.companies if c["tenant_id"] == tenant["id"]]
            tenant_users = [u for u in self.users if u["_tenant_id"] == tenant["id"]]
            for j in range(NUM_NOTES_PER_TENANT):
                entity_type = random.choice(["contact","deal","company"])
                note = {
                    "id": gen_uuid(),
                    "tenant_id": tenant["id"],
                    "entity_type": entity_type,
                    "entity_id": (
                        random.choice(tenant_contacts)["id"] if entity_type == "contact" and tenant_contacts else
                        random.choice(tenant_deals)["id"] if entity_type == "deal" and tenant_deals else
                        random.choice(tenant_companies)["id"] if tenant_companies else None
                    ),
                    "content": random.choice(note_contents),
                    "created_at": random_past_date(1).isoformat(),
                    "created_by": random.choice(tenant_users)["id"] if tenant_users else None,
                }
                self.notes.append(note)
        return self.notes

    def generate_activities(self):
        print("Generating activities...")
        activity_descriptions = [
            "Sent email to client","Received email from client",
            "Made phone call","Received phone call",
            "Scheduled meeting","Completed meeting",
            "Updated deal stage","Created new task",
            "Uploaded document","Changed contact status",
            "Added note","Assigned lead",
            "Created invoice","Sent quote",
            "Logged support ticket","Resolved ticket"
        ]
        for tenant in self.tenants:
            tenant_contacts = [c for c in self.contacts if c["tenant_id"] == tenant["id"]]
            tenant_leads = [l for l in self.leads if l["tenant_id"] == tenant["id"]]
            tenant_deals = [d for d in self.deals if d["tenant_id"] == tenant["id"]]
            tenant_users = [u for u in self.users if u["_tenant_id"] == tenant["id"]]
            for j in range(NUM_ACTIVITIES_PER_TENANT):
                entity_type = random.choice(["contact","lead","deal"])
                activity = {
                    "id": gen_uuid(),
                    "tenant_id": tenant["id"],
                    "entity_type": entity_type,
                    "entity_id": (
                        random.choice(tenant_contacts)["id"] if entity_type == "contact" and tenant_contacts else
                        random.choice(tenant_leads)["id"] if entity_type == "lead" and tenant_leads else
                        random.choice(tenant_deals)["id"] if tenant_deals else None
                    ),
                    "activity_type": random.choice(ACTIVITY_TYPES),
                    "description": random.choice(activity_descriptions),
                    "performed_at": random_past_date(1).isoformat(),
                    "performed_by": random.choice(tenant_users)["id"] if tenant_users else None,
                    "created_at": random_past_date(1).isoformat(),
                    "created_by": random.choice(tenant_users)["id"] if tenant_users else None,
                }
                self.activities.append(activity)
        return self.activities

    def generate_products(self):
        print("Generating products...")
        product_names = [
            "CRM Pro License","Analytics Dashboard","Email Marketing Suite",
            "API Access Premium","Storage Upgrade","Priority Support",
            "Custom Integration","Training Package","Consulting Hours",
            "Data Migration Service","Security Audit","Performance Optimization",
            "Mobile App License","White Label Solution","Multi-tenant License",
            "Advanced Reporting","Workflow Automation","AI Assistant",
            "Lead Scoring Engine","Pipeline Analytics"
        ]
        for tenant in self.tenants:
            tenant_users = [u for u in self.users if u["_tenant_id"] == tenant["id"]]
            for j in range(NUM_PRODUCTS_PER_TENANT):
                product = {
                    "id": gen_uuid(),
                    "tenant_id": tenant["id"],
                    "name": f"{random.choice(product_names)} v{random.randint(1,5)}.{random.randint(0,9)}",
                    "description": f"Premium {random.choice(product_names).lower()} for enterprise teams",
                    "sku": f"SKU-{random.randint(1000,9999)}",
                    "base_price": random_amount(29, 9999),
                    "created_at": random_past_date(1).isoformat(),
                    "created_by": random.choice(tenant_users)["id"] if tenant_users else None,
                }
                self.products.append(product)
        return self.products

    def generate_services(self):
        print("Generating services...")
        service_names = [
            "CRM Implementation","Data Migration","Custom Development",
            "Training Workshop","Strategy Consulting","Technical Support",
            "Security Audit","Performance Review","Integration Setup",
            "Workflow Optimization","Analytics Setup","Email Campaign Management",
            "Lead Generation","Content Creation","SEO Optimization"
        ]
        for tenant in self.tenants:
            tenant_contacts = [c for c in self.contacts if c["tenant_id"] == tenant["id"]]
            tenant_users = [u for u in self.users if u["_tenant_id"] == tenant["id"]]
            for j in range(NUM_SERVICES_PER_TENANT):
                pricing = random.choice(["fixed","hourly","monthly","project"])
                service = {
                    "id": gen_uuid(),
                    "tenant_id": tenant["id"],
                    "contact_id": random.choice(tenant_contacts)["id"] if random.random() < 0.3 and tenant_contacts else None,
                    "name": random.choice(service_names),
                    "description": f"Professional {random.choice(service_names).lower()} service",
                    "category": random.choice(["consulting","implementation","support","training","development"]),
                    "pricing_type": pricing,
                    "unit_price": random_amount(50, 500) if pricing == "fixed" else None,
                    "hourly_rate": random_amount(100, 300) if pricing == "hourly" else None,
                    "monthly_price": random_amount(500, 5000) if pricing == "monthly" else None,
                    "tax_rate": random.choice([0, 5, 10]),
                    "taxable": random.random() > 0.2,
                    "currency": "USD",
                    "is_active": random.random() > 0.1,
                    "times_used": random.randint(0, 100),
                    "total_revenue": random_amount(0, 50000),
                    "tags": pick_tags(0, 2),
                    "created_at": random_past_date(1).isoformat(),
                    "created_by": random.choice(tenant_users)["id"] if tenant_users else None,
                }
                self.services.append(service)
        return self.services

    def generate_follow_ups(self):
        print("Generating follow-ups...")
        for tenant in self.tenants:
            tenant_leads = [l for l in self.leads if l["tenant_id"] == tenant["id"]]
            tenant_contacts = [c for c in self.contacts if c["tenant_id"] == tenant["id"]]
            tenant_deals = [d for d in self.deals if d["tenant_id"] == tenant["id"]]
            tenant_users = [u for u in self.users if u["_tenant_id"] == tenant["id"]]
            count = min(1000, len(tenant_leads) + len(tenant_contacts))
            for j in range(count):
                status = random.choice(FOLLOW_UP_STATUSES)
                entity = random.choice(["lead","contact","deal"])
                fu = {
                    "id": gen_uuid(),
                    "tenant_id": tenant["id"],
                    "lead_id": random.choice(tenant_leads)["id"] if entity == "lead" and tenant_leads else None,
                    "contact_id": random.choice(tenant_contacts)["id"] if entity == "contact" and tenant_contacts else None,
                    "deal_id": random.choice(tenant_deals)["id"] if entity == "deal" and tenant_deals else None,
                    "assigned_to": random.choice(tenant_users)["id"] if tenant_users else None,
                    "title": random.choice(["Follow up call","Send proposal","Check-in email","Schedule demo","Review contract"]),
                    "description": "Follow up with the client regarding their inquiry",
                    "due_date": random_future_date(0.3).isoformat(),
                    "status": status,
                    "completed_at": random_past_date(0.3).isoformat() if status == "completed" else None,
                    "created_at": random_past_date(1).isoformat(),
                    "created_by": random.choice(tenant_users)["id"] if tenant_users else None,
                }
                self.follow_ups.append(fu)
        return self.follow_ups

    def generate_forms(self):
        print("Generating forms...")
        form_names = [
            "Contact Us","Demo Request","Newsletter Signup","Support Request",
            "Feedback Form","Survey","Event Registration","Webinar Signup",
            "Partnership Inquiry","Career Application","Bug Report","Feature Request"
        ]
        for tenant in self.tenants:
            tenant_users = [u for u in self.users if u["_tenant_id"] == tenant["id"]]
            for j in range(NUM_FORMS_PER_TENANT):
                form = {
                    "id": gen_uuid(),
                    "tenant_id": tenant["id"],
                    "name": random.choice(form_names),
                    "slug": f"form-{uuid.uuid4().hex[:8]}",
                    "title": random.choice(form_names),
                    "description": f"Form for {random.choice(form_names).lower()}",
                    "fields": json.dumps([
                        {"name":"first_name","type":"text","required":True},
                        {"name":"last_name","type":"text","required":True},
                        {"name":"email","type":"email","required":True},
                        {"name":"message","type":"textarea","required":False}
                    ]),
                    "is_active": random.random() > 0.2,
                    "submissions_count": random.randint(0, 500),
                    "views_count": random.randint(100, 5000),
                    "created_at": random_past_date(1).isoformat(),
                    "created_by": random.choice(tenant_users)["id"] if tenant_users else None,
                }
                self.forms.append(form)
        return self.forms

    def generate_tags(self):
        print("Generating tags...")
        for tenant in self.tenants:
            for tag_name in TAGS:
                tag = {
                    "id": gen_uuid(),
                    "tenant_id": tenant["id"],
                    "name": tag_name,
                    "color": f"#{random.randint(0,0xFFFFFF):06x}",
                    "created_at": random_past_date(1).isoformat(),
                }
                self.tags.append(tag)
        return self.tags

    def generate_notifications(self):
        print("Generating notifications...")
        notif_titles = [
            "New lead assigned","Deal stage changed","Task overdue",
            "Invoice paid","Ticket created","Meeting reminder",
            "Campaign completed","New form submission","Payment received",
            "Team member joined","System update available","Storage warning"
        ]
        for tenant in self.tenants:
            tenant_users = [u for u in self.users if u["_tenant_id"] == tenant["id"]]
            for user in tenant_users[:5]:
                for j in range(random.randint(5, 20)):
                    notif = {
                        "id": gen_uuid(),
                        "tenant_id": tenant["id"],
                        "user_id": user["id"],
                        "title": random.choice(notif_titles),
                        "body": f"You have a new notification about {random.choice(notif_titles).lower()}",
                        "type": random.choice(["info","success","warning","error"]),
                        "read_at": random_past_date(0.3).isoformat() if random.random() < 0.6 else None,
                        "created_at": random_past_date(0.5).isoformat(),
                    }
                    self.notifications.append(notif)
        return self.notifications

    # ═══════════════════════════════════════════════════════════════
    # EXPORTERS
    # ═══════════════════════════════════════════════════════════════

    def export_json(self):
        print("Exporting JSON...")
        json_dir = OUTPUT_DIR / "json"
        json_dir.mkdir(parents=True, exist_ok=True)

        datasets = {
            "tenants": self.tenants,
            "users": self.users,
            "tenant_members": self.tenant_members,
            "companies": self.companies,
            "contacts": self.contacts,
            "leads": self.leads,
            "pipelines": self.pipelines,
            "deal_stages": self.deal_stages,
            "deals": self.deals,
            "tasks": self.tasks,
            "tickets": self.tickets,
            "invoices": self.invoices,
            "meetings": self.meetings,
            "notes": self.notes,
            "activities": self.activities,
            "products": self.products,
            "services": self.services,
            "follow_ups": self.follow_ups,
            "forms": self.forms,
            "tags": self.tags,
            "notifications": self.notifications,
        }

        total = 0
        for name, data in datasets.items():
            filepath = json_dir / f"{name}.jsonl"
            with open(filepath, "w") as f:
                for record in data:
                    f.write(json.dumps(record) + "\n")
            total += len(data)
            print(f"  {name}: {len(data)} records")

        print(f"Total JSON records: {total}")
        return total

    def export_csv(self):
        print("Exporting CSV...")
        csv_dir = OUTPUT_DIR / "csv"
        csv_dir.mkdir(parents=True, exist_ok=True)

        datasets = {
            "tenants": self.tenants,
            "users": self.users,
            "tenant_members": self.tenant_members,
            "companies": self.companies,
            "contacts": self.contacts,
            "leads": self.leads,
            "deals": self.deals,
            "tasks": self.tasks,
            "tickets": self.tickets,
            "invoices": self.invoices,
            "meetings": self.meetings,
            "notes": self.notes,
            "products": self.products,
            "services": self.services,
        }

        for name, data in datasets.items():
            if not data:
                continue
            filepath = csv_dir / f"{name}.csv"
            keys = [k for k in data[0].keys() if not k.startswith("_")]
            with open(filepath, "w", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=keys, extrasaction="ignore")
                writer.writeheader()
                for record in data:
                    writer.writerow({k: v for k, v in record.items() if not k.startswith("_")})
            print(f"  {name}: {len(data)} rows")

    def export_sql(self):
        print("Exporting SQL...")
        sql_dir = OUTPUT_DIR / "sql"
        sql_dir.mkdir(parents=True, exist_ok=True)

        with open(sql_dir / "001_core.sql", "w") as f:
            f.write("-- NuCRM Synthetic Data - Core Tables\n\n")

            # Tenants
            f.write("DELETE FROM tenants;\n")
            for t in self.tenants:
                f.write(f"INSERT INTO tenants (id, name, slug, short_code, status, plan_id, industry, company_size, country, billing_email, current_users, current_contacts, current_deals, created_at) VALUES ({sql_string(t['id'])}, {sql_string(t['name'])}, {sql_string(t['slug'])}, {sql_string(t['short_code'])}, {sql_string(t['status'])}, {sql_string(t['plan_id'])}, {sql_string(t['industry'])}, {sql_string(t['company_size'])}, {sql_string(t['country'])}, {sql_string(t['billing_email'])}, {t['current_users']}, {t['current_contacts']}, {t['current_deals']}, {sql_string(t['created_at'])});\n")

            # Users
            f.write("\nDELETE FROM users;\n")
            for u in self.users:
                f.write(f"INSERT INTO users (id, email, password_hash, full_name, phone, timezone, email_verified, created_at) VALUES ({sql_string(u['id'])}, {sql_string(u['email'])}, {sql_string(u['password_hash'])}, {sql_string(u['full_name'])}, {sql_string(u['phone'])}, {sql_string(u['timezone'])}, {u['email_verified']}, {sql_string(u['created_at'])});\n")

            # Tenant Members
            f.write("\nDELETE FROM tenant_members;\n")
            for m in self.tenant_members:
                f.write(f"INSERT INTO tenant_members (id, tenant_id, user_id, role_slug, status, created_at) VALUES ({sql_string(m['id'])}, {sql_string(m['tenant_id'])}, {sql_string(m['user_id'])}, {sql_string(m['role_slug'])}, {sql_string(m['status'])}, {sql_string(m['created_at'])});\n")

        with open(sql_dir / "002_crm.sql", "w") as f:
            f.write("-- NuCRM Synthetic Data - CRM Tables\n\n")

            # Companies
            f.write("DELETE FROM companies;\n")
            for c in self.companies:
                f.write(f"INSERT INTO companies (id, tenant_id, name, domain, industry, company_size, annual_revenue, website, phone, city, state, country, is_customer, created_at, created_by) VALUES ({sql_string(c['id'])}, {sql_string(c['tenant_id'])}, {sql_string(c['name'])}, {sql_string(c['domain'])}, {sql_string(c['industry'])}, {sql_string(c['company_size'])}, {c['annual_revenue']}, {sql_string(c['website'])}, {sql_string(c['phone'])}, {sql_string(c['city'])}, {sql_string(c['state'])}, {sql_string(c['country'])}, {c['is_customer']}, {sql_string(c['created_at'])}, {sql_string(c['created_by'])});\n")

            # Contacts
            f.write("\nDELETE FROM contacts;\n")
            for c in self.contacts:
                f.write(f"INSERT INTO contacts (id, tenant_id, company_id, assigned_to, first_name, last_name, email, phone, job_title, department, city, state, country, lead_source, lead_status, lifecycle_stage, score, is_customer, tags, times_contacted, created_at, created_by) VALUES ({sql_string(c['id'])}, {sql_string(c['tenant_id'])}, {sql_string(c['company_id'])}, {sql_string(c['assigned_to'])}, {sql_string(c['first_name'])}, {sql_string(c['last_name'])}, {sql_string(c['email'])}, {sql_string(c['phone'])}, {sql_string(c['job_title'])}, {sql_string(c['department'])}, {sql_string(c['city'])}, {sql_string(c['state'])}, {sql_string(c['country'])}, {sql_string(c['lead_source'])}, {sql_string(c['lead_status'])}, {sql_string(c['lifecycle_stage'])}, {c['score']}, {c['is_customer']}, {sql_array(c['tags'])}, {c['times_contacted']}, {sql_string(c['created_at'])}, {sql_string(c['created_by'])});\n")

            # Leads
            f.write("\nDELETE FROM leads;\n")
            for l in self.leads:
                f.write(f"INSERT INTO leads (id, tenant_id, first_name, last_name, full_name, email, phone, company_name, lead_source, lead_status, score, value, assigned_to, owner_id, company_id, title, city, state, country, lifecycle_stage, authority_level, tags, is_converted, lead_oid, created_at, created_by) VALUES ({sql_string(l['id'])}, {sql_string(l['tenant_id'])}, {sql_string(l['first_name'])}, {sql_string(l['last_name'])}, {sql_string(l['full_name'])}, {sql_string(l['email'])}, {sql_string(l['phone'])}, {sql_string(l['company_name'])}, {sql_string(l['lead_source'])}, {sql_string(l['lead_status'])}, {l['score']}, {l['value']}, {sql_string(l['assigned_to'])}, {sql_string(l['owner_id'])}, {sql_string(l['company_id'])}, {sql_string(l['title'])}, {sql_string(l['city'])}, {sql_string(l['state'])}, {sql_string(l['country'])}, {sql_string(l['lifecycle_stage'])}, {sql_string(l['authority_level'])}, {sql_array(l['tags'])}, {l['is_converted']}, {sql_string(l['lead_oid'])}, {sql_string(l['created_at'])}, {sql_string(l['created_by'])});\n")

        with open(sql_dir / "003_deals.sql", "w") as f:
            f.write("-- NuCRM Synthetic Data - Deals\n\n")

            # Pipelines
            f.write("DELETE FROM pipelines;\n")
            for p in self.pipelines:
                f.write(f"INSERT INTO pipelines (id, tenant_id, name, description, is_default, created_at) VALUES ({sql_string(p['id'])}, {sql_string(p['tenant_id'])}, {sql_string(p['name'])}, {sql_string(p['description'])}, {p['is_default']}, {sql_string(p['created_at'])});\n")

            # Deal Stages
            f.write("\nDELETE FROM deal_stages;\n")
            for s in self.deal_stages:
                f.write(f"INSERT INTO deal_stages (id, tenant_id, pipeline_id, name, \"order\", created_at) VALUES ({sql_string(s['id'])}, {sql_string(s['tenant_id'])}, {sql_string(s['pipeline_id'])}, {sql_string(s['name'])}, {s['order']}, {sql_string(s['created_at'])});\n")

            # Deals
            f.write("\nDELETE FROM deals;\n")
            for d in self.deals:
                f.write(f"INSERT INTO deals (id, tenant_id, contact_id, company_id, pipeline_id, stage_id, title, amount, close_date, assigned_to, created_at, created_by) VALUES ({sql_string(d['id'])}, {sql_string(d['tenant_id'])}, {sql_string(d['contact_id'])}, {sql_string(d['company_id'])}, {sql_string(d['pipeline_id'])}, {sql_string(d['stage_id'])}, {sql_string(d['title'])}, {d['amount']}, {sql_string(d['close_date'])}, {sql_string(d['assigned_to'])}, {sql_string(d['created_at'])}, {sql_string(d['created_by'])});\n")

        with open(sql_dir / "004_operations.sql", "w") as f:
            f.write("-- NuCRM Synthetic Data - Tasks, Tickets, Invoices, Meetings\n\n")

            # Tasks
            f.write("DELETE FROM tasks;\n")
            for t in self.tasks:
                f.write(f"INSERT INTO tasks (id, tenant_id, title, description, priority, status, due_date, completed, completed_at, contact_id, deal_id, assigned_to, created_at, created_by) VALUES ({sql_string(t['id'])}, {sql_string(t['tenant_id'])}, {sql_string(t['title'])}, {sql_string(t['description'])}, {sql_string(t['priority'])}, {sql_string(t['status'])}, {sql_string(t['due_date'])}, {t['completed']}, {sql_string(t['completed_at'])}, {sql_string(t['contact_id'])}, {sql_string(t['deal_id'])}, {sql_string(t['assigned_to'])}, {sql_string(t['created_at'])}, {sql_string(t['created_by'])});\n")

            # Tickets
            f.write("\nDELETE FROM support_tickets;\n")
            for t in self.tickets:
                f.write(f"INSERT INTO support_tickets (id, tenant_id, contact_id, company_id, subject, body, status, priority, category, assigned_to, first_response_at, resolved_at, created_at, created_by) VALUES ({sql_string(t['id'])}, {sql_string(t['tenant_id'])}, {sql_string(t['contact_id'])}, {sql_string(t['company_id'])}, {sql_string(t['subject'])}, {sql_string(t['body'])}, {sql_string(t['status'])}, {sql_string(t['priority'])}, {sql_string(t['category'])}, {sql_string(t['assigned_to'])}, {sql_string(t['first_response_at'])}, {sql_string(t['resolved_at'])}, {sql_string(t['created_at'])}, {sql_string(t['created_by'])});\n")

            # Invoices
            f.write("\nDELETE FROM invoices;\n")
            for i in self.invoices:
                f.write(f"INSERT INTO invoices (id, tenant_id, contact_id, company_id, invoice_number, title, status, issue_date, due_date, sent_at, paid_at, subtotal, tax_rate, tax_amount, total_amount, amount_paid, balance_due, currency, notes, deal_id, created_at) VALUES ({sql_string(i['id'])}, {sql_string(i['tenant_id'])}, {sql_string(i['contact_id'])}, {sql_string(i['company_id'])}, {sql_string(i['invoice_number'])}, {sql_string(i['title'])}, {sql_string(i['status'])}, {sql_string(i['issue_date'])}, {sql_string(i['due_date'])}, {sql_string(i['sent_at'])}, {sql_string(i['paid_at'])}, {i['subtotal']}, {i['tax_rate']}, {i['tax_amount']}, {i['total_amount']}, {i['amount_paid']}, {i['balance_due']}, {sql_string(i['currency'])}, {sql_string(i['notes'])}, {sql_string(i['deal_id'])}, {sql_string(i['created_at'])});\n")

            # Meetings
            f.write("\nDELETE FROM meetings;\n")
            for m in self.meetings:
                f.write(f"INSERT INTO meetings (id, tenant_id, user_id, contact_id, deal_id, title, description, start_time, end_time, location, status, created_at, created_by) VALUES ({sql_string(m['id'])}, {sql_string(m['tenant_id'])}, {sql_string(m['user_id'])}, {sql_string(m['contact_id'])}, {sql_string(m['deal_id'])}, {sql_string(m['title'])}, {sql_string(m['description'])}, {sql_string(m['start_time'])}, {sql_string(m['end_time'])}, {sql_string(m['location'])}, {sql_string(m['status'])}, {sql_string(m['created_at'])}, {sql_string(m['created_by'])});\n")

        with open(sql_dir / "005_notes_activities.sql", "w") as f:
            f.write("-- NuCRM Synthetic Data - Notes, Activities, Follow-ups\n\n")

            # Notes
            f.write("DELETE FROM notes;\n")
            for n in self.notes:
                f.write(f"INSERT INTO notes (id, tenant_id, entity_type, entity_id, content, created_at, created_by) VALUES ({sql_string(n['id'])}, {sql_string(n['tenant_id'])}, {sql_string(n['entity_type'])}, {sql_string(n['entity_id'])}, {sql_string(n['content'])}, {sql_string(n['created_at'])}, {sql_string(n['created_by'])});\n")

            # Activities
            f.write("\nDELETE FROM lead_activities;\n")
            for a in self.activities:
                f.write(f"INSERT INTO lead_activities (id, tenant_id, lead_id, user_id, performed_by, activity_type, description, performed_at, created_at, created_by) VALUES ({sql_string(a['id'])}, {sql_string(a['tenant_id'])}, {sql_string(a['entity_id'])}, {sql_string(a['performed_by'])}, {sql_string(a['performed_by'])}, {sql_string(a['activity_type'])}, {sql_string(a['description'])}, {sql_string(a['performed_at'])}, {sql_string(a['created_at'])}, {sql_string(a['created_by'])});\n")

            # Follow-ups
            f.write("\nDELETE FROM follow_ups;\n")
            for fu in self.follow_ups:
                f.write(f"INSERT INTO follow_ups (id, tenant_id, lead_id, contact_id, deal_id, assigned_to, title, description, due_date, status, completed_at, created_at, created_by) VALUES ({sql_string(fu['id'])}, {sql_string(fu['tenant_id'])}, {sql_string(fu['lead_id'])}, {sql_string(fu['contact_id'])}, {sql_string(fu['deal_id'])}, {sql_string(fu['assigned_to'])}, {sql_string(fu['title'])}, {sql_string(fu['description'])}, {sql_string(fu['due_date'])}, {sql_string(fu['status'])}, {sql_string(fu['completed_at'])}, {sql_string(fu['created_at'])}, {sql_string(fu['created_by'])});\n")

    # ═══════════════════════════════════════════════════════════════
    # MAIN
    # ═══════════════════════════════════════════════════════════════

    def generate_all(self):
        print("=" * 60)
        print("NuCRM Synthetic Data Generator")
        print("=" * 60)
        print()

        # Generate all data
        self.generate_tenants()
        self.generate_users()
        self.generate_tenant_members()
        self.generate_companies()
        self.generate_contacts()
        self.generate_leads()
        self.generate_pipelines_and_stages()
        self.generate_deals()
        self.generate_tasks()
        self.generate_tickets()
        self.generate_invoices()
        self.generate_meetings()
        self.generate_notes()
        self.generate_activities()
        self.generate_products()
        self.generate_services()
        self.generate_follow_ups()
        self.generate_forms()
        self.generate_tags()
        self.generate_notifications()

        # Print summary
        print()
        print("=" * 60)
        print("SUMMARY")
        print("=" * 60)
        datasets = [
            ("Tenants", len(self.tenants)),
            ("Users", len(self.users)),
            ("Tenant Members", len(self.tenant_members)),
            ("Companies", len(self.companies)),
            ("Contacts", len(self.contacts)),
            ("Leads", len(self.leads)),
            ("Pipelines", len(self.pipelines)),
            ("Deal Stages", len(self.deal_stages)),
            ("Deals", len(self.deals)),
            ("Tasks", len(self.tasks)),
            ("Tickets", len(self.tickets)),
            ("Invoices", len(self.invoices)),
            ("Meetings", len(self.meetings)),
            ("Notes", len(self.notes)),
            ("Activities", len(self.activities)),
            ("Products", len(self.products)),
            ("Services", len(self.services)),
            ("Follow-ups", len(self.follow_ups)),
            ("Forms", len(self.forms)),
            ("Tags", len(self.tags)),
            ("Notifications", len(self.notifications)),
        ]
        total = 0
        for name, count in datasets:
            print(f"  {name:20s} {count:>8,}")
            total += count
        print(f"  {'TOTAL':20s} {total:>8,}")
        print()

        # Export
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        self.export_json()
        self.export_csv()
        self.export_sql()

        print()
        print(f"Data exported to: {OUTPUT_DIR}")
        print(f"  json/ - {len(list((OUTPUT_DIR/'json').glob('*.jsonl')))} files")
        print(f"  csv/  - {len(list((OUTPUT_DIR/'csv').glob('*.csv')))} files")
        print(f"  sql/  - {len(list((OUTPUT_DIR/'sql').glob('*.sql')))} files")

if __name__ == "__main__":
    gen = SyntheticGenerator()
    gen.generate_all()
