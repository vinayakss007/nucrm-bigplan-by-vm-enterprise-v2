# NuCRM Enterprise - Full Architecture Map

> **Generated from codebase analysis**
> Next.js 16 Multi-Tenant SaaS CRM with TypeScript + Drizzle ORM + PostgreSQL

## Summary Counts

| Category | Count |
|----------|-------|
| Database Tables | 155+ |
| API Route Files | 314 |
| Tenant Pages | 119 |
| Superadmin Pages | 24 |
| Schema Files | 35 |
| Domains Covered | 25+ |

---

## Table of Contents

- [1. Database Schema](#1-database-schema)
  - [1.1 Core (Tenants, Users, Auth)](#11-core-tenantsusersauth)
  - [1.2 CRM (Contacts, Leads, Deals)](#12-crm-contactsleadsdeals)
  - [1.3 Automation & Workflows](#13-automation--workflows)
  - [1.4 Communication](#14-communication)
  - [1.5 Billing & Commerce](#15-billing--commerce)
  - [1.6 Marketing & Sequences](#16-marketing--sequences)
  - [1.7 Support & Tickets](#17-support--tickets)
  - [1.8 Infrastructure](#18-infrastructure)
  - [1.9 Projects](#19-projects)
  - [1.10 Chat](#110-chat)
  - [1.11 Security](#111-security)
  - [1.12 Plugins](#112-plugins)
  - [1.13 Knowledge Base](#113-knowledge-base)
  - [1.14 Visitors](#114-visitors)
  - [1.15 Documents](#115-documents)
  - [1.16 Territories](#116-territories)
  - [1.17 Lead Warming](#117-lead-warming)
  - [1.18 E-Signature](#118-e-signature)
  - [1.19 SLA](#119-sla)
  - [1.20 SMS](#120-sms)
  - [1.21 Hierarchy](#121-hierarchy)
  - [1.22 Tokens & OAuth](#122-tokens--oauth)
  - [1.23 Financial](#123-financial)
  - [1.24 AI Gateway](#124-ai-gateway)
  - [1.25 History & Audit](#125-history--audit)
  - [1.26 Assignment](#126-assignment)
  - [1.27 Email Tracking](#127-email-tracking)
  - [1.28 Usage](#128-usage)
  - [1.29 Segments](#129-segments)
  - [1.30 Compliance](#130-compliance)
  - [1.31 Templates](#131-templates)
  - [1.32 Modules](#132-modules)
- [2. API Routes](#2-api-routes)
  - [2.1 Auth Routes](#21-auth-routes)
  - [2.2 Tenant CRM Routes](#22-tenant-crm-routes)
  - [2.3 Tenant Communication Routes](#23-tenant-communication-routes)
  - [2.4 Tenant Billing Routes](#24-tenant-billing-routes)
  - [2.5 Tenant Automation & AI Routes](#25-tenant-automation--ai-routes)
  - [2.6 Tenant Admin/Settings Routes](#26-tenant-adminsettings-routes)
  - [2.7 Superadmin Routes](#27-superadmin-routes)
  - [2.8 Public Routes](#28-public-routes)
  - [2.9 Cron Routes](#29-cron-routes)
  - [2.10 Webhook Routes](#210-webhook-routes)
  - [2.11 User Routes](#211-user-routes)
  - [2.12 Misc Routes](#212-misc-routes)
- [3. Frontend Pages](#3-frontend-pages)
  - [3.1 Tenant Pages](#31-tenant-pages)
  - [3.2 Superadmin Pages](#32-superadmin-pages)
- [4. UI Actions Map](#4-ui-actions-map)
- [5. Data Flow Connections](#5-data-flow-connections)
- [6. Gaps & Issues](#6-gaps--issues)

---


## 1. Database Schema

All tables are defined using Drizzle ORM in `drizzle/schema/`. Multi-tenancy is enforced via `tenant_id` UUID columns on nearly every table.

### 1.1 Core (Tenants, Users, Auth)

**File:** `drizzle/schema/core.ts`

#### Table: `tenants`
The foundation table representing each organization/workspace.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| name | text | NOT NULL |
| slug | text | NOT NULL, UNIQUE |
| subdomain | text | Optional |
| status | text | Default: 'trialing' |
| plan_id | text | Default: 'free' |
| trial_ends_at | timestamp | 14 days from creation |
| owner_id | uuid | FK -> users.id |
| primary_color | text | Branding |
| billing_email | text | - |
| logo_url | text | - |
| favicon_url | text | - |
| custom_domain | text | UNIQUE |
| subscription_id | text | - |
| stripe_customer_id | text | - |
| stripe_subscription_id | text | - |
| billing_type | text | Default: 'trial' |
| manual_paid_until | timestamp | - |
| current_users | integer | Usage tracking |
| current_contacts | integer | Usage tracking |
| current_deals | integer | Usage tracking |
| storage_used_bytes | bigint | Usage tracking |
| industry | text | - |
| company_size | text | - |
| country | text | - |
| domain_verified | boolean | - |
| admin_notes | text | - |
| settings | jsonb | - |
| created_at, updated_at, deleted_at | timestamp | Lifecycle |
| metadata | jsonb | GIN indexed |

**Relationships:** owner_id -> users.id

---

#### Table: `users`
Global user identity (can belong to multiple tenants).

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| email | text | NOT NULL, UNIQUE |
| password_hash | text | - |
| full_name | text | - |
| avatar_url | text | - |
| phone | text | - |
| timezone | text | Default: 'UTC' |
| is_super_admin | boolean | Default: false |
| last_tenant_id | uuid | - |
| default_tenant_id | uuid | - |
| email_verified | boolean | Default: false |
| oauth_provider | text | 'google', 'github', etc. |
| oauth_id | text | - |
| locale | text | Default: 'en' |
| theme | text | Default: 'light' |
| telegram_bot_token | text | - |
| telegram_chat_id | text | - |
| telegram_enabled | boolean | - |
| totp_enabled | boolean | 2FA |
| totp_secret | text | 2FA |
| totp_backup_codes | jsonb | 2FA |
| created_at, updated_at, deleted_at | timestamp | Lifecycle |
| metadata | jsonb | GIN indexed |

---

#### Table: `refresh_tokens`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| user_id | uuid | FK -> users.id (CASCADE) |
| token | text | NOT NULL, UNIQUE |
| expires_at | timestamp | NOT NULL |

---

#### Table: `password_resets`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| user_id | uuid | FK -> users.id (CASCADE) |
| token | text | NOT NULL, UNIQUE |
| expires_at | timestamp | NOT NULL |

---

#### Table: `tenant_members`
Join table linking users to tenants with roles.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | FK -> tenants.id |
| user_id | uuid | FK -> users.id (CASCADE) |
| role_id | uuid | FK -> roles.id |
| role_slug | text | Default: 'member' |
| status | text | Default: 'active' |
| invited_by | uuid | FK -> users.id |
| settings | jsonb | - |
| notification_prefs | jsonb | - |

**Unique:** (tenant_id, user_id)

---

#### Table: `roles`
Tenant-scoped RBAC roles.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | FK -> tenants.id |
| name | text | NOT NULL |
| slug | text | NOT NULL |
| description | text | - |
| is_system | boolean | - |
| permissions | jsonb | Permission map |
| sort_order | integer | - |

**Unique:** (tenant_id, slug)

---

#### Table: `sessions`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| user_id | uuid | FK -> users.id (CASCADE) |
| token_hash | text | NOT NULL, UNIQUE |
| expires_at | timestamp | NOT NULL |
| ip_address | text | - |
| user_agent | text | - |

---

#### Table: `impersonation_sessions`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| impersonator_id | uuid | FK -> users.id |
| target_user_id | uuid | FK -> users.id |
| tenant_id | uuid | FK -> tenants.id |
| started_at | timestamp | - |
| ended_at | timestamp | - |
| reason | text | - |

---

#### Table: `field_permissions`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| role_id | uuid | FK -> roles.id |
| entity_type | text | 'contact', 'deal', etc. |
| field_name | text | - |
| access_level | text | 'none'/'read'/'write'/'admin' |

---

#### Table: `record_permissions`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| role_id | uuid | FK -> roles.id |
| entity_type | text | - |
| entity_id | uuid | - |
| access_level | text | 'none'/'read'/'write'/'admin' |
| granted_by | uuid | FK -> users.id |
| expires_at | timestamp | - |

---

#### Table: `approval_requests`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| entity_type | text | - |
| entity_id | uuid | - |
| rule_id | text | - |
| status | text | 'pending'/'approved'/'rejected' |
| requested_by | uuid | FK -> users.id |
| approved_by | uuid | FK -> users.id |
| rejected_by | uuid | FK -> users.id |

---

#### Table: `api_keys`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| user_id | uuid | FK -> users.id |
| name | text | NOT NULL |
| key_hash | text | NOT NULL, UNIQUE |
| prefix | text | - |
| scopes | jsonb | Default: ['*'] |
| is_active | boolean | - |
| call_count | bigint | - |
| expires_at | timestamp | - |

---

#### Table: `api_key_usage`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| api_key_id | uuid | FK -> api_keys.id |
| tenant_id | uuid | FK -> tenants.id |
| endpoint | text | - |
| method | text | - |
| status_code | integer | - |
| response_time_ms | integer | - |
| ip_address | inet | - |

---

#### Table: `audit_logs`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| user_id | uuid | FK -> users.id |
| impersonated_by | uuid | - |
| action | text | NOT NULL |
| entity_type | text | NOT NULL |
| entity_id | uuid | - |
| old_data | jsonb | - |
| new_data | jsonb | - |
| ip_address | text | - |
| previous_hash | text | Tamper-proof chain |
| hash | text | Tamper-proof chain |

---

#### Table: `notifications`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| user_id | uuid | FK -> users.id |
| title | text | NOT NULL |
| body | text | NOT NULL |
| type | text | Default: 'info' |
| link | text | - |
| read_at | timestamp | - |

---

#### Table: `invitations`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| email | text | NOT NULL |
| role_slug | text | Default: 'member' |
| token | text | NOT NULL, UNIQUE |
| invited_by | uuid | FK -> users.id |
| expires_at | timestamp | NOT NULL |
| accepted_at | timestamp | - |

---

#### Table: `feature_registry`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| feature_name | text | NOT NULL, UNIQUE |
| description | text | - |
| version | text | Default: '1.0.0' |
| enabled | boolean | - |
| metadata_keys | jsonb | - |
| entities | jsonb | - |
| requires_tables | jsonb | - |

---

### 1.2 CRM (Contacts, Leads, Deals)

**File:** `drizzle/schema/crm.ts`

#### Table: `companies`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| name | text | NOT NULL |
| domain | text | - |
| industry | text | - |
| company_size | text | - |
| annual_revenue | decimal(15,2) | - |
| website | text | - |
| phone | text | - |
| address, city, state, country, postal_code | text | Address fields |
| linkedin_url, twitter_url, facebook_url | text | Social links |
| is_customer | boolean | - |
| tags | text[] | - |
| custom_fields | jsonb | - |
| metadata | jsonb | GIN indexed |
| created_by, updated_by, deleted_at | - | Audit fields |

---

#### Table: `contacts`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| company_id | uuid | FK -> companies.id |
| assigned_to | uuid | FK -> users.id |
| first_name | text | NOT NULL |
| last_name | text | - |
| email | text | - |
| phone, mobile_phone, work_phone | text | Multiple phones |
| job_title | text | - |
| department | text | - |
| address, city, state, country, postal_code | text | Address |
| linkedin_url, twitter_url | text | Social |
| lead_source | text | - |
| lead_status | text | Default: 'new' |
| lifecycle_stage | text | Default: 'subscriber' |
| score | integer | Default: 0 |
| last_activity_at | timestamp | - |
| do_not_contact | boolean | - |
| unsubscribed | boolean | - |
| is_archived | boolean | - |
| is_customer | boolean | - |
| tags | text[] | - |
| custom_fields | jsonb | - |
| metadata | jsonb | GIN indexed |
| created_by, updated_by, deleted_at | - | Audit fields |

**Relationships:** company_id -> companies.id, assigned_to -> users.id

---

#### Table: `leads`
Separate from contacts - represents raw/unqualified leads.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| first_name | text | NOT NULL |
| last_name | text | Default: '' |
| email | text | - |
| phone | text | - |
| company_name | text | - |
| lead_source | text | - |
| lead_status | text | Default: 'new' |
| score | integer | Default: 0 |
| value | decimal(12,2) | - |
| budget | decimal(12,2) | - |
| assigned_to | uuid | FK -> users.id |
| owner_id | uuid | FK -> users.id |
| company_id | uuid | FK -> companies.id |
| lifecycle_stage | text | Default: 'lead' |
| utm_source, utm_medium, utm_campaign | text | Marketing attribution |
| is_archived | boolean | - |
| is_converted | boolean | - |
| converted_at | timestamp | - |
| converted_contact_id | uuid | FK -> contacts.id |
| tags | text[] | NOT NULL |
| custom_fields | jsonb | - |
| metadata | jsonb | GIN indexed |
| created_by, updated_by, deleted_at | - | Audit fields |

**Relationships:** assigned_to -> users.id, company_id -> companies.id, converted_contact_id -> contacts.id

---

#### Table: `pipelines`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| name | text | NOT NULL |
| description | text | - |
| is_default | boolean | - |

---

#### Table: `deal_stages`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| pipeline_id | uuid | FK -> pipelines.id (CASCADE) |
| name | text | NOT NULL |
| order | integer | - |

---

#### Table: `deals`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| contact_id | uuid | FK -> contacts.id |
| company_id | uuid | FK -> companies.id |
| pipeline_id | uuid | FK -> pipelines.id |
| stage_id | uuid | FK -> deal_stages.id |
| title | text | NOT NULL |
| amount | decimal(15,2) | Default: '0' |
| close_date | timestamp | - |
| assigned_to | uuid | FK -> users.id |
| metadata | jsonb | GIN indexed |
| created_by, updated_by, deleted_at | - | Audit fields |

**Relationships:** contact_id -> contacts.id, company_id -> companies.id, pipeline_id -> pipelines.id, stage_id -> deal_stages.id

---

#### Table: `custom_field_defs`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| entity_type | text | 'contact'/'deal'/'company'/'lead'/'task' |
| field_key | text | NOT NULL |
| field_label | text | NOT NULL |
| field_type | text | Default: 'text' |
| field_options | jsonb | - |
| is_required | boolean | - |
| is_searchable | boolean | - |
| is_calculated | boolean | - |
| formula | text | - |

**Unique:** (tenant_id, entity_type, field_key)

---

#### Table: `forms`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| name | text | NOT NULL |
| slug | text | UNIQUE |
| fields | jsonb | NOT NULL |
| settings | jsonb | - |
| is_active | boolean | - |
| submissions_count | integer | - |

---

#### Table: `products`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| name | text | NOT NULL |
| description | text | - |
| sku | text | - |
| base_price | decimal(12,2) | - |

---

#### Table: `quotes`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| contact_id | uuid | FK -> contacts.id |
| deal_id | uuid | FK -> deals.id (CASCADE) |
| title | text | NOT NULL |
| quote_number | text | - |
| status | text | 'draft'/'sent'/'viewed'/'accepted'/'declined'/'expired' |
| subtotal, discount, tax, total_amount | decimal(15,2) | - |
| expires_at | timestamp | - |

---

#### Table: `quote_line_items`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| quote_id | uuid | FK -> quotes.id (CASCADE) |
| product_id | uuid | FK -> products.id |
| description | text | NOT NULL |
| quantity | decimal(15,4) | - |
| unit_price | decimal(15,2) | NOT NULL |
| total | decimal(15,2) | NOT NULL |

---

#### Table: `price_books`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| name | text | NOT NULL |
| currency | text | Default: 'USD' |
| is_active | boolean | - |
| valid_from, valid_until | date | - |

---

#### Table: `price_book_entries`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| price_book_id | uuid | FK -> price_books.id (CASCADE) |
| product_id | uuid | FK -> products.id (CASCADE) |
| unit_price | decimal(15,2) | NOT NULL |

---

#### Table: `pipeline_health_metrics`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| pipeline_id | uuid | FK -> pipelines.id (CASCADE) |
| tenant_id | uuid | - |
| metric_date | date | - |
| total_deals | integer | - |
| total_value | numeric(15,2) | - |
| win_rate | numeric(5,4) | - |

---

#### Table: `tags`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| name | text | NOT NULL |
| color | text | - |

---

#### Table: `entity_tags`
Polymorphic tagging system.

| Column | Type | Notes |
|--------|------|-------|
| tenant_id | uuid | - |
| tag_id | uuid | FK -> tags.id (CASCADE) |
| entity_type | text | 'contact'/'deal'/'company'/'lead' |
| entity_id | uuid | - |

---

#### Table: `contact_tags` (Legacy)
| Column | Type | Notes |
|--------|------|-------|
| contact_id | uuid | FK -> contacts.id |
| tag_id | uuid | FK -> tags.id |

---

#### Table: `lead_tags` (Legacy)
| Column | Type | Notes |
|--------|------|-------|
| lead_id | uuid | FK -> leads.id |
| tag_id | uuid | FK -> tags.id |

---

#### Table: `notes`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| entity_type | text | 'contact'/'deal'/'company'/'lead' |
| entity_id | uuid | - |
| content | text | - |

---

#### Table: `deal_products`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| deal_id | uuid | FK -> deals.id (CASCADE) |
| tenant_id | uuid | - |
| product_name | text | NOT NULL |
| quantity | integer | - |
| price | decimal(12,2) | - |

---

#### Table: `form_submissions`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| form_id | uuid | FK -> forms.id (CASCADE) |
| tenant_id | uuid | - |
| data | jsonb | - |
| contact_id | uuid | FK -> contacts.id |

---

#### Table: `contact_emails`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| contact_id | uuid | FK -> contacts.id (CASCADE) |
| email | text | NOT NULL |
| is_primary | boolean | - |

---

#### Table: `contact_lifecycle_history`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| contact_id | uuid | FK -> contacts.id (CASCADE) |
| tenant_id | uuid | - |
| from_stage | text | - |
| to_stage | text | NOT NULL |
| changed_by | uuid | FK -> users.id |

---

#### Table: `contact_merge_history`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| primary_contact_id | uuid | FK -> contacts.id |
| merged_contact_id | uuid | FK -> contacts.id |
| merged_fields | jsonb | - |
| merged_by | uuid | FK -> users.id |

---

#### Table: `contact_scores`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| contact_id | uuid | FK -> contacts.id (CASCADE), UNIQUE |
| tenant_id | uuid | - |
| overall_score | integer | - |
| engagement_score | integer | - |
| fit_score | integer | - |
| intent_score | integer | - |
| score_factors | jsonb | - |

---

#### Table: `deal_forecasts`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| deal_id | uuid | FK -> deals.id (CASCADE) |
| win_probability | numeric(5,2) | - |
| predicted_close_date | date | - |
| predicted_value | numeric(12,2) | - |
| positive_factors, negative_factors | jsonb | - |

---

#### Table: `file_attachments`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| entity_type | text | - |
| entity_id | uuid | - |
| file_name | text | NOT NULL |
| file_path | text | NOT NULL |
| uploaded_by | uuid | FK -> users.id |

---

#### Table: `lead_activities`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| lead_id | uuid | FK -> leads.id (CASCADE) |
| user_id | uuid | FK -> users.id |
| activity_type | text | NOT NULL |
| description | text | - |
| activity_data | jsonb | - |

---

#### Table: `lead_assignments`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| lead_id | uuid | FK -> leads.id |
| contact_id | uuid | FK -> contacts.id |
| user_id | uuid | FK -> users.id |
| assigned_at | timestamp | - |

---

#### Table: `pipeline_stages`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| pipeline_id | uuid | FK -> pipelines.id (CASCADE) |
| name | text | NOT NULL |
| order_val | integer | - |

---

#### Table: `meetings`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| user_id | uuid | FK -> users.id |
| contact_id | uuid | FK -> contacts.id |
| deal_id | uuid | FK -> deals.id |
| title | text | NOT NULL |
| start_time | timestamp | NOT NULL |
| end_time | timestamp | - |
| status | text | Default: 'scheduled' |

---

#### Table: `churn_predictions`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| contact_id | uuid | FK -> contacts.id (CASCADE) |
| churn_probability | numeric(5,2) | - |
| churn_risk | text | - |
| risk_factors | jsonb | - |
| is_actioned | boolean | - |

---

#### Table: `lead_scoring_rules`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| name | text | NOT NULL |
| field | text | NOT NULL |
| operator | text | 'equals'/'contains'/etc. |
| value | text | - |
| score | integer | - |
| is_active | boolean | - |

---

#### Table: `call_notes`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| contact_id | uuid | FK -> contacts.id (CASCADE) |
| tenant_id | uuid | - |
| user_id | uuid | FK -> users.id |
| summary | text | - |
| action_items | text[] | - |
| sentiment | text | - |

---

#### Table: `call_recordings`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| contact_id | uuid | FK -> contacts.id (CASCADE) |
| tenant_id | uuid | - |
| recording_url | text | - |
| transcription | text | - |

---

#### Table: `conversation_metrics`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| contact_id | uuid | FK -> contacts.id (CASCADE) |
| tenant_id | uuid | - |
| total_calls | integer | - |
| avg_duration_seconds | numeric | - |

---

#### Table: `conversation_keywords`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| keyword | text | NOT NULL |
| count | integer | - |

---

#### Table: `revenue_projections`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| period_start, period_end | date | - |
| projected_amount | numeric(15,2) | - |
| actual_amount | numeric(15,2) | - |

---

#### Table: `saved_views`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| user_id | uuid | FK -> users.id |
| name | text | NOT NULL |
| entity_type | text | - |
| filters | jsonb | - |
| columns | jsonb | - |
| is_shared | boolean | - |

---

### 1.3 Automation & Workflows

**File:** `drizzle/schema/automation.ts`

#### Table: `automations` (Legacy)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| name | text | NOT NULL |
| is_active | boolean | - |
| trigger_type | text | Default: 'event' |
| trigger_config | jsonb | - |
| actions | jsonb | NOT NULL |
| conditions | jsonb | - |
| run_count | integer | - |
| last_run_at | timestamp | - |

---

#### Table: `automation_runs`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| automation_id | uuid | FK -> automations.id |
| tenant_id | uuid | - |
| status | text | 'running'/'completed'/'failed' |
| trigger_event | text | - |
| steps_completed | integer | - |
| triggered_by | uuid | FK -> users.id |

---

#### Table: `workflows`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| name | text | NOT NULL |
| status | text | 'draft'/'active'/'paused'/'archived' |
| trigger_type | text | 'manual'/'schedule'/'event'/'webhook' |
| trigger_config | jsonb | - |
| nodes | jsonb | Visual builder nodes |
| edges | jsonb | Visual builder edges |
| is_active | boolean | - |

---

#### Table: `workflow_actions`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| workflow_id | uuid | FK -> workflows.id (CASCADE) |
| tenant_id | uuid | - |
| action_type | text | 'email'/'whatsapp'/'update_field'/'webhook'/'delay' |
| config | jsonb | NOT NULL |
| order_index | integer | - |

---

#### Table: `workflow_executions`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| workflow_id | uuid | FK -> workflows.id (CASCADE) |
| tenant_id | uuid | - |
| contact_id | uuid | FK -> contacts.id |
| lead_id | uuid | FK -> leads.id |
| status | text | 'running'/'completed'/'failed'/'cancelled' |
| input_data, output_data | jsonb | - |

---

#### Table: `workflow_action_logs`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| execution_id | uuid | FK -> workflow_executions.id (CASCADE) |
| action_id | uuid | FK -> workflow_actions.id |
| tenant_id | uuid | - |
| status | text | 'pending'/'running'/'success'/'failed'/'skipped' |
| result | jsonb | - |

---

#### Table: `webhooks`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| name | text | NOT NULL |
| url | text | NOT NULL |
| events | jsonb | NOT NULL |
| secret | text | - |
| is_active | boolean | - |

---

#### Table: `webhook_deliveries`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| webhook_id | uuid | FK -> webhooks.id (CASCADE) |
| event_type | text | - |
| payload | jsonb | - |
| response_status | integer | - |
| status | text | Default: 'success' |

---

#### Table: `ai_insights`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| entity_type | text | - |
| entity_id | uuid | - |
| type | text | - |
| content | text | NOT NULL |
| priority | text | Default: 'medium' |
| score | numeric(5,2) | - |
| confidence | numeric(3,2) | - |

---

#### Table: `ai_usage_logs`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| user_id | uuid | FK -> users.id |
| feature | text | NOT NULL |
| model | text | - |
| tokens_used | integer | - |
| cost_estimate | numeric(10,5) | - |

---

#### Table: `ai_email_drafts`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| contact_id | uuid | FK -> contacts.id |
| deal_id | uuid | FK -> deals.id |
| purpose | text | Default: 'follow_up' |
| subject | text | NOT NULL |
| body | text | NOT NULL |
| tone | text | Default: 'professional' |
| is_sent | boolean | - |

---

#### Table: `content_generations`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| user_id | uuid | FK -> users.id |
| content_type | text | NOT NULL |
| platform | text | - |
| output_content | text | - |
| model_used | text | - |
| tokens_used | integer | - |

---

#### Table: `revenue_opportunities`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| opportunity_type | text | - |
| entity_type | text | - |
| estimated_value | decimal(12,2) | - |
| suggested_action | text | - |
| status | text | Default: 'new' |

---

#### Table: `ai_module_configs`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| module_name | text | NOT NULL |
| enabled | boolean | - |
| config | jsonb | - |

**Unique:** (tenant_id, module_name)

---

#### Table: `ai_usage_aggregated`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| module_name | text | - |
| billing_period | text | 'YYYY-MM' |
| count | bigint | - |
| tokens_used | bigint | - |
| cost_cents | bigint | - |

---

#### Table: `automation_workflows`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| workflow_id | uuid | - |
| name | text | NOT NULL |
| enabled | boolean | - |
| config | jsonb | - |

---

#### Table: `workflow_execution_logs`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| workflow_execution_id | uuid | FK -> workflow_executions.id |
| tenant_id | uuid | - |
| message | text | NOT NULL |
| level | text | Default: 'info' |
| step_name | text | - |

---

#### Table: `dead_letter_queue`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| job_type | text | NOT NULL |
| queue | text | NOT NULL |
| payload | jsonb | NOT NULL |
| error_message | text | NOT NULL |
| attempts | integer | - |
| status | text | Default: 'pending' |

---

#### Table: `scheduled_reports`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| name | text | NOT NULL |
| type | text | 'pipeline'/'revenue'/'contacts'/'performance' |
| frequency | text | 'hourly'/'daily'/'weekly'/'monthly' |
| recipients | jsonb | - |
| format | text | 'pdf'/'csv'/'xlsx' |
| status | text | 'active'/'paused'/'error' |

---

### 1.4 Communication

**File:** `drizzle/schema/comm.ts`

#### Table: `whatsapp_conversations`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| contact_id | uuid | FK -> contacts.id (CASCADE) |
| whatsapp_from | text | NOT NULL |
| whatsapp_to | text | NOT NULL |
| status | text | Default: 'active' |
| ai_enabled | boolean | - |
| message_count | integer | - |

---

#### Table: `whatsapp_messages`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| conversation_id | uuid | FK -> whatsapp_conversations.id (CASCADE) |
| tenant_id | uuid | - |
| direction | text | NOT NULL |
| content | text | NOT NULL |
| status | text | Default: 'sent' |
| ai_generated | boolean | - |

---

#### Table: `voice_calls`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| contact_id | uuid | FK -> contacts.id |
| deal_id | uuid | FK -> deals.id |
| direction | text | NOT NULL |
| status | text | NOT NULL |
| duration_seconds | integer | - |
| recording_url | text | - |
| transcript | text | - |
| ai_summary | text | - |

---

#### Table: `call_logs`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| contact_id | uuid | FK -> contacts.id |
| company_id | uuid | FK -> companies.id |
| deal_id | uuid | FK -> deals.id |
| user_id | uuid | FK -> users.id |
| direction | text | Default: 'outbound' |
| duration | integer | - |
| notes | text | - |

---

#### Table: `email_templates`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| name | text | NOT NULL |
| subject | text | NOT NULL |
| body_html | text | NOT NULL |
| category | text | - |

---

#### Table: `comm_email_drafts`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| contact_id | uuid | FK -> contacts.id |
| deal_id | uuid | FK -> deals.id |
| purpose | text | NOT NULL |
| subject | text | NOT NULL |
| body | text | NOT NULL |

---

#### Table: `email_tracking`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| contact_id | uuid | FK -> contacts.id |
| message_id | text | - |
| subject | text | - |
| sequence_enrollment_id | uuid | FK -> sequence_enrollments.id |
| open_count | integer | - |
| click_count | integer | - |

---

#### Table: `integrations`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| user_id | uuid | FK -> users.id |
| type | text | 'google'/'outlook'/'zoom'/'slack' |
| name | text | NOT NULL |
| config | jsonb | - |
| is_active | boolean | - |

---

#### Table: `email_log`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| contact_id | uuid | FK -> contacts.id |
| from_email | text | NOT NULL |
| to_email | text | NOT NULL |
| status | text | 'pending'/'sent'/'failed'/'bounced' |
| provider | text | 'resend'/'smtp'/'sendgrid' |

---

#### Table: `email_verifications`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| user_id | uuid | FK -> users.id (CASCADE) |
| token_hash | text | NOT NULL, UNIQUE |
| expires_at | timestamp | NOT NULL |

---

#### Table: `email_warmup_configs`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| is_active | boolean | - |
| daily_limit_current | integer | - |
| daily_limit_max | integer | Default: 50 |
| from_email | text | NOT NULL |
| total_sent | integer | - |

---

#### Table: `email_warmup_pool`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| config_id | uuid | FK -> email_warmup_configs.id (CASCADE) |
| participant_email | text | NOT NULL |
| sent_count | integer | - |
| reply_count | integer | - |

---

#### Table: `email_warmup_logs`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| config_id | uuid | FK -> email_warmup_configs.id (CASCADE) |
| participant_id | uuid | FK -> email_warmup_pool.id |
| direction | text | Default: 'outbound' |
| status | text | Default: 'pending' |

---

#### Table: `webhook_inbound_logs`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| webhook_id | uuid | FK -> webhooks.id |
| api_key_id | uuid | FK -> api_keys.id |
| tenant_id | uuid | - |
| action | text | - |
| payload | jsonb | - |
| processed | boolean | - |

---

#### Table: `whatsapp_templates`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| name | text | NOT NULL |
| language | text | Default: 'en' |
| content | text | - |
| components | jsonb | - |
| is_active | boolean | - |

---

### 1.5 Billing & Commerce

**File:** `drizzle/schema/billing.ts`

#### Table: `services`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| contact_id | uuid | FK -> contacts.id |
| company_id | uuid | FK -> companies.id |
| name | text | NOT NULL |
| pricing_type | text | 'fixed'/'hourly'/'monthly'/'yearly' |
| unit_price | decimal(15,2) | - |
| hourly_rate | decimal(15,2) | - |
| monthly_price | decimal(15,2) | - |
| is_active | boolean | - |
| times_used | integer | - |
| total_revenue | decimal(15,2) | - |

---

#### Table: `service_categories`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| name | text | NOT NULL |
| color | text | - |
| sort_order | integer | - |

---

#### Table: `invoices`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| contact_id | uuid | FK -> contacts.id |
| company_id | uuid | FK -> companies.id |
| invoice_number | text | NOT NULL, UNIQUE per tenant |
| status | text | Default: 'draft' |
| issue_date | date | NOT NULL |
| due_date | date | - |
| subtotal | decimal(15,2) | - |
| total_amount | decimal(15,2) | - |
| balance_due | decimal(15,2) | - |
| currency | text | Default: 'USD' |
| is_recurring | boolean | - |

---

#### Table: `invoice_line_items`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| invoice_id | uuid | NOT NULL |
| product_id | uuid | - |
| service_id | uuid | - |
| description | text | NOT NULL |
| quantity | decimal(15,4) | - |
| unit_price | decimal(15,2) | NOT NULL |
| total | decimal(15,2) | NOT NULL |

---

#### Table: `invoice_payments`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| invoice_id | uuid | NOT NULL |
| amount | decimal(15,2) | NOT NULL |
| payment_date | date | NOT NULL |
| payment_method | text | - |

---

#### Table: `orders`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| contact_id | uuid | FK -> contacts.id |
| company_id | uuid | FK -> companies.id |
| order_number | text | NOT NULL, UNIQUE per tenant |
| status | text | Default: 'draft' |
| order_date | date | NOT NULL |
| total_amount | decimal(15,2) | - |
| shipping_address, tracking_number | text | Shipping |

---

#### Table: `order_line_items`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| order_id | uuid | NOT NULL |
| product_id | uuid | - |
| description | text | NOT NULL |
| quantity | decimal(15,4) | - |
| unit_price | decimal(15,2) | NOT NULL |
| total | decimal(15,2) | NOT NULL |

---

#### Table: `contracts`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| contact_id | uuid | FK -> contacts.id |
| company_id | uuid | FK -> companies.id |
| title | text | NOT NULL |
| contract_type | text | NOT NULL |
| status | text | Default: 'draft' |
| start_date | date | NOT NULL |
| end_date | date | - |
| total_value | decimal(15,2) | - |

---

#### Table: `subscriptions` (service subscriptions)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| contact_id | uuid | - |
| company_id | uuid | - |
| name | text | NOT NULL |
| status | text | Default: 'active' |
| start_date | date | NOT NULL |
| amount | decimal(15,2) | NOT NULL |
| billing_frequency | text | NOT NULL |
| auto_renew | boolean | - |

---

### 1.6 Marketing & Sequences

**File:** `drizzle/schema/marketing.ts`

#### Table: `sequences`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| name | text | NOT NULL |
| status | text | 'draft'/'active'/'paused'/'archived' |
| enroll_count | integer | - |

---

#### Table: `sequence_steps`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| sequence_id | uuid | FK -> sequences.id (CASCADE) |
| tenant_id | uuid | - |
| step_number | integer | NOT NULL |
| step_type | text | 'email'/'delay'/'task'/'whatsapp' |
| delay_days | integer | - |
| subject | text | - |
| body | text | - |

---

#### Table: `sequence_step_logs`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| enrollment_id | uuid | FK -> sequence_enrollments.id (CASCADE) |
| step_id | uuid | FK -> sequence_steps.id |
| tenant_id | uuid | - |
| status | text | 'pending'/'sent'/'skipped'/'failed' |
| scheduled_at | timestamp | - |
| executed_at | timestamp | - |

---

#### Table: `sequence_enrollments`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| sequence_id | uuid | FK -> sequences.id (CASCADE) |
| contact_id | uuid | FK -> contacts.id (CASCADE) |
| status | text | 'active'/'completed'/'paused'/'unsubscribed' |
| current_step | integer | Default: 1 |
| next_step_at | timestamp | - |
| enrolled_by | uuid | FK -> users.id |

---

### 1.7 Support & Tickets

**File:** `drizzle/schema/support.ts`

#### Table: `error_logs`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | FK -> tenants.id |
| user_id | uuid | FK -> users.id |
| level | text | Default: 'error' |
| message | text | NOT NULL |
| stack | text | - |
| resolved | boolean | - |

---

#### Table: `webhook_queue`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| webhook_id | uuid | FK -> webhooks.id (CASCADE) |
| url | text | NOT NULL |
| payload | jsonb | NOT NULL |
| status | text | Default: 'pending' |
| attempt | integer | Default: 0 |
| max_retries | integer | Default: 3 |

---

#### Table: `failed_webhooks`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| webhook_id | uuid | NOT NULL |
| tenant_id | uuid | - |
| url | text | NOT NULL |
| error_message | text | NOT NULL |
| attempt_count | integer | - |

---

#### Table: `support_tickets`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| contact_id | uuid | FK -> contacts.id |
| subject | text | NOT NULL |
| body | text | NOT NULL |
| status | text | 'open'/'in_progress'/'resolved'/'closed' |
| priority | text | 'low'/'medium'/'high'/'urgent' |
| category | text | Default: 'general' |
| assigned_to | uuid | FK -> users.id |
| resolved_at | timestamp | - |

---

#### Table: `ticket_replies`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| ticket_id | uuid | FK -> support_tickets.id (CASCADE) |
| tenant_id | uuid | - |
| user_id | uuid | FK -> users.id |
| contact_id | uuid | FK -> contacts.id |
| body | text | NOT NULL |
| is_internal | boolean | - |

---

### 1.8 Infrastructure

**File:** `drizzle/schema/infra.ts`

#### Table: `system_settings`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| key | text | NOT NULL, UNIQUE |
| value | jsonb | NOT NULL |

---

#### Table: `plans`
| Column | Type | Notes |
|--------|------|-------|
| id | text | PK |
| name | text | NOT NULL |
| slug | text | NOT NULL, UNIQUE |
| price_monthly | numeric(10,2) | - |
| price_yearly | numeric(10,2) | - |
| max_users | integer | Default: 5 |
| max_contacts | integer | Default: 1000 |
| max_deals | integer | Default: 500 |
| max_storage_gb | numeric(6,2) | Default: 1 |
| features | jsonb | - |
| is_active | boolean | - |

---

#### Table: `subscriptions` (platform subscriptions)
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| plan_id | text | FK -> plans.id |
| status | text | Default: 'active' |
| stripe_customer_id | text | - |
| stripe_subscription_id | text | - |
| current_period_start, current_period_end | timestamp | - |
| cancel_at_period_end | boolean | - |

---

#### Table: `activities`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| user_id | uuid | FK -> users.id |
| entity_type | text | NOT NULL (polymorphic) |
| entity_id | uuid | NOT NULL |
| contact_id | uuid | FK -> contacts.id (legacy) |
| deal_id | uuid | FK -> deals.id (legacy) |
| company_id | uuid | FK -> companies.id (legacy) |
| event_type | text | NOT NULL |
| description | text | - |
| metadata | jsonb | - |

---

#### Table: `tasks`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| title | text | NOT NULL |
| priority | text | 'low'/'medium'/'high'/'urgent' |
| status | text | 'pending'/'completed'/'cancelled' |
| due_date | timestamp | - |
| completed | boolean | - |
| contact_id | uuid | FK -> contacts.id |
| deal_id | uuid | FK -> deals.id |
| assigned_to | uuid | FK -> users.id |

---

#### Table: `tenant_backups`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| filename | text | NOT NULL |
| storage_path | text | NOT NULL |
| status | text | 'pending'/'completed'/'failed' |
| backup_type | text | 'automated'/'manual'/'pre-deletion' |

---

#### Table: `tenant_restores`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| backup_id | uuid | FK -> tenant_backups.id |
| status | text | - |
| initiated_by | uuid | FK -> users.id |

---

#### Table: `dashboards`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| name | text | NOT NULL |
| layout | jsonb | Widget positions |
| is_default | boolean | - |

---

#### Table: `saved_reports`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| name | text | NOT NULL |
| report_type | text | - |
| config | jsonb | NOT NULL |
| chart_type | text | Default: 'table' |

---

#### Table: `billing_events`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| event_type | text | NOT NULL |
| amount | numeric(10,2) | - |
| stripe_event_id | text | UNIQUE |

---

#### Table: `usage_snapshots`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| snapshot_date | text | - |
| contacts_count, leads_count, deals_count, users_count | integer | - |
| storage_used_mb | numeric(10,2) | - |
| api_calls_count | integer | - |

---

#### Table: `limit_violations`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| violation_type | text | 'contacts_exceeded'/'users_exceeded'/'storage_exceeded' |
| limit_value | integer | - |
| actual_value | integer | - |
| resolved | boolean | - |

---

#### Table: `file_uploads`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| entity_type | text | - |
| entity_id | uuid | - |
| file_name | text | NOT NULL |
| file_path | text | NOT NULL |
| uploaded_by | uuid | FK -> users.id |

---

#### Table: `announcements`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| title | text | NOT NULL |
| body | text | NOT NULL |
| type | text | 'info'/'warning'/'update'/'feature' |
| target | text | 'all'/'tenants'/'super_admins' |
| is_active | boolean | - |

---

#### Tables: `tenant_backup_records`, `tenant_restore_records`, `backup_alerts`, `backup_records`, `backup_schedules`, `critical_data_backups`
Extended backup infrastructure for automated and selective restore operations.

---

#### Table: `permission_overrides`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| role_id | uuid | FK -> roles.id |
| entity_type | text | - |
| entity_id | uuid | - |
| permissions | jsonb | - |

---

#### Table: `health_checks`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| service | text | NOT NULL |
| status | text | Default: 'ok' |
| latency_ms | integer | - |

---

#### Table: `onboarding_progress`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| user_id | uuid | FK -> users.id |
| step_name | text | NOT NULL |
| is_completed | boolean | - |

---

#### Table: `platform_settings`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | FK -> tenants.id (nullable) |
| key | text | NOT NULL |
| value | jsonb | - |

---

#### Tables: `report_executions`, `revenue_forecast_summary`, `restore_snapshots`, `selective_restore_audit_log`, `selective_restore_logs`, `super_admin_backups`, `user_departures`, `api_key_usage_infra`, `dashboard_templates`, `report_templates`, `sso_providers`, `sso_sessions`
Additional infrastructure tables for reporting, enterprise auth (SSO), and backup management.

---

### 1.9 Projects

**File:** `drizzle/schema/projects.ts`

#### Table: `projects`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| name | text | NOT NULL |
| description | text | - |
| status | text | Default: 'active' |
| start_date, end_date | date | - |
| owner_id | uuid | FK -> users.id |

---

#### Table: `milestones`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| project_id | uuid | FK -> projects.id (CASCADE) |
| title | text | NOT NULL |
| due_date | date | - |
| completed | boolean | - |

---

#### Table: `project_tasks`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| project_id | uuid | FK -> projects.id (CASCADE) |
| task_id | uuid | FK -> tasks.id (CASCADE) |

---

### 1.10 Chat

**File:** `drizzle/schema/chat.ts`

#### Table: `chat_sessions`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| visitor_id | text | NOT NULL |
| visitor_name | text | - |
| visitor_email | text | - |
| assigned_to | uuid | FK -> users.id |
| status | text | 'active'/'waiting'/'closed' |
| channel | text | Default: 'web' |
| converted_lead_id | uuid | - |

---

#### Table: `chat_messages`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| session_id | uuid | FK -> chat_sessions.id (CASCADE) |
| tenant_id | uuid | - |
| sender_type | text | 'visitor'/'agent'/'bot' |
| sender_id | text | - |
| content | text | NOT NULL |

---

### 1.11 Security

**File:** `drizzle/schema/security.ts`

#### Table: `login_attempts`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| email | text | NOT NULL |
| ip_address | text | NOT NULL |
| success | boolean | - |
| failure_reason | text | - |

---

#### Table: `login_blocks`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| identifier | text | NOT NULL |
| identifier_type | text | NOT NULL |
| blocked_until | timestamp | NOT NULL |
| attempts_count | integer | - |

---

#### Table: `security_events`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | FK -> tenants.id |
| user_id | uuid | FK -> users.id |
| event_type | text | NOT NULL |
| ip_address | text | - |

---

### 1.12 Plugins

**File:** `drizzle/schema/plugins.ts`

#### Table: `custom_plugins`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| user_id | uuid | FK -> users.id |
| name | text | NOT NULL |
| base_url | text | NOT NULL |
| auth_type | text | 'bearer'/'basic'/'api_key_header'/'none' |
| auth_config | jsonb | Encrypted |
| actions | jsonb | Array of plugin actions |
| status | text | 'active'/'disabled'/'error' |

---

#### Table: `plugin_execution_logs`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| plugin_id | uuid | FK -> custom_plugins.id (CASCADE) |
| action_name | text | NOT NULL |
| method | text | NOT NULL |
| url | text | NOT NULL |
| response_status | integer | - |
| success | boolean | - |
| duration_ms | integer | - |

---

### 1.13 Knowledge Base

**File:** `drizzle/schema/knowledge.ts`

#### Table: `kb_categories`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| name | text | NOT NULL |
| slug | text | NOT NULL |
| parent_id | uuid | Self-reference |
| order | integer | - |

---

#### Table: `kb_articles`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| category_id | uuid | FK -> kb_categories.id |
| title | text | NOT NULL |
| slug | text | NOT NULL |
| content | text | NOT NULL |
| status | text | 'draft'/'published'/'archived' |
| views | integer | - |
| helpful, not_helpful | integer | Feedback counters |
| tags | text[] | - |

---

### 1.14 Visitors

**File:** `drizzle/schema/visitors.ts`

#### Table: `visitors`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| fingerprint_id | text | NOT NULL |
| identified_contact_id | uuid | - |
| total_page_views | integer | - |
| score | integer | Engagement score |

---

#### Table: `page_views`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| visitor_id | uuid | NOT NULL |
| url | text | NOT NULL |
| title | text | - |
| duration_seconds | integer | - |

---

### 1.15 Documents

**File:** `drizzle/schema/documents.ts`

#### Table: `document_folders`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| name | text | NOT NULL |
| parent_id | uuid | Self-reference |

---

#### Table: `documents`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| name | text | NOT NULL |
| mime_type | text | NOT NULL |
| size_bytes | integer | NOT NULL |
| s3_key | text | NOT NULL |
| s3_bucket | text | NOT NULL |
| folder_id | uuid | - |
| entity_type | text | 'contact'/'deal'/'company' |
| entity_id | text | - |
| uploaded_by | uuid | NOT NULL |

---

### 1.16 Territories

**File:** `drizzle/schema/territories.ts`

#### Table: `territories`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| name | text | NOT NULL |
| parent_id | uuid | Self-reference |
| type | enum | 'region'/'country'/'state'/'city'/'custom' |
| geo_config | jsonb | Countries, states, postal codes |
| assigned_to | uuid | Primary owner |

---

#### Table: `territory_assignments`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| territory_id | uuid | NOT NULL |
| user_id | uuid | NOT NULL |
| role | enum | 'owner'/'member' |

---

### 1.17 Lead Warming

**File:** `drizzle/schema/lead-warming.ts`

#### Table: `lead_warming_events`
Festival/event calendar for warming messages.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | Nullable (null = global) |
| name | text | NOT NULL |
| event_type | text | 'festival'/'holiday'/'season'/'custom'/'birthday' |
| recurrence | text | 'yearly'/'monthly'/'once'/'contact_specific' |
| event_month, event_day | integer | For yearly recurring |
| channels | jsonb | ['email', 'whatsapp'] |
| is_system | boolean | - |

---

#### Table: `lead_warming_campaigns`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| name | text | NOT NULL |
| status | text | 'active'/'paused'/'draft'/'archived' |
| target_filter | jsonb | Audience filter criteria |
| enable_email, enable_whatsapp, enable_sms | boolean | Channels |
| ai_generate_messages | boolean | - |
| ai_tone | text | 'warm_professional'/'casual_friendly'/'formal' |
| total_sent, total_replies, total_positive_intent | integer | Stats |

---

#### Table: `lead_warming_messages`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| campaign_id | uuid | FK -> lead_warming_campaigns.id (CASCADE) |
| contact_id | uuid | FK -> contacts.id (CASCADE) |
| event_id | uuid | FK -> lead_warming_events.id |
| channel | text | 'email'/'whatsapp'/'sms' |
| body | text | NOT NULL |
| ai_generated | boolean | - |
| status | text | 'pending'/'queued'/'sent'/'delivered'/'failed' |

---

#### Table: `lead_warming_replies`
AI-analyzed reply tracking.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| message_id | uuid | FK -> lead_warming_messages.id (CASCADE) |
| contact_id | uuid | FK -> contacts.id (CASCADE) |
| reply_content | text | NOT NULL |
| intent | text | 'interested'/'not_interested'/'ask_later'/'question'/etc. |
| intent_confidence | integer | 0-100 |
| sentiment | text | 'positive'/'neutral'/'negative' |
| ai_suggested_action | text | - |
| requires_follow_up | boolean | - |

---

#### Table: `lead_warming_schedule`
Per-contact schedule to prevent over-messaging.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| contact_id | uuid | FK -> contacts.id (CASCADE) |
| campaign_id | uuid | FK -> lead_warming_campaigns.id (CASCADE) |
| messages_this_month | integer | - |
| opted_out | boolean | - |

---

### 1.18 E-Signature

**File:** `drizzle/schema/esignature.ts`

#### Table: `signing_requests`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| document_id | uuid | NOT NULL |
| provider | text | 'docusign'/'hellosign'/'internal' |
| status | text | 'pending'/'sent'/'viewed'/'signed'/'declined'/'expired' |
| external_id | text | - |
| signers | jsonb | - |

---

#### Table: `signing_events`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| request_id | uuid | FK -> signing_requests.id (CASCADE) |
| tenant_id | uuid | - |
| signer_email | text | NOT NULL |
| event | text | 'sent'/'viewed'/'signed'/'declined' |
| event_at | timestamp | - |

---

### 1.19 SLA

**File:** `drizzle/schema/sla.ts`

#### Table: `sla_policies`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| name | text | NOT NULL |
| priority | text | 'critical'/'high'/'medium'/'low' |
| response_time_minutes | integer | NOT NULL |
| resolution_time_minutes | integer | NOT NULL |
| escalation_rules | jsonb | - |
| is_active | boolean | - |

---

#### Table: `sla_breaches`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| policy_id | text | NOT NULL |
| entity_type | text | 'ticket'/'deal'/'task' |
| entity_id | text | NOT NULL |
| breach_type | text | 'response'/'resolution' |
| breached_at | timestamp | - |
| escalation_level | integer | - |

---

### 1.20 SMS

**File:** `drizzle/schema/sms.ts`

#### Table: `sms_messages`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| contact_id | uuid | FK -> contacts.id |
| direction | text | 'inbound'/'outbound' |
| to, from | text | NOT NULL |
| body | text | NOT NULL |
| status | text | 'queued'/'sent'/'delivered'/'failed' |
| twilio_sid | text | - |

---

#### Table: `sms_templates`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| name | text | NOT NULL |
| body | text | NOT NULL |
| variables | jsonb | - |

---

### 1.21 Hierarchy

**File:** `drizzle/schema/hierarchy.ts`

#### Table: `tenant_hierarchy`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| parent_tenant_id | uuid | NOT NULL |
| child_tenant_id | uuid | NOT NULL |
| relationship | enum | 'parent'/'division'/'franchise'/'branch' |

---

#### Table: `hierarchy_permissions`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| hierarchy_id | uuid | NOT NULL |
| permission | enum | 'view_data'/'manage_users'/'share_contacts'/'aggregate_reports' |

---

### 1.22 Tokens & OAuth

**File:** `drizzle/schema/tokens.ts`

#### Table: `token_budgets`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| service | text | NOT NULL |
| monthly_budget_cents | bigint | - |
| current_month_cents | bigint | - |
| hard_cap_enabled | boolean | - |
| billing_period | text | 'YYYY-MM' |

---

#### Table: `tenant_token_limits`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | UNIQUE |
| openai_monthly_limit | bigint | -1 = unlimited |
| whatsapp_monthly_msgs | bigint | - |
| voice_monthly_mins | bigint | - |
| hard_cap_action | text | Default: 'block' |

---

#### Table: `user_token_limits`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| user_id | uuid | FK -> users.id |
| module | text | NOT NULL |
| daily_limit | bigint | - |
| monthly_limit | bigint | - |

---

#### Table: `api_keys_registry`
Global service API key management.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| service | text | NOT NULL |
| key_name | text | NOT NULL |
| encrypted_key | text | NOT NULL |
| is_active | boolean | - |
| is_primary | boolean | - |
| monthly_budget_cents | bigint | - |

---

#### Table: `usage_alerts`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| alert_type | text | NOT NULL |
| target_type | text | NOT NULL |
| message | text | - |
| acknowledged | boolean | - |

---

#### Table: `cost_anomalies`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| service | text | NOT NULL |
| expected_daily_cents | bigint | - |
| actual_daily_cents | bigint | - |
| deviation_pct | decimal | - |

---

#### Table: `oauth_clients`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | FK -> tenants.id |
| client_id | text | NOT NULL, UNIQUE |
| client_secret | text | NOT NULL |
| name | text | NOT NULL |
| redirect_uris | text | NOT NULL |

---

#### Table: `oauth_codes`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| client_id | uuid | FK -> oauth_clients.id |
| user_id | uuid | FK -> users.id |
| code | text | NOT NULL, UNIQUE |
| expires_at | timestamp | NOT NULL |

---

#### Table: `oauth_tokens`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| client_id | uuid | FK -> oauth_clients.id |
| user_id | uuid | FK -> users.id |
| access_token | text | NOT NULL, UNIQUE |
| refresh_token | text | UNIQUE |
| expires_at | timestamp | NOT NULL |

---

#### Table: `portal_clients`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| name | text | NOT NULL |
| email | text | NOT NULL |
| access_token | text | NOT NULL, UNIQUE |
| is_active | boolean | - |

---

### 1.23 Financial

**File:** `drizzle/schema/financial.ts`

#### Table: `exchange_rates`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| base_currency | text | NOT NULL |
| target_currency | text | NOT NULL |
| rate | numeric(16,8) | NOT NULL |
| source | text | Default: 'exchangerate-api' |

---

#### Table: `tax_rates`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| name | text | NOT NULL |
| rate | numeric(8,4) | NOT NULL |
| type | text | 'percentage'/'fixed' |
| country, state | text | - |
| is_default | boolean | - |

---

#### Table: `tax_exemptions`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| entity_type | text | 'contact'/'company'/'deal' |
| entity_id | uuid | NOT NULL |
| reason | text | NOT NULL |

---

### 1.24 AI Gateway

**File:** `drizzle/schema/ai.ts`

#### Table: `ai_provider_secrets`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| provider | text | 'openai'/'anthropic'/'groq'/'ollama' |
| encrypted_key | text | AES-256-GCM |
| base_url | text | For Ollama self-hosted |
| created_by | uuid | FK -> users.id |

**Unique:** (tenant_id, provider) WHERE deleted_at IS NULL

---

#### Table: `ai_activity`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| user_id | uuid | FK -> users.id |
| action | text | 'draft'/'lead_scoring'/'predict_deal'/'enrich_contact'/'suggest_followup'/'summarize' |
| provider | text | 'openai'/'anthropic'/'groq'/'ollama' |
| model | text | e.g. 'gpt-4o-mini' |
| status | text | 'success'/'error'/'rate_limited'/'fallback_used' |
| tokens_in | integer | - |
| tokens_out | integer | - |
| tokens_used | integer | - |
| cost_cents | bigint | - |
| latency_ms | integer | - |
| entity_type | text | - |
| entity_id | uuid | - |
| accepted | boolean | Did user use the suggestion? |

---

#### Table: `ai_draft_templates`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| slug | text | NOT NULL |
| name | text | NOT NULL |
| kind | text | 'email'/'note'/'reply'/'call_prep' |
| entity_types | text | 'contact,deal' |
| system_prompt | text | NOT NULL |
| user_prompt | text | NOT NULL (supports {{variables}}) |
| tone | text | Default: 'professional' |
| active | boolean | - |

---

### 1.25 History & Audit

**File:** `drizzle/schema/history.ts`

#### Table: `edit_history`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | NOT NULL |
| entity_type | text | NOT NULL |
| entity_id | uuid | NOT NULL |
| user_id | uuid | NOT NULL |
| field_name | text | NOT NULL |
| old_value | text | - |
| new_value | text | - |
| change_type | text | Default: 'update' |

---

#### Table: `field_snapshots`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | NOT NULL |
| entity_type | text | NOT NULL |
| entity_id | uuid | NOT NULL |
| snapshot_type | text | NOT NULL |
| snapshot_data | text | NOT NULL |

---

### 1.26 Assignment

**File:** `drizzle/schema/assignment.ts`

#### Table: `assignment_rules`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| name | text | NOT NULL |
| type | text | 'round_robin'/'territory'/'skill_based'/'weighted' |
| config | jsonb | - |
| is_active | boolean | - |
| priority | integer | - |
| entity_type | text | 'lead'/'ticket'/'deal' |

---

#### Table: `assignment_logs`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| rule_id | text | NOT NULL |
| entity_type | text | NOT NULL |
| entity_id | text | NOT NULL |
| assigned_to | text | NOT NULL |
| reason | text | - |

---

### 1.27 Email Tracking

**File:** `drizzle/schema/email-tracking.ts`

#### Table: `email_opens`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| contact_id | uuid | FK -> contacts.id |
| campaign_id | uuid | - |
| email_id | uuid | - |
| opened_at | timestamp | - |
| ip_address | text | - |

---

#### Table: `email_clicks`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| contact_id | uuid | FK -> contacts.id |
| campaign_id | uuid | - |
| link_url | text | NOT NULL |
| clicked_at | timestamp | - |

---

### 1.28 Usage

**File:** `drizzle/schema/usage.ts`

#### Table: `user_usage`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| user_id | uuid | FK -> users.id |
| counters | jsonb | - |
| storage_bytes | bigint | - |
| api_calls_today | integer | - |
| ai_tokens_today | integer | - |

---

#### Table: `plan_limits`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| plan_id | text | NOT NULL, UNIQUE |
| max_users, max_contacts, max_deals | integer | - |
| max_storage_bytes | bigint | - |
| max_api_calls_per_day | integer | - |
| max_ai_tokens_per_day | integer | - |

---

### 1.29 Segments

**File:** `drizzle/schema/segments.ts`

#### Table: `segments`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| name | text | NOT NULL |
| entity_type | text | 'contact'/'deal'/'company'/'lead' |
| config | jsonb | UI builder state |
| query_logic | jsonb | Compiled filter |

---

#### Table: `segment_members`
| Column | Type | Notes |
|--------|------|-------|
| segment_id | uuid | FK -> segments.id (CASCADE) |
| entity_id | uuid | NOT NULL |
| tenant_id | uuid | - |
| added_at | timestamp | - |

---

### 1.30 Compliance

**File:** `drizzle/schema/compliance.ts`

#### Table: `compliance_requests`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| type | text | 'gdpr_export'/'gdpr_delete'/'soc2_report' |
| status | text | 'pending'/'processing'/'completed'/'failed' |
| requested_by | uuid | NOT NULL |
| result | jsonb | - |

---

#### Table: `data_retention_policies`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| entity_type | text | 'contacts'/'deals'/'activities'/'emails'/'audit_logs' |
| retention_days | integer | NOT NULL |
| action | text | 'archive'/'delete'/'anonymize' |
| is_active | boolean | - |

---

### 1.31 Templates

**File:** `drizzle/schema/templates.ts`

#### Table: `product_templates`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| name | text | NOT NULL |
| slug | text | UNIQUE |
| modules | jsonb | - |
| custom_fields | jsonb | - |
| pipelines | jsonb | - |
| automations | jsonb | - |
| is_builtin | boolean | - |
| tenant_count | integer | - |

---

#### Table: `tenant_templates`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| template_id | uuid | FK -> product_templates.id (CASCADE) |
| applied_at | timestamp | - |
| applied_by | uuid | FK -> users.id |

---

### 1.32 Modules

**File:** `drizzle/schema/modules.ts`

#### Table: `modules`
| Column | Type | Notes |
|--------|------|-------|
| id | text | PK |
| name | text | NOT NULL |
| version | text | Default: '1.0.0' |
| category | text | - |
| manifest | jsonb | - |

---

#### Table: `tenant_modules`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| tenant_id | uuid | - |
| module_id | text | FK -> modules.id (CASCADE) |
| status | text | 'active'/'disabled' |
| enabled_features | jsonb | - |
| force_enabled | boolean | Super admin override |
| settings | jsonb | - |
| installed_by | uuid | FK -> users.id |

**Unique:** (tenant_id, module_id)

---


## 2. API Routes

All routes are in `app/api/` using Next.js App Router conventions. Each `route.ts` file exports HTTP method handlers.

### 2.1 Auth Routes

| Route | Methods | Tables Used | Description |
|-------|---------|-------------|-------------|
| `/api/auth/login` | POST | users, sessions, tenant_members, login_attempts | Email/password login |
| `/api/auth/signup` | POST | users, tenants, tenant_members, roles | Create account + tenant |
| `/api/auth/logout` | POST | sessions | Destroy session |
| `/api/auth/forgot-password` | POST | users, password_resets | Request password reset |
| `/api/auth/reset-password` | POST | users, password_resets | Reset with token |
| `/api/auth/password-reset/request` | POST | users, password_resets | Alt password reset request |
| `/api/auth/password-reset/confirm` | POST | users, password_resets | Alt password reset confirm |
| `/api/auth/verify-email` | POST | users, email_verifications | Verify email token |
| `/api/auth/resend-verification` | POST | users, email_verifications | Resend verification email |
| `/api/auth/accept-invite` | POST | users, invitations, tenant_members | Accept workspace invite |
| `/api/auth/invite-details` | GET | invitations | Get invite info by token |
| `/api/auth/csrf-token` | GET | - | Generate CSRF token |
| `/api/auth/2fa/setup` | POST | users | Enable TOTP 2FA |
| `/api/auth/2fa/verify` | POST | users | Verify TOTP code |
| `/api/auth/2fa/disable` | POST | users | Disable 2FA |
| `/api/auth/oauth/authorize` | GET | oauth_clients, oauth_codes | OAuth2 authorization |
| `/api/auth/oauth/token` | POST | oauth_codes, oauth_tokens | OAuth2 token exchange |
| `/api/auth/oauth/revoke` | POST | oauth_tokens | Revoke OAuth token |
| `/api/auth/sso/[provider]` | GET, POST | users, sso_providers, sso_sessions | SSO login flow |

---

### 2.2 Tenant CRM Routes

| Route | Methods | Tables Used | Description |
|-------|---------|-------------|-------------|
| `/api/tenant/leads` | GET, POST | leads, users, companies, lead_activities | List/create leads |
| `/api/tenant/leads/[id]` | GET, PATCH, DELETE | leads, lead_activities | Single lead CRUD |
| `/api/tenant/leads/[id]/convert` | POST | leads, contacts, deals | Convert lead to contact |
| `/api/tenant/leads/assign` | POST, DELETE | leads, lead_assignments | Assign/unassign leads |
| `/api/tenant/leads/bulk` | POST | leads | Bulk operations |
| `/api/tenant/leads/import` | POST | leads | CSV/Excel import |
| `/api/tenant/leads/history` | GET | lead_activities, edit_history | Lead change history |
| `/api/tenant/contacts` | GET, POST | contacts, companies | List/create contacts |
| `/api/tenant/contacts/[id]` | GET, PATCH, DELETE | contacts | Single contact CRUD |
| `/api/tenant/contacts/[id]/notes` | GET, POST, DELETE | notes | Contact notes |
| `/api/tenant/contacts/[id]/timeline` | GET, POST | activities | Contact activity timeline |
| `/api/tenant/contacts/[id]/lifecycle` | GET, POST | contact_lifecycle_history | Lifecycle changes |
| `/api/tenant/contacts/[id]/status` | PATCH | contacts | Update contact status |
| `/api/tenant/contacts/[id]/enroll` | POST, DELETE | sequence_enrollments | Sequence enrollment |
| `/api/tenant/contacts/bulk` | POST | contacts | Bulk operations |
| `/api/tenant/contacts/import` | POST | contacts | CSV/Excel import |
| `/api/tenant/contacts/export` | GET | contacts | Export contacts |
| `/api/tenant/contacts/merge` | GET, POST | contacts, contact_merge_history | Merge duplicates |
| `/api/tenant/contacts/duplicates` | GET, POST | contacts | Find duplicates |
| `/api/tenant/companies` | GET, POST | companies | List/create companies |
| `/api/tenant/companies/[id]` | GET, PATCH, DELETE | companies | Single company CRUD |
| `/api/tenant/companies/bulk` | POST | companies | Bulk operations |
| `/api/tenant/deals` | GET, POST | deals, deal_stages, pipelines, contacts | List/create deals |
| `/api/tenant/deals/[id]` | GET, PATCH, DELETE | deals | Single deal CRUD |
| `/api/tenant/deals/bulk` | POST | deals | Bulk operations |
| `/api/tenant/pipelines` | GET, POST | pipelines, deal_stages | Pipeline management |
| `/api/tenant/pipelines/[id]` | PATCH, DELETE | pipelines, deal_stages | Single pipeline |
| `/api/tenant/tasks` | GET, POST | tasks | List/create tasks |
| `/api/tenant/tasks/[id]` | GET, PATCH, DELETE | tasks | Single task CRUD |
| `/api/tenant/tasks/bulk` | POST | tasks | Bulk task operations |
| `/api/tenant/products` | (via modules) | products | Product catalog |
| `/api/tenant/quotes` | GET, POST | quotes, quote_line_items | List/create quotes |
| `/api/tenant/quotes/[id]` | GET, PUT, DELETE | quotes, quote_line_items | Single quote CRUD |
| `/api/tenant/offers` | GET | quotes | View sent offers |
| `/api/tenant/offers/[quoteId]/send` | POST | quotes | Send quote as offer |
| `/api/tenant/offers/[quoteId]/cancel` | POST | quotes | Cancel sent offer |
| `/api/tenant/meetings` | GET, POST | meetings | Calendar meetings |
| `/api/tenant/activities` | GET, POST | activities | Activity timeline |
| `/api/tenant/custom-fields` | GET, POST, PUT, DELETE | custom_field_defs | Custom field management |
| `/api/tenant/views` | GET, POST | saved_views | Saved list views |
| `/api/tenant/views/[id]` | GET, PATCH, DELETE | saved_views | Single view |
| `/api/tenant/forms` | GET, POST | forms | Form builder |
| `/api/tenant/forms/[id]` | GET, PATCH, DELETE | forms | Single form |
| `/api/tenant/forms/public/[id]` | GET | forms | Public form access |
| `/api/tenant/search` | GET | contacts, leads, deals, companies | Global search |
| `/api/tenant/search/advanced` | GET | contacts, leads, deals | Advanced search |
| `/api/tenant/leaderboards` | GET | deals, tasks | Sales leaderboards |
| `/api/tenant/history/[entity]` | GET | edit_history | Entity change history |

---

### 2.3 Tenant Communication Routes

| Route | Methods | Tables Used | Description |
|-------|---------|-------------|-------------|
| `/api/tenant/whatsapp/messages` | GET | whatsapp_messages, whatsapp_conversations | List messages |
| `/api/tenant/whatsapp/send` | POST | whatsapp_messages, whatsapp_conversations | Send message |
| `/api/tenant/whatsapp/templates` | GET, POST | whatsapp_templates | Template management |
| `/api/tenant/calls` | GET, POST | call_logs, voice_calls | Call logging |
| `/api/tenant/email-templates` | GET, POST | email_templates | Email template CRUD |
| `/api/tenant/email-templates/[id]` | GET, PATCH, DELETE | email_templates | Single template |
| `/api/tenant/email/test` | POST | email_log | Send test email |
| `/api/tenant/email/track` | GET | email_tracking | Track email opens |
| `/api/tenant/email-warmup` | GET, POST, PATCH | email_warmup_configs, email_warmup_pool | Warmup config |
| `/api/tenant/sms` | GET, POST | sms_messages | SMS messaging |
| `/api/tenant/sms/templates` | GET, POST | sms_templates | SMS templates |
| `/api/tenant/sms/webhook` | POST | sms_messages | Twilio webhook |
| `/api/tenant/chat` | GET, POST | chat_sessions | Chat sessions |
| `/api/tenant/chat/[sessionId]/messages` | GET, POST | chat_messages | Chat messages |
| `/api/tenant/chat/widget` | GET, POST | chat_sessions, chat_messages | Widget endpoints |
| `/api/tenant/integrations` | GET, POST | integrations | Integration list |
| `/api/tenant/integrations/[id]` | PATCH, DELETE | integrations | Manage integration |
| `/api/tenant/integrations/telegram/test` | POST | - | Test Telegram bot |
| `/api/tenant/notifications` | GET, PATCH, DELETE | notifications | Notification management |
| `/api/tenant/notifications/unread` | GET | notifications | Unread count |
| `/api/tenant/notifications/stream` | GET | notifications | SSE stream |
| `/api/tenant/notifications/matrix` | GET, PATCH | tenant_members | Notification prefs matrix |
| `/api/tenant/notification-prefs` | GET, PATCH | tenant_members | Per-user prefs |

---

### 2.4 Tenant Billing Routes

| Route | Methods | Tables Used | Description |
|-------|---------|-------------|-------------|
| `/api/tenant/invoices` | GET, POST | invoices, invoice_line_items | Invoice management |
| `/api/tenant/orders` | GET, POST | orders, order_line_items | Order management |
| `/api/tenant/orders/[id]` | GET, PUT, DELETE | orders, order_line_items | Single order |
| `/api/tenant/contracts` | GET, POST | contracts | Contract management |
| `/api/tenant/contracts/[id]` | GET, PUT, DELETE | contracts | Single contract |
| `/api/tenant/subscriptions` | GET, POST | subscriptions (billing.ts) | Service subscriptions |
| `/api/tenant/subscriptions/[id]` | GET, PUT, DELETE | subscriptions | Single subscription |
| `/api/tenant/services` | GET, POST | services | Service catalog |
| `/api/tenant/services/[id]` | GET, PATCH, DELETE | services | Single service |
| `/api/tenant/billing/checkout` | GET, POST | subscriptions (infra), plans | Stripe checkout |
| `/api/tenant/billing/invoices` | GET | billing_events | Billing invoices |
| `/api/tenant/billing/portal` | POST | tenants | Stripe portal |
| `/api/tenant/billing/stripe` | POST | tenants, subscriptions | Stripe webhook |
| `/api/tenant/billing/modules` | POST | tenant_modules | Module purchase |
| `/api/tenant/tax` | GET, POST | tax_rates | Tax rates |
| `/api/tenant/tax/calculate` | POST | tax_rates, tax_exemptions | Tax calculation |
| `/api/tenant/currency` | GET, POST | exchange_rates | Currency management |
| `/api/tenant/plans` | GET | plans | Available plans |

---

### 2.5 Tenant Automation & AI Routes

| Route | Methods | Tables Used | Description |
|-------|---------|-------------|-------------|
| `/api/tenant/automations` | GET, POST | automations | Legacy automation CRUD |
| `/api/tenant/automations/[id]` | GET, PATCH, DELETE | automations, automation_runs | Single automation |
| `/api/tenant/automation/workflows` | GET, PATCH | automation_workflows | Workflow configs |
| `/api/tenant/workflows` | GET, POST | workflows | Workflow builder |
| `/api/tenant/workflows/[id]` | GET, PATCH, DELETE, POST | workflows, workflow_actions | Single workflow |
| `/api/tenant/workflows/[id]/run` | POST | workflow_executions, workflow_action_logs | Execute workflow |
| `/api/tenant/sequences` | GET, POST | sequences | Email sequences |
| `/api/tenant/sequences/[id]` | GET, PATCH, DELETE | sequences, sequence_steps | Single sequence |
| `/api/tenant/ai` | POST | ai_usage_logs | General AI request |
| `/api/tenant/ai/draft` | POST | ai_activity, ai_draft_templates | AI email draft |
| `/api/tenant/ai/email-draft` | GET, POST | ai_email_drafts | AI email drafts |
| `/api/tenant/ai/insights` | GET, POST | ai_insights | AI insights |
| `/api/tenant/ai/score` | GET, POST | contact_scores, ai_usage_logs | Lead/contact scoring |
| `/api/tenant/ai/status` | GET | ai_activity, ai_module_configs | AI module status |
| `/api/tenant/ai/activity` | GET, PATCH | ai_activity | AI activity log |
| `/api/tenant/lead-warming/campaigns` | GET, POST | lead_warming_campaigns | Warming campaigns |
| `/api/tenant/lead-warming/campaigns/[id]` | GET, PATCH, DELETE | lead_warming_campaigns | Single campaign |
| `/api/tenant/lead-warming/events` | GET, POST | lead_warming_events | Event calendar |
| `/api/tenant/lead-warming/replies` | GET, POST | lead_warming_replies | Reply analysis |
| `/api/tenant/lead-warming/stats` | GET | lead_warming_messages, lead_warming_replies | Campaign stats |
| `/api/tenant/analytics/forecast` | GET, POST | deal_forecasts, revenue_forecast_summary | Revenue forecast |
| `/api/tenant/analytics/churn` | GET, POST, PATCH | churn_predictions | Churn analysis |
| `/api/tenant/analytics/stats` | GET | contacts, leads, deals | Dashboard stats |
| `/api/tenant/analytics/advanced` | GET | activities, deals | Advanced analytics |
| `/api/tenant/analytics/scheduled-reports` | GET, POST | scheduled_reports | Scheduled reports |
| `/api/tenant/reports` | GET | saved_reports | Report list |
| `/api/tenant/reports/[id]` | GET, PATCH, DELETE, POST | saved_reports, report_executions | Single report |
| `/api/tenant/reports/builder` | GET, POST | saved_reports | Report builder |
| `/api/tenant/reports/custom` | GET, POST, DELETE | saved_reports | Custom reports |
| `/api/tenant/reports/run` | POST | report_executions | Run a report |
| `/api/tenant/reports/scheduled` | GET, POST, PATCH, DELETE | scheduled_reports | Scheduled reports |

---

### 2.6 Tenant Admin/Settings Routes

| Route | Methods | Tables Used | Description |
|-------|---------|-------------|-------------|
| `/api/tenant/me` | GET | users, tenant_members | Current user info |
| `/api/tenant/workspace` | GET, POST, PATCH | tenants | Workspace settings |
| `/api/tenant/members` | GET, POST, PATCH | tenant_members, users | Team management |
| `/api/tenant/invite/send` | POST | invitations | Send invite |
| `/api/tenant/invite/[id]` | DELETE | invitations | Cancel invite |
| `/api/tenant/roles` | GET, POST | roles | Role management |
| `/api/tenant/roles/[id]` | PATCH, DELETE | roles | Single role |
| `/api/tenant/permissions/check` | POST | roles, field_permissions | Check permission |
| `/api/tenant/permissions/fields` | GET, POST | field_permissions | Field-level perms |
| `/api/tenant/permissions/approvals` | GET, POST | approval_requests | Approval rules |
| `/api/tenant/approvals` | GET | approval_requests | Pending approvals |
| `/api/tenant/approvals/[id]` | PATCH | approval_requests | Approve/reject |
| `/api/tenant/api-keys` | GET, POST | api_keys | API key management |
| `/api/tenant/api-keys/[id]` | GET, DELETE, POST | api_keys, api_key_usage | Single API key |
| `/api/tenant/branding` | GET, PUT | tenants | Branding settings |
| `/api/tenant/modules` | GET, POST, PATCH | tenant_modules, modules | Module management |
| `/api/tenant/modules/setup` | POST | tenant_modules | Module setup wizard |
| `/api/tenant/backup` | GET, POST | tenant_backup_records | Backup management |
| `/api/tenant/backup/config` | GET, PUT, DELETE | backup_schedules | Backup config |
| `/api/tenant/onboarding` | GET, POST, PATCH | onboarding_progress | Onboarding flow |
| `/api/tenant/onboarding/complete` | GET, POST | onboarding_progress | Complete onboarding |
| `/api/tenant/hierarchy` | GET, POST, PUT, DELETE | tenant_hierarchy, hierarchy_permissions | Hierarchy management |
| `/api/tenant/territories` | GET, POST, PUT, DELETE | territories, territory_assignments | Territory management |
| `/api/tenant/sla` | GET, POST | sla_policies | SLA policy management |
| `/api/tenant/sso` | GET, POST | sso_providers | SSO configuration |
| `/api/tenant/export` | GET | contacts, leads, deals | Data export |
| `/api/tenant/files` | GET, POST, DELETE | file_uploads, documents | File management |
| `/api/tenant/documents` | GET, POST, DELETE | documents, document_folders | Document management |
| `/api/tenant/esignature` | GET, POST | signing_requests | E-signature requests |
| `/api/tenant/esignature/webhook` | POST | signing_events | E-signature webhooks |
| `/api/tenant/visitors` | GET | visitors, page_views | Visitor tracking |
| `/api/tenant/visitors/track` | POST | visitors, page_views | Track visit |
| `/api/tenant/kb/articles` | GET, POST | kb_articles | KB articles |
| `/api/tenant/kb/articles/[id]` | GET, PATCH, DELETE, POST | kb_articles | Single article |
| `/api/tenant/kb/categories` | GET, POST | kb_categories | KB categories |
| `/api/tenant/kb/categories/[id]` | PATCH, DELETE | kb_categories | Single category |
| `/api/tenant/plugins` | GET, POST | custom_plugins | Plugin management |
| `/api/tenant/plugins/[id]` | GET, PATCH, DELETE | custom_plugins | Single plugin |
| `/api/tenant/plugins/[id]/execute` | POST | custom_plugins, plugin_execution_logs | Execute plugin |
| `/api/tenant/plugins/[id]/test` | POST | custom_plugins | Test plugin |
| `/api/tenant/plugins/[id]/logs` | GET | plugin_execution_logs | Plugin logs |
| `/api/tenant/plugins/webhook/[id]` | POST | custom_plugins | Plugin webhook |
| `/api/tenant/plugin-engine` | GET, POST, PATCH, DELETE | custom_plugins | Plugin engine |
| `/api/tenant/plugin-engine/actions` | POST | custom_plugins, plugin_execution_logs | Execute action |
| `/api/tenant/portal/clients` | GET, POST, DELETE | portal_clients | Client portal |
| `/api/tenant/portal/config` | GET, PUT | platform_settings | Portal config |
| `/api/tenant/portal/login` | GET, POST | portal_clients | Portal login |
| `/api/tenant/webhooks` | GET, POST | webhooks | Webhook management |
| `/api/tenant/webhooks/[id]` | PATCH, DELETE | webhooks | Single webhook |
| `/api/tenant/webhooks/[id]/deliveries` | GET | webhook_deliveries | Delivery history |
| `/api/tenant/webhooks/logs` | GET | webhook_inbound_logs | Webhook logs |
| `/api/tenant/webhooks/dlq` | GET, POST | dead_letter_queue | Dead letter queue |
| `/api/tenant/jobs/dead-letter` | GET, PATCH | dead_letter_queue | Job DLQ management |
| `/api/tenant/trash` | GET, PATCH, DELETE | (soft-deleted records) | Trash/restore |
| `/api/tenant/trash/settings` | GET, PUT | platform_settings | Trash settings |
| `/api/tenant/trash/auto-cleanup` | GET, POST | (soft-deleted records) | Auto-cleanup |
| `/api/tenant/dashboard` | GET | deals, contacts, activities | Dashboard data |
| `/api/tenant/dashboard/stats` | GET | leads, deals, contacts, tasks | Dashboard stats |
| `/api/tenant/usage-status` | GET | user_usage, plan_limits | Usage overview |
| `/api/tenant/settings-status` | GET | tenants, platform_settings | Settings status |
| `/api/tenant/subdomain/check` | GET | tenants | Check subdomain availability |
| `/api/tenant/2fa/setup` | POST | users | Setup 2FA |
| `/api/tenant/2fa/verify` | POST | users | Verify 2FA |
| `/api/tenant/2fa/disable` | POST | users | Disable 2FA |
| `/api/tenant/assignment-rules` | GET, POST, PUT, DELETE | assignment_rules | Auto-assignment |
| `/api/tenant/admin/ai-providers` | GET, PATCH, DELETE | ai_provider_secrets | AI API keys |
| `/api/tenant/admin/ai-templates` | GET, POST | ai_draft_templates | AI templates |
| `/api/tenant/admin/ai-templates/[id]` | GET, PATCH, DELETE | ai_draft_templates | Single AI template |
| `/api/tenant/admin/bulk-transfer` | GET, POST | contacts, leads, deals | Bulk ownership transfer |
| `/api/tenant/admin/localization` | GET, PATCH | platform_settings | Locale settings |
| `/api/tenant/admin/login-policy` | GET, PATCH | platform_settings | Login policy |
| `/api/tenant/admin/picklists` | GET, PATCH | platform_settings | Picklist values |
| `/api/tenant/admin/tags` | GET, POST | tags | Tag management |
| `/api/tenant/admin/user-defaults` | GET, PATCH, DELETE | platform_settings | User defaults |
| `/api/tenant/compliance/gdpr` | GET, POST | compliance_requests | GDPR requests |
| `/api/tenant/compliance/retention` | GET, POST, PUT | data_retention_policies | Retention policies |
| `/api/tenant/compliance/soc2` | GET, POST | compliance_requests | SOC 2 reports |
| `/api/tenant/industry-templates` | POST | product_templates, tenant_templates | Apply template |

---

### 2.7 Superadmin Routes

| Route | Methods | Tables Used | Description |
|-------|---------|-------------|-------------|
| `/api/superadmin/me` | GET | users | Current super admin info |
| `/api/superadmin/stats` | GET | tenants, users, deals | Platform stats |
| `/api/superadmin/tenants` | GET, POST, PATCH, DELETE | tenants, tenant_members | Tenant management |
| `/api/superadmin/tenants/[id]` | GET | tenants, tenant_members | Single tenant detail |
| `/api/superadmin/tenants/[id]/modules` | GET, POST | tenant_modules | Tenant modules |
| `/api/superadmin/users` | GET, POST, PATCH, DELETE | users | User management |
| `/api/superadmin/user-data` | GET, POST, DELETE | users, tenants | User data management |
| `/api/superadmin/plans` | GET, POST, PATCH, DELETE | plans | Plan management |
| `/api/superadmin/billing` | GET | billing_events, subscriptions | Billing overview |
| `/api/superadmin/revenue` | GET | billing_events | Revenue reports |
| `/api/superadmin/usage` | GET | usage_snapshots, user_usage | Usage reports |
| `/api/superadmin/modules` | GET, PATCH | modules | Module registry |
| `/api/superadmin/settings` | GET, POST | system_settings, platform_settings | Platform settings |
| `/api/superadmin/announcements` | GET, POST, PATCH, DELETE | announcements | Announcements |
| `/api/superadmin/health` | GET | health_checks | System health |
| `/api/superadmin/monitoring` | GET | health_checks, error_logs | Monitoring dashboard |
| `/api/superadmin/errors` | GET, POST, PATCH | error_logs | Error management |
| `/api/superadmin/tickets` | GET, POST, PATCH | support_tickets | Support tickets |
| `/api/superadmin/backups` | GET, POST, PATCH | super_admin_backups, backup_records | Backups |
| `/api/superadmin/restore` | GET, POST | tenant_restores | Restore operations |
| `/api/superadmin/selective-restore/backups` | GET, POST, DELETE | tenant_backup_records | Selective restore |
| `/api/superadmin/selective-restore/preview` | POST | tenant_backup_records | Preview restore |
| `/api/superadmin/selective-restore/execute` | POST | tenant_restore_records | Execute restore |
| `/api/superadmin/selective-restore/rollback` | POST | selective_restore_audit_log | Rollback restore |
| `/api/superadmin/selective-restore/scope` | POST | tenant_backup_records | Restore scope |
| `/api/superadmin/selective-restore/users` | GET | users | Users for restore |
| `/api/superadmin/impersonate` | POST | impersonation_sessions | Start impersonation |
| `/api/superadmin/impersonate/stop` | GET, POST | impersonation_sessions | Stop impersonation |
| `/api/superadmin/join-tenant` | GET, POST | tenant_members | Join a tenant |
| `/api/superadmin/transfer-admin` | POST | tenants, tenant_members | Transfer admin role |
| `/api/superadmin/token-control` | GET, POST | token_budgets, tenant_token_limits | Token budget control |
| `/api/superadmin/adoption` | GET | tenant_modules, tenants | Module adoption |
| `/api/superadmin/data-explorer` | GET, PUT, DELETE | (dynamic) | Data explorer |
| `/api/superadmin/recent-activity` | GET | audit_logs, activities | Recent activity |
| `/api/superadmin/tenant-settings` | GET | tenants, platform_settings | Tenant settings |
| `/api/superadmin/templates` | GET, POST | product_templates | Template management |
| `/api/superadmin/templates/[id]` | GET, PATCH, DELETE | product_templates | Single template |
| `/api/superadmin/templates/[id]/assign` | POST | tenant_templates | Assign template |
| `/api/super-admin/tenants` | GET | tenants | (DUPLICATE PATH) |
| `/api/super-admin/audit-logs` | GET | audit_logs | (DUPLICATE PATH) |

---

### 2.8 Public Routes

| Route | Methods | Tables Used | Description |
|-------|---------|-------------|-------------|
| `/api/public/invoices` | GET | invoices | Public invoice view |
| `/api/public/tickets` | GET, POST | support_tickets | Public ticket submission |
| `/api/public/kb/articles` | GET | kb_articles | Public KB articles |
| `/api/public/kb/articles/[id]` | GET | kb_articles | Single public article |
| `/api/public/offers/[publicToken]` | GET | quotes | View public offer |
| `/api/public/offers/[publicToken]/accept` | POST | quotes | Accept offer |
| `/api/public/offers/[publicToken]/decline` | POST | quotes | Decline offer |
| `/api/leads/public` | GET, POST | leads, forms | Public lead capture |
| `/api/forms` | POST | forms, form_submissions | Form creation |
| `/api/forms/submit` | POST | form_submissions, leads, contacts | Form submission |
| `/api/embed/form.js` | GET | - | Embeddable form script |
| `/api/health` | GET | - | Health check |
| `/api/keepalive` | GET, POST | - | Keep-alive ping |
| `/api/metrics` | GET | - | Prometheus metrics |
| `/api/openapi` | GET | - | OpenAPI spec |
| `/api/setup/check` | GET | system_settings | First-run check |
| `/api/setup/create-admin` | POST | users, tenants | First admin setup |
| `/api/test` | GET | - | Test endpoint |
| `/api/test-email` | GET, POST | - | Email test |

---

### 2.9 Cron Routes

| Route | Methods | Tables Used | Description |
|-------|---------|-------------|-------------|
| `/api/cron/backup` | POST | tenant_backups | Scheduled backup |
| `/api/cron/auto-backup` | GET, POST | tenant_backup_records, backup_schedules | Auto backup |
| `/api/cron/backup-health` | POST | backup_alerts | Backup health check |
| `/api/cron/cleanup` | POST | (soft-deleted records) | Data cleanup |
| `/api/cron/lead-warming` | POST | lead_warming_campaigns, lead_warming_messages | Send warming messages |
| `/api/cron/process-sequences` | POST | sequence_enrollments, sequence_step_logs | Process sequence steps |
| `/api/cron/retry-webhooks` | POST | webhook_queue, failed_webhooks | Retry failed webhooks |
| `/api/cron/subscription-check` | POST | tenants, subscriptions | Check expired subs |
| `/api/cron/task-reminders` | POST | tasks, notifications | Task due reminders |
| `/api/cron/trial-check` | POST | tenants | Check expired trials |
| `/api/cron/usage-snapshot` | POST | usage_snapshots | Daily usage snapshot |
| `/api/cron/warmup-emails` | POST | email_warmup_configs, email_warmup_logs | Email warmup sends |

---

### 2.10 Webhook Routes

| Route | Methods | Tables Used | Description |
|-------|---------|-------------|-------------|
| `/api/webhooks/stripe` | POST | billing_events, subscriptions, tenants | Stripe webhook handler |
| `/api/webhooks/whatsapp` | GET, POST | whatsapp_messages, whatsapp_conversations | WhatsApp webhook |
| `/api/webhooks/resend` | POST | email_log | Resend email webhook |
| `/api/webhooks/inbound` | GET, POST | webhook_inbound_logs | Inbound webhook handler |
| `/api/track/open` | GET | email_tracking, email_opens | Email open tracking pixel |
| `/api/track/click` | GET | email_tracking, email_clicks | Email click tracking |
| `/api/unsubscribe` | GET | contacts | Email unsubscribe |

---

### 2.11 User Routes

| Route | Methods | Tables Used | Description |
|-------|---------|-------------|-------------|
| `/api/user/profile` | PATCH | users | Update profile |
| `/api/user/password` | PATCH | users | Change password |
| `/api/user/preferences` | GET, PATCH, DELETE | users, platform_settings | User preferences |
| `/api/user/sessions` | GET, DELETE | sessions | Session management |
| `/api/user/telegram` | GET, PATCH | users | Telegram config |
| `/api/user/out-of-office` | GET, PATCH | tenant_members | OOO settings |
| `/api/user/export` | GET | users, contacts, leads | User data export |

---

### 2.12 Misc Routes

| Route | Methods | Tables Used | Description |
|-------|---------|-------------|-------------|
| `/api/admin/2fa/disable` | POST | users | Admin disable 2FA |
| `/api/admin/tenant-restore` | GET, POST, PUT, DELETE | tenant_restores, tenant_backups | Admin restore |
| `/api/dev/dashboard` | GET, POST | - | Dev dashboard |
| `/api/emergency/recover` | GET, POST | users, tenants | Emergency recovery |
| `/api/v2` | GET | - | API v2 index |
| `/api/v2/[...path]` | GET, POST, PUT, PATCH, DELETE | (dynamic) | API v2 proxy |

---


## 3. Frontend Pages

### 3.1 Tenant Pages

All tenant pages are at `app/tenant/` and require authentication + tenant context.

#### Core CRM

| Page Path | Description | Key API Routes |
|-----------|-------------|----------------|
| `/tenant/dashboard` | Main dashboard with stats, charts, pipeline view | `/api/tenant/dashboard`, `/api/tenant/dashboard/stats` |
| `/tenant/leads` | Lead list with filters, search, kanban view | `/api/tenant/leads` |
| `/tenant/leads/[id]` | Lead detail with activities, notes, conversion | `/api/tenant/leads/[id]`, `/api/tenant/leads/history` |
| `/tenant/contacts` | Contact list with advanced filters | `/api/tenant/contacts` |
| `/tenant/contacts/[id]` | Contact detail with timeline, notes, deals | `/api/tenant/contacts/[id]`, `/api/tenant/contacts/[id]/timeline` |
| `/tenant/companies` | Company list | `/api/tenant/companies` |
| `/tenant/companies/[id]` | Company detail with contacts, deals | `/api/tenant/companies/[id]` |
| `/tenant/deals` | Deal list view | `/api/tenant/deals` |
| `/tenant/deals/[id]` | Deal detail with products, quotes, timeline | `/api/tenant/deals/[id]` |
| `/tenant/deals/kanban` | Kanban board for deals by pipeline stage | `/api/tenant/deals`, `/api/tenant/pipelines` |
| `/tenant/tasks` | Task list | `/api/tenant/tasks` |
| `/tenant/tasks/[id]` | Task detail | `/api/tenant/tasks/[id]` |
| `/tenant/tasks/kanban` | Task kanban board | `/api/tenant/tasks` |

#### Communication

| Page Path | Description | Key API Routes |
|-----------|-------------|----------------|
| `/tenant/chat` | Live chat with website visitors | `/api/tenant/chat`, `/api/tenant/chat/[sessionId]/messages` |
| `/tenant/calls` | Call log and recording management | `/api/tenant/calls` |
| `/tenant/sms` | SMS conversation view | `/api/tenant/sms` |
| `/tenant/email-templates` | Email template editor | `/api/tenant/email-templates` |
| `/tenant/notifications` | Notification center | `/api/tenant/notifications` |
| `/tenant/calendar` | Calendar with meetings and tasks | `/api/tenant/meetings`, `/api/tenant/tasks` |

#### Billing & Commerce

| Page Path | Description | Key API Routes |
|-----------|-------------|----------------|
| `/tenant/invoices` | Invoice management | `/api/tenant/invoices` |
| `/tenant/quotes` | Quote list | `/api/tenant/quotes` |
| `/tenant/quotes/[id]` | Quote detail with line items | `/api/tenant/quotes/[id]` |
| `/tenant/orders` | Order management | `/api/tenant/orders` |
| `/tenant/orders/[id]` | Order detail | `/api/tenant/orders/[id]` |
| `/tenant/contracts` | Contract management | `/api/tenant/contracts` |
| `/tenant/contracts/[id]` | Contract detail | `/api/tenant/contracts/[id]` |
| `/tenant/subscriptions` | Subscription management | `/api/tenant/subscriptions` |
| `/tenant/subscriptions/[id]` | Subscription detail | `/api/tenant/subscriptions/[id]` |
| `/tenant/products` | Product catalog | `/api/tenant/products` (implied) |
| `/tenant/products/[templateId]` | Product template detail | - |
| `/tenant/services` | Service catalog | `/api/tenant/services` |
| `/tenant/offers` | Sent offers/proposals | `/api/tenant/offers` |
| `/tenant/offers/[id]` | Offer detail | `/api/tenant/offers` |

#### AI & Automation

| Page Path | Description | Key API Routes |
|-----------|-------------|----------------|
| `/tenant/ai` | AI Hub - overview of AI features | `/api/tenant/ai/status` |
| `/tenant/ai/draft` | AI email draft generation | `/api/tenant/ai/draft` |
| `/tenant/ai/lead-scoring` | AI lead scoring configuration | `/api/tenant/ai/score` |
| `/tenant/ai/at-risk` | At-risk contact detection | `/api/tenant/analytics/churn` |
| `/tenant/ai/activity` | AI activity log | `/api/tenant/ai/activity` |
| `/tenant/ai/summarize` | AI summarization tool | `/api/tenant/ai` |
| `/tenant/automation` | Automation list | `/api/tenant/automations` |
| `/tenant/automation/builder` | Visual workflow builder | `/api/tenant/workflows` |
| `/tenant/automation/sequences` | Email sequences | `/api/tenant/sequences` |
| `/tenant/sequences` | Sequence management | `/api/tenant/sequences` |

#### Analytics & Reports

| Page Path | Description | Key API Routes |
|-----------|-------------|----------------|
| `/tenant/analytics` | Analytics overview | `/api/tenant/analytics/stats` |
| `/tenant/analytics/email` | Email analytics (opens, clicks) | `/api/tenant/email/track` |
| `/tenant/analytics/forecast` | Revenue forecasting | `/api/tenant/analytics/forecast` |
| `/tenant/reports` | Report list | `/api/tenant/reports` |
| `/tenant/reports/builder` | Report builder | `/api/tenant/reports/builder` |
| `/tenant/reports/custom` | Custom reports | `/api/tenant/reports/custom` |
| `/tenant/reports/scheduled` | Scheduled reports | `/api/tenant/reports/scheduled` |
| `/tenant/leaderboards` | Sales leaderboard | `/api/tenant/leaderboards` |

#### Forms & Content

| Page Path | Description | Key API Routes |
|-----------|-------------|----------------|
| `/tenant/forms` | Form list | `/api/tenant/forms` |
| `/tenant/forms/builder` | Form builder | `/api/tenant/forms` |
| `/tenant/forms/public/[id]` | Public form preview | `/api/tenant/forms/public/[id]` |
| `/tenant/docs` | Documentation page | - |
| `/tenant/documents` | Document management | `/api/tenant/documents` |
| `/tenant/esignature` | E-signature requests | `/api/tenant/esignature` |
| `/tenant/kb` | Knowledge base | `/api/tenant/kb/articles` |
| `/tenant/kb/[id]` | KB article detail | `/api/tenant/kb/articles/[id]` |
| `/tenant/kb/categories` | KB categories | `/api/tenant/kb/categories` |

#### Projects

| Page Path | Description | Key API Routes |
|-----------|-------------|----------------|
| `/tenant/projects` | Project list | `/api/tenant/projects` |
| `/tenant/projects/[id]` | Project detail with milestones | `/api/tenant/projects/[id]`, `/api/tenant/projects/[id]/milestones` |

#### Support

| Page Path | Description | Key API Routes |
|-----------|-------------|----------------|
| `/tenant/tickets` | Ticket list | `/api/tenant/tickets` |
| `/tenant/tickets/[id]` | Ticket detail with replies | `/api/tenant/tickets/[id]`, `/api/tenant/tickets/[id]/replies` |
| `/tenant/tickets/kanban` | Ticket kanban view | `/api/tenant/tickets` |

#### Settings

| Page Path | Description | Key API Routes |
|-----------|-------------|----------------|
| `/tenant/settings` | Settings overview | `/api/tenant/settings-status` |
| `/tenant/settings/general` | General workspace settings | `/api/tenant/workspace` |
| `/tenant/settings/profile` | User profile | `/api/user/profile` |
| `/tenant/settings/team` | Team members | `/api/tenant/members` |
| `/tenant/settings/roles` | Role management | `/api/tenant/roles` |
| `/tenant/settings/rbac` | RBAC configuration | `/api/tenant/permissions/fields` |
| `/tenant/settings/billing` | Billing settings | `/api/tenant/billing/checkout` |
| `/tenant/settings/billing/invoices` | Billing invoices | `/api/tenant/billing/invoices` |
| `/tenant/settings/branding` | Branding/theme | `/api/tenant/branding` |
| `/tenant/settings/pipelines` | Pipeline configuration | `/api/tenant/pipelines` |
| `/tenant/settings/custom-fields` | Custom fields | `/api/tenant/custom-fields` |
| `/tenant/settings/email` | Email configuration | `/api/tenant/integrations` |
| `/tenant/settings/integrations` | Third-party integrations | `/api/tenant/integrations` |
| `/tenant/settings/webhooks` | Webhook management | `/api/tenant/webhooks` |
| `/tenant/settings/webhooks/logs` | Webhook logs | `/api/tenant/webhooks/logs` |
| `/tenant/settings/api-keys` | API key management | `/api/tenant/api-keys` |
| `/tenant/settings/notifications` | Notification preferences | `/api/tenant/notification-prefs` |
| `/tenant/settings/security` | Security settings | `/api/tenant/2fa/setup` |
| `/tenant/settings/sessions` | Active sessions | `/api/user/sessions` |
| `/tenant/settings/sso` | SSO configuration | `/api/tenant/sso` |
| `/tenant/settings/sla` | SLA policies | `/api/tenant/sla` |
| `/tenant/settings/territories` | Territory management | `/api/tenant/territories` |
| `/tenant/settings/hierarchy` | Tenant hierarchy | `/api/tenant/hierarchy` |
| `/tenant/settings/lead-scoring` | Lead scoring rules | `/api/tenant/ai/score` |
| `/tenant/settings/assignment-rules` | Auto-assignment | `/api/tenant/assignment-rules` |
| `/tenant/settings/at-risk-rules` | Churn risk rules | `/api/tenant/analytics/churn` |
| `/tenant/settings/import-export` | Import/export tools | `/api/tenant/export` |
| `/tenant/settings/backup` | Backup management | `/api/tenant/backup` |
| `/tenant/settings/audit` | Audit log viewer | `/api/super-admin/audit-logs` |
| `/tenant/settings/compliance` | Compliance tools | `/api/tenant/compliance/gdpr` |
| `/tenant/settings/tags-manager` | Tag management | `/api/tenant/admin/tags` |
| `/tenant/settings/picklists` | Picklist values | `/api/tenant/admin/picklists` |
| `/tenant/settings/tax` | Tax configuration | `/api/tenant/tax` |
| `/tenant/settings/currency` | Currency settings | `/api/tenant/currency` |
| `/tenant/settings/preferences` | User preferences | `/api/user/preferences` |
| `/tenant/settings/localization` | Locale/language | `/api/tenant/admin/localization` |
| `/tenant/settings/login-policy` | Login policy | `/api/tenant/admin/login-policy` |
| `/tenant/settings/admin` | Admin settings | `/api/tenant/workspace` |
| `/tenant/settings/ai-providers` | AI provider keys | `/api/tenant/admin/ai-providers` |
| `/tenant/settings/ai-templates` | AI draft templates | `/api/tenant/admin/ai-templates` |
| `/tenant/settings/ai-activity` | AI activity monitor | `/api/tenant/ai/activity` |
| `/tenant/settings/bulk-transfer` | Bulk ownership transfer | `/api/tenant/admin/bulk-transfer` |
| `/tenant/settings/user-defaults` | User default settings | `/api/tenant/admin/user-defaults` |
| `/tenant/settings/out-of-office` | Out of office | `/api/user/out-of-office` |
| `/tenant/settings/portal` | Client portal config | `/api/tenant/portal/config` |
| `/tenant/settings/telegram` | Telegram integration | `/api/user/telegram` |
| `/tenant/settings/industry-templates` | Industry templates | `/api/tenant/industry-templates` |

#### Misc Tenant Pages

| Page Path | Description | Key API Routes |
|-----------|-------------|----------------|
| `/tenant/search` | Global search results | `/api/tenant/search` |
| `/tenant/approvals` | Approval requests | `/api/tenant/approvals` |
| `/tenant/modules` | Module marketplace | `/api/tenant/modules` |
| `/tenant/plugins` | Plugin management | `/api/tenant/plugins` |
| `/tenant/integrations` | Integrations hub | `/api/tenant/integrations` |
| `/tenant/integrations/connected` | Connected integrations | `/api/tenant/integrations` |
| `/tenant/integrations/webhooks` | Webhook integrations | `/api/tenant/webhooks` |
| `/tenant/visitors` | Visitor tracking | `/api/tenant/visitors` |
| `/tenant/onboarding` | Onboarding wizard | `/api/tenant/onboarding` |
| `/tenant/trash` | Trash/recycle bin | `/api/tenant/trash` |
| `/tenant/trial-expired` | Trial expired page | - |

---

### 3.2 Superadmin Pages

All superadmin pages are at `app/superadmin/` and require `is_super_admin = true`.

| Page Path | Description | Key API Routes |
|-----------|-------------|----------------|
| `/superadmin/dashboard` | Platform overview dashboard | `/api/superadmin/stats`, `/api/superadmin/recent-activity` |
| `/superadmin/tenants` | Tenant list and management | `/api/superadmin/tenants` |
| `/superadmin/tenants/[id]/settings` | Tenant settings | `/api/superadmin/tenant-settings` |
| `/superadmin/tenants/[id]/modules` | Tenant modules | `/api/superadmin/tenants/[id]/modules` |
| `/superadmin/tenants/[id]/roles` | Tenant roles | `/api/superadmin/tenants/[id]` |
| `/superadmin/users` | All users management | `/api/superadmin/users` |
| `/superadmin/billing` | Billing overview | `/api/superadmin/revenue` |
| `/superadmin/revenue` | Revenue analytics | `/api/superadmin/revenue` |
| `/superadmin/usage` | Usage analytics | `/api/superadmin/usage` |
| `/superadmin/modules` | Module registry | `/api/superadmin/modules` |
| `/superadmin/settings` | Platform settings | `/api/superadmin/settings` |
| `/superadmin/announcements` | Announcement management | `/api/superadmin/announcements` |
| `/superadmin/health` | System health | `/api/superadmin/health` |
| `/superadmin/monitoring` | Platform monitoring | `/api/superadmin/monitoring` |
| `/superadmin/errors` | Error log viewer | `/api/superadmin/errors` |
| `/superadmin/tickets` | Support tickets | `/api/superadmin/tickets` |
| `/superadmin/backups` | Backup management | `/api/superadmin/backups` |
| `/superadmin/selective-restore` | Selective restore tool | `/api/superadmin/selective-restore/*` |
| `/superadmin/analytics` | Platform analytics | `/api/superadmin/stats` |
| `/superadmin/adoption` | Module adoption metrics | `/api/superadmin/adoption` |
| `/superadmin/data-explorer` | Database explorer | `/api/superadmin/data-explorer` |
| `/superadmin/templates` | Template management | `/api/superadmin/templates` |
| `/superadmin/templates/[id]` | Template editor | `/api/superadmin/templates/[id]` |
| `/superadmin/token-control` | AI token budget control | `/api/superadmin/token-control` |

---


## 4. UI Actions Map

This section maps key user interface actions to their API endpoints and database tables.

### 4.1 Leads Page (`/tenant/leads`)

| Button/Action | API Route | HTTP Method | Table(s) Affected |
|---------------|-----------|-------------|-------------------|
| Create Lead | `/api/tenant/leads` | POST | leads, lead_activities |
| Edit Lead | `/api/tenant/leads/[id]` | PATCH | leads, edit_history |
| Delete Lead | `/api/tenant/leads/[id]` | DELETE | leads (soft delete) |
| Assign Lead | `/api/tenant/leads/assign` | POST | leads, lead_assignments |
| Convert to Contact | `/api/tenant/leads/[id]/convert` | POST | leads, contacts, deals |
| Import Leads | `/api/tenant/leads/import` | POST | leads |
| Bulk Delete | `/api/tenant/leads/bulk` | POST | leads |
| Bulk Assign | `/api/tenant/leads/bulk` | POST | leads, lead_assignments |
| Filter by Status | `/api/tenant/leads?lead_status=X` | GET | leads |
| Search | `/api/tenant/leads?q=X` | GET | leads |
| Sort | `/api/tenant/leads?sort_by=X&sort_order=Y` | GET | leads |
| View History | `/api/tenant/leads/history` | GET | lead_activities, edit_history |

### 4.2 Contacts Page (`/tenant/contacts`)

| Button/Action | API Route | HTTP Method | Table(s) Affected |
|---------------|-----------|-------------|-------------------|
| Create Contact | `/api/tenant/contacts` | POST | contacts |
| Edit Contact | `/api/tenant/contacts/[id]` | PATCH | contacts, edit_history |
| Delete Contact | `/api/tenant/contacts/[id]` | DELETE | contacts (soft delete) |
| Import Contacts | `/api/tenant/contacts/import` | POST | contacts |
| Export Contacts | `/api/tenant/contacts/export` | GET | contacts |
| Merge Contacts | `/api/tenant/contacts/merge` | POST | contacts, contact_merge_history |
| Find Duplicates | `/api/tenant/contacts/duplicates` | POST | contacts |
| Bulk Actions | `/api/tenant/contacts/bulk` | POST | contacts |
| Add Note | `/api/tenant/contacts/[id]/notes` | POST | notes |
| Change Lifecycle | `/api/tenant/contacts/[id]/lifecycle` | POST | contact_lifecycle_history |
| Enroll in Sequence | `/api/tenant/contacts/[id]/enroll` | POST | sequence_enrollments |
| View Timeline | `/api/tenant/contacts/[id]/timeline` | GET | activities |

### 4.3 Deals Page (`/tenant/deals`)

| Button/Action | API Route | HTTP Method | Table(s) Affected |
|---------------|-----------|-------------|-------------------|
| Create Deal | `/api/tenant/deals` | POST | deals |
| Edit Deal | `/api/tenant/deals/[id]` | PATCH | deals, edit_history |
| Delete Deal | `/api/tenant/deals/[id]` | DELETE | deals (soft delete) |
| Move Stage (Kanban) | `/api/tenant/deals/[id]` | PATCH | deals |
| Bulk Operations | `/api/tenant/deals/bulk` | POST | deals |
| Create Quote | `/api/tenant/quotes` | POST | quotes, quote_line_items |
| View Pipeline | `/api/tenant/pipelines` | GET | pipelines, deal_stages |

### 4.4 Tasks Page (`/tenant/tasks`)

| Button/Action | API Route | HTTP Method | Table(s) Affected |
|---------------|-----------|-------------|-------------------|
| Create Task | `/api/tenant/tasks` | POST | tasks |
| Edit Task | `/api/tenant/tasks/[id]` | PATCH | tasks |
| Complete Task | `/api/tenant/tasks/[id]` | PATCH | tasks |
| Delete Task | `/api/tenant/tasks/[id]` | DELETE | tasks (soft delete) |
| Bulk Complete | `/api/tenant/tasks/bulk` | POST | tasks |
| Assign Task | `/api/tenant/tasks/[id]` | PATCH | tasks |

### 4.5 Tickets Page (`/tenant/tickets`)

| Button/Action | API Route | HTTP Method | Table(s) Affected |
|---------------|-----------|-------------|-------------------|
| Create Ticket | `/api/tenant/tickets` | POST | support_tickets |
| Update Status | `/api/tenant/tickets/[id]` | PATCH | support_tickets |
| Assign Ticket | `/api/tenant/tickets/[id]` | PATCH | support_tickets |
| Reply to Ticket | `/api/tenant/tickets/[id]/replies` | POST | ticket_replies |
| Resolve Ticket | `/api/tenant/tickets/[id]` | PATCH | support_tickets |
| Delete Ticket | `/api/tenant/tickets/[id]` | DELETE | support_tickets (soft delete) |

### 4.6 Invoices Page (`/tenant/invoices`)

| Button/Action | API Route | HTTP Method | Table(s) Affected |
|---------------|-----------|-------------|-------------------|
| Create Invoice | `/api/tenant/invoices` | POST | invoices, invoice_line_items |
| Send Invoice | `/api/tenant/invoices` | POST (status update) | invoices |
| Record Payment | `/api/tenant/invoices` | POST | invoice_payments |
| View Invoice | `/api/tenant/invoices` | GET | invoices, invoice_line_items |

### 4.7 Settings Pages

| Button/Action | Page | API Route | Table(s) Affected |
|---------------|------|-----------|-------------------|
| Update Branding | settings/branding | `/api/tenant/branding` PUT | tenants |
| Create Role | settings/roles | `/api/tenant/roles` POST | roles |
| Invite Member | settings/team | `/api/tenant/invite/send` POST | invitations |
| Remove Member | settings/team | `/api/tenant/members` PATCH | tenant_members |
| Create Pipeline | settings/pipelines | `/api/tenant/pipelines` POST | pipelines, deal_stages |
| Add Custom Field | settings/custom-fields | `/api/tenant/custom-fields` POST | custom_field_defs |
| Create Webhook | settings/webhooks | `/api/tenant/webhooks` POST | webhooks |
| Generate API Key | settings/api-keys | `/api/tenant/api-keys` POST | api_keys |
| Configure SSO | settings/sso | `/api/tenant/sso` POST | sso_providers |
| Set SLA Policy | settings/sla | `/api/tenant/sla` POST | sla_policies |
| Create Territory | settings/territories | `/api/tenant/territories` POST | territories |
| Configure AI | settings/ai-providers | `/api/tenant/admin/ai-providers` PATCH | ai_provider_secrets |
| Create Backup | settings/backup | `/api/tenant/backup` POST | tenant_backup_records |

---

## 5. Data Flow Connections

### 5.1 Lead Capture Flow

```
[Website Form] -> POST /api/forms/submit -> form_submissions table
                                         -> leads table (auto-create)
                                         -> lead_activities table (log)

[Public API]   -> POST /api/leads/public -> leads table
                                         -> lead_activities table

[Manual Entry] -> POST /api/tenant/leads -> leads table
                                         -> lead_activities table
                                         -> audit_logs table

[Import CSV]   -> POST /api/tenant/leads/import -> leads table (bulk)
```

### 5.2 Lead Conversion Flow

```
[Lead Detail Page] -> "Convert" button
    -> POST /api/tenant/leads/[id]/convert
        -> leads table (mark is_converted=true, set converted_contact_id)
        -> contacts table (create new contact from lead data)
        -> deals table (optionally create deal)
        -> lead_activities table (log conversion)
        -> audit_logs table
```

### 5.3 Deal Pipeline Flow

```
contacts table -> deal created -> deals table (stage_id = first stage)
                               -> deal_stages table (lookup)
                               -> pipelines table (lookup)

[Kanban Drag] -> PATCH /api/tenant/deals/[id] (stage_id change)
              -> deals table
              -> activities table (stage change logged)
              -> edit_history table

[Close Won]   -> deals table (final stage)
              -> revenue_projections table (actual)
              -> deal_forecasts table (mark resolved)
```

### 5.4 Quote to Invoice Flow

```
deals table -> "Create Quote" -> quotes table + quote_line_items table
           -> "Send Offer"    -> POST /api/tenant/offers/[quoteId]/send
                              -> quotes.status = 'sent'

[Client accepts] -> POST /api/public/offers/[token]/accept
                 -> quotes.status = 'accepted'

[Create Invoice] -> POST /api/tenant/invoices
                 -> invoices table (linked to quote)
                 -> invoice_line_items table

[Record Payment] -> invoice_payments table
                 -> invoices.amount_paid updated
                 -> invoices.status = 'paid'
```

### 5.5 Communication Flow

```
[Send WhatsApp] -> POST /api/tenant/whatsapp/send
                -> whatsapp_conversations table
                -> whatsapp_messages table
                -> activities table (log)

[Send Email]    -> POST /api/tenant/ai/email-draft (AI draft)
                -> ai_email_drafts table
                -> email_log table (on send)
                -> email_tracking table (tracking pixel)

[Incoming Call] -> POST /api/tenant/calls
                -> call_logs table
                -> voice_calls table (if VoIP)
                -> activities table
```

### 5.6 Automation Flow

```
[Trigger Event] -> workflow_executions table (new execution)
                -> workflow_actions table (iterate actions)
                -> workflow_action_logs table (log each step)

Actions can produce:
  -> email_log (send email)
  -> whatsapp_messages (send WhatsApp)
  -> notifications (notify user)
  -> contacts/leads/deals (update field)
  -> tasks (create task)
```

### 5.7 Email Sequence Flow

```
[Enroll Contact] -> POST /api/tenant/contacts/[id]/enroll
                 -> sequence_enrollments table

[Cron: process-sequences] -> sequence_enrollments (find due)
                          -> sequence_steps (get next step)
                          -> sequence_step_logs (log execution)
                          -> email_log (send email)
                          -> email_tracking (track)

[Contact replies/opens] -> email_tracking table (update)
                        -> sequence_enrollments (may pause/complete)
```

### 5.8 Lead Warming Flow

```
[Campaign Active] -> lead_warming_campaigns table

[Cron: lead-warming] -> Find eligible contacts via lead_warming_schedule
                     -> Generate message (AI or template)
                     -> lead_warming_messages table (log sent)
                     -> email_log OR sms_messages (deliver)

[Reply Received] -> lead_warming_replies table
                 -> AI analysis (intent, sentiment)
                 -> notifications table (notify owner)
                 -> tasks table (create follow-up if needed)
```

### 5.9 Visitor Tracking Flow

```
[Website Visitor] -> POST /api/tenant/visitors/track
                  -> visitors table (create/update)
                  -> page_views table

[Identification] -> visitors.identified_contact_id linked to contacts
                 -> contact score updated in contact_scores table
```

### 5.10 Backup & Restore Flow

```
[Manual Backup]  -> POST /api/tenant/backup
                 -> tenant_backup_records table (status: running)
                 -> Data serialized to backup_data JSONB
                 -> tenant_backup_records (status: completed)

[Auto Backup]    -> POST /api/cron/auto-backup
                 -> backup_schedules table (check due)
                 -> tenant_backup_records (create)

[Restore]        -> POST /api/superadmin/selective-restore/execute
                 -> tenant_restore_records table
                 -> selective_restore_audit_log table
                 -> Target tables restored
```

---


## 6. Gaps & Issues

> **Status Update:** Following a comprehensive fix pass, the majority of critical issues have been resolved. Route naming inconsistencies now use redirects to canonical paths, missing FK constraints have been added, new CRUD API routes cover previously schema-only features (price books, service categories, segments, products), and API validation gaps have been closed. Remaining open items are primarily internal/system tables that do not require public CRUD endpoints, and architectural decisions (duplicate naming patterns, legacy tagging) that need broader migration planning.

After thoroughly mapping the schema, API routes, and frontend pages, here are the concrete problems identified:

### 6.1 Duplicate Route Paths (Naming Inconsistency)

| Issue | Files | Status |
|-------|-------|--------|
| `/api/super-admin/tenants` duplicates `/api/superadmin/tenants` | `app/api/super-admin/tenants/route.ts` vs `app/api/superadmin/tenants/route.ts` | **[RESOLVED]** `/api/super-admin/tenants` now redirects to canonical `/api/superadmin/tenants` |
| `/api/super-admin/audit-logs` has no counterpart at `/api/superadmin/audit-logs` | `app/api/super-admin/audit-logs/route.ts` | **[RESOLVED]** New canonical route at `/api/superadmin/audit-logs`; legacy path redirects |
| Two different subscriptions tables in schema - `billing.ts` exports `serviceSubscriptions` mapped to DB table `subscriptions`, while `infra.ts` also exports `subscriptions` mapped to a different purpose | `drizzle/schema/billing.ts` vs `drizzle/schema/infra.ts` | **[OPEN]** Requires broader migration planning to rename one table |

**Impact:** ~~Frontend code may import from the wrong path.~~ The `super-admin` routes now redirect to canonical `superadmin` paths. The subscriptions table naming collision remains a design-level concern for future migration.

---

### 6.2 Tables With No Dedicated CRUD API Routes

The following tables exist in the schema but have no direct API route for management:

| Table | Schema File | Status |
|-------|-------------|--------|
| `price_books` | crm.ts | **[RESOLVED]** New route at `/api/tenant/price-books` with full CRUD |
| `price_book_entries` | crm.ts | **[RESOLVED]** Managed through the price-books API |
| `service_categories` | billing.ts | **[RESOLVED]** New route at `/api/tenant/service-categories` with full CRUD |
| `pipeline_health_metrics` | crm.ts | **[OPEN]** Read by analytics but no write API (cron-generated) |
| `deal_products` | crm.ts | **[OPEN]** No dedicated route (embedded in deal operations) |
| `contact_emails` | crm.ts | **[OPEN]** No standalone CRUD (managed via contact update) |
| `contact_scores` | crm.ts | **[OPEN]** Written by AI scoring but no manual override API |
| `conversation_metrics` | crm.ts | **[OPEN]** No API route - aggregated data |
| `conversation_keywords` | crm.ts | **[OPEN]** No API route |
| `revenue_projections` | crm.ts | **[OPEN]** No dedicated write API |
| `revenue_opportunities` | automation.ts | **[OPEN]** No API route for management |
| `content_generations` | automation.ts | **[OPEN]** No dedicated API route |
| `workflow_execution_logs` | automation.ts | **[OPEN]** No read API (internal logging only) |
| `email_warmup_pool` | comm.ts | **[OPEN]** No management API |
| `email_warmup_logs` | comm.ts | **[OPEN]** Logs only - no management |
| `invoice_payments` | billing.ts | **[OPEN]** No dedicated payment recording API |
| `segment_members` | segments.ts | **[OPEN]** Managed internally via segments API |
| `hierarchy_permissions` | hierarchy.ts | **[OPEN]** Managed via hierarchy API but no standalone route |
| `limit_violations` | infra.ts | **[OPEN]** System-generated, no tenant-facing API needed |
| `backup_alerts` | infra.ts | **[OPEN]** No tenant-facing API |
| `critical_data_backups` | infra.ts | **[OPEN]** System-generated, no API needed |
| `user_departures` | infra.ts | **[OPEN]** No API route |
| `dashboard_templates` | infra.ts | **[OPEN]** No API route for managing templates |
| `report_templates` | infra.ts | **[OPEN]** No API route |
| `cost_anomalies` | tokens.ts | **[OPEN]** No tenant-facing API |
| `usage_alerts` | tokens.ts | **[OPEN]** No dedicated management API |
| `user_token_limits` | tokens.ts | **[OPEN]** No dedicated API (managed via token-control) |

Note: Most remaining open items are internal/system tables that do not require public-facing CRUD endpoints.

---

### 6.3 Pages That May Call Non-Existent or Mismatched Routes

| Page | Expected Route | Issue | Status |
|------|---------------|-------|--------|
| `/tenant/settings/audit` | `/api/super-admin/audit-logs` | Page uses `super-admin` path but most admin routes are at `/api/superadmin/` | **[RESOLVED]** Page uses server-side DB query directly, not an API call |
| `/tenant/products` | `/api/tenant/products` | No dedicated products API route file exists - products are managed via deals/quotes | **[RESOLVED]** New `/api/tenant/products` route created with full CRUD |
| `/tenant/products/[templateId]` | - | Unclear what API this calls - may be product template from superadmin | **[OPEN]** Informational |
| `/tenant/docs` | - | Static page or calls undocumented route | **[OPEN]** Informational |
| `/tenant/calendar` | `/api/tenant/meetings` | Meetings API exists but calendar may need additional event aggregation | **[OPEN]** Informational |
| `/tenant/trial-expired` | - | Static informational page | **[OPEN]** Informational |

---

### 6.4 Routes Without Corresponding Frontend Pages

| API Route | Methods | Issue |
|-----------|---------|-------|
| `/api/tenant/plugin-engine` | GET, POST, PATCH, DELETE | No dedicated plugin-engine page (plugins page may use it) |
| `/api/tenant/plugin-engine/actions` | POST | Internal use only |
| `/api/tenant/plugins/webhook/[id]` | POST | Webhook callback - no UI needed but not documented |
| `/api/tenant/compliance/soc2` | GET, POST | No dedicated SOC 2 page under settings/compliance |
| `/api/admin/2fa/disable` | POST | Admin override with no dedicated UI |
| `/api/admin/tenant-restore` | GET, POST, PUT, DELETE | Admin restore with no dedicated page |
| `/api/dev/dashboard` | GET, POST | Development-only dashboard |
| `/api/emergency/recover` | GET, POST | Emergency recovery - no UI |
| `/api/v2/[...path]` | ALL | API v2 proxy - no frontend |

---

### 6.5 Partially Implemented Features

| Feature | Schema | API | UI | Gap | Status |
|---------|--------|-----|-------|-----|--------|
| Price Books | `price_books`, `price_book_entries` in crm.ts | `/api/tenant/price-books` | None | ~~Schema exists but feature is not exposed~~ | **[RESOLVED]** Full CRUD API at `/api/tenant/price-books` |
| Conversation Intelligence | `call_notes`, `call_recordings`, `conversation_metrics`, `conversation_keywords` in crm.ts | Partial (calls route) | Calls page exists but lacks keyword analysis UI | Keyword analysis UI not implemented | **[OPEN]** |
| Content Generation | `content_generations` in automation.ts | None | None | Schema exists, no API or UI | **[OPEN]** |
| Revenue Opportunities | `revenue_opportunities` in automation.ts | None | None | AI-detected opportunities with no user interface | **[OPEN]** |
| Service Categories | `service_categories` in billing.ts | `/api/tenant/service-categories` | Services page exists | ~~Lacks category management~~ | **[RESOLVED]** Full CRUD API at `/api/tenant/service-categories` |
| Dynamic Segments | `segments`, `segment_members` in segments.ts | `/api/tenant/segments` | None | ~~Smart list feature not implemented in API~~ | **[RESOLVED]** Full CRUD API at `/api/tenant/segments` |
| E-signature Document Link | `signing_requests.document_id` | API exists | Page exists | ~~document_id FK references no specific documents table FK constraint~~ | **[RESOLVED]** FK added referencing documents.id |
| Products CRUD | `products` in crm.ts | `/api/tenant/products` | `/tenant/products` page exists | ~~No dedicated route~~ | **[RESOLVED]** Full CRUD at `/api/tenant/products` |
| User Departures | `user_departures` in infra.ts | None | None | Offboarding feature designed but not implemented | **[OPEN]** |
| Dashboard Templates | `dashboard_templates`, `report_templates` in infra.ts | None | None | Template system exists in schema only | **[OPEN]** |
| Churn Predictions Management | `churn_predictions` in crm.ts | GET/POST/PATCH via analytics/churn | `/tenant/ai/at-risk` page | ~~Feature is read-only; no way to mark predictions as actioned~~ | **[RESOLVED]** PATCH endpoint exists for marking predictions as actioned |

---

### 6.6 Schema Design Issues

| Issue | Location | Description | Status |
|-------|----------|-------------|--------|
| Duplicate table name collision | `billing.ts` and `infra.ts` both define `subscriptions` | `billing.ts` uses `serviceSubscriptions` export name with table `subscriptions`, while `infra.ts` exports `subscriptions` for platform billing. Potential runtime confusion. | **[OPEN]** Requires migration planning |
| Legacy vs systematic tagging | `crm.ts` has both `entity_tags` (polymorphic) and `contact_tags`/`lead_tags` (legacy) | Dual systems maintained for backward compatibility | **[OPEN]** Architectural decision needed |
| Duplicate pipeline stages | `deal_stages` and `pipeline_stages` both exist in crm.ts | Two tables for the same concept - likely one is deprecated | **[OPEN]** Requires deprecation decision |
| No FK on `invoice_line_items.invoice_id` | `billing.ts` | invoice_id is NOT NULL but has no FK constraint defined | **[RESOLVED]** FK added referencing `invoices.id` |
| No FK on `order_line_items.order_id` | `billing.ts` | order_id is NOT NULL but has no FK constraint defined | **[RESOLVED]** FK added referencing `orders.id` |
| `signing_requests.document_id` has no FK | `esignature.ts` | References documents but no constraint ensures referential integrity | **[RESOLVED]** FK added referencing `documents.id` |
| `hierarchy_permissions.hierarchy_id` has no FK | `hierarchy.ts` | References tenant_hierarchy but no constraint | **[RESOLVED]** FK added referencing `tenantHierarchy.id` |
| `territories.assigned_to` has no FK | `territories.ts` | References users but no constraint | **[RESOLVED]** FK added referencing `users.id` |

---

### 6.7 Missing API Validation

| Route | Issue | Status |
|-------|-------|--------|
| `/api/tenant/invoices` POST | Creates invoices but does not validate invoice_number uniqueness before insert | **[RESOLVED]** Uniqueness check with retry logic added to POST handler |
| `/api/public/offers/[publicToken]/accept` | Token-based access without rate limiting may be vulnerable | **[RESOLVED]** Rate limiting implemented (max: 5, window: 60 min) |
| `/api/forms/submit` | Public form submission - rate limiting critical but implementation varies | **[RESOLVED]** Rate limiting implemented (max: 10, window: 60 min) |

---

### 6.8 Frontend-Backend Disconnections

| Issue | Detail | Status |
|-------|--------|--------|
| Settings/audit page calls super-admin path | `app/tenant/settings/audit/page.tsx` likely calls `/api/super-admin/audit-logs` which uses the dash-separated naming | **[RESOLVED]** Page uses server-side DB query directly, not an API call |
| Superadmin tenants duplicate | Both `/api/super-admin/tenants` and `/api/superadmin/tenants` exist, creating confusion about which to use | **[RESOLVED]** `/api/super-admin/tenants` now redirects to canonical `/api/superadmin/tenants` |
| Products page with no products API | `/tenant/products` page exists but there is no `/api/tenant/products` route.ts | **[RESOLVED]** `/api/tenant/products` route now exists with full CRUD |
| Leaderboards page calculation | `/tenant/leaderboards` page exists and calls `/api/tenant/leaderboards` - but the response is computed on-the-fly with no caching table | **[OPEN]** No caching table implemented |
| Email analytics page | `/tenant/analytics/email` exists but the primary tracking data is split across `email_tracking`, `email_opens`, and `email_clicks` tables with no unified analytics API | **[OPEN]** No unified analytics API |

---

### 6.9 Summary of Critical Issues

1. **~~Duplicate routing namespace:~~** ~~`super-admin` vs `superadmin` creates maintenance burden and potential bugs~~ **[RESOLVED]** Legacy `super-admin` routes now redirect to canonical `superadmin` paths
2. **~~Missing Products API:~~** ~~Frontend page exists (`/tenant/products`) but no CRUD route~~ **[RESOLVED]** Full CRUD at `/api/tenant/products`
3. **Schema-only features:** ~~Price books, segments,~~ content generation, and revenue opportunities have schemas but zero API/UI **[PARTIALLY RESOLVED]** Price books and segments now have full APIs
4. **Subscriptions table collision:** Two different `subscriptions` concepts mapped to potentially the same DB table name **[OPEN]**
5. **~~Missing FK constraints:~~** ~~Several critical foreign keys (invoice_line_items, signing_requests, hierarchy_permissions) lack database-level enforcement~~ **[RESOLVED]** All five missing FK constraints have been added
6. **Duplicate pipeline stages:** Both `deal_stages` and `pipeline_stages` tables exist with overlapping purpose **[OPEN]**
7. **Legacy tag duplication:** Both polymorphic `entity_tags` and specific `contact_tags`/`lead_tags` tables co-exist **[OPEN]**

---

*End of Architecture Map*
