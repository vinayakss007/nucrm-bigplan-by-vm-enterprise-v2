-- Migration: Add missing AI gateway tables
-- Tables: ai_activity, ai_draft_templates, at_risk_rules, comm_email_drafts

-- 1. ai_activity — per-gateway-call audit log
-- dedup: ai_activity (created by 0017_missing_ai_tables_legacy)

-- 2. ai_draft_templates — per-tenant auto-draft prompt templates
-- dedup: ai_draft_templates (created by 0017_missing_ai_tables_legacy)

-- 3. at_risk_rules — per-tenant deal risk detection rules
-- dedup: at_risk_rules (created by 0017_missing_ai_tables_legacy)

-- 4. comm_email_drafts — communication email drafts table
-- dedup: comm_email_drafts (created by 0017_missing_ai_tables_legacy)
