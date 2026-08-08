-- Migration ID: 0045_check_constraints
-- Name: Add CHECK constraints to critical fields
-- Dependencies: 0044

-- WHY THIS EXISTS
-- ---------------
-- #676 principle 5: "Input validation at every layer — app-level (Zod),
-- DB-level (CHECK, FK, NOT NULL). Zod catches format errors early;
-- DB constraints catch the rest."
--
-- These CHECKs are the last line of defense. They prevent corrupt data
-- from entering the DB even if app-level validation is bypassed.

BEGIN;

-- Deals: amount must be non-negative
ALTER TABLE deals
  ADD CONSTRAINT chk_deals_amount_non_negative
  CHECK (amount IS NULL OR amount::numeric >= 0);

-- Deals: probability 0-100
ALTER TABLE deals
  ADD CONSTRAINT chk_deals_probability_range
  CHECK (probability IS NULL OR (probability >= 0 AND probability <= 100));

-- Contacts: email format (basic check)
ALTER TABLE contacts
  ADD CONSTRAINT chk_contacts_email_format
  CHECK (email IS NULL OR email = '' OR email LIKE '%@%.%');

-- Leads: score 0-100
ALTER TABLE leads
  ADD CONSTRAINT chk_leads_score_range
  CHECK (score IS NULL OR (score >= 0 AND score <= 100));

-- Invoices: total non-negative
ALTER TABLE invoices
  ADD CONSTRAINT chk_invoices_total_non_negative
  CHECK (total IS NULL OR total::numeric >= 0);

-- Quotes: total_amount non-negative
ALTER TABLE quotes
  ADD CONSTRAINT chk_quotes_amount_non_negative
  CHECK (total_amount IS NULL OR total_amount::numeric >= 0);

-- Orders: total non-negative
ALTER TABLE orders
  ADD CONSTRAINT chk_orders_total_non_negative
  CHECK (total IS NULL OR total::numeric >= 0);

-- Tasks: priority must be valid enum
ALTER TABLE tasks
  ADD CONSTRAINT chk_tasks_priority_valid
  CHECK (priority IN ('low', 'medium', 'high', 'urgent'));

-- Tasks: status must be valid enum
ALTER TABLE tasks
  ADD CONSTRAINT chk_tasks_status_valid
  CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled', 'on_hold', 'deferred'));

COMMIT;
