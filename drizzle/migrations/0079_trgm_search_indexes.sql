-- 0079: pg_trgm GIN indexes for substring search (issue #1544 F3)
--
-- The list/search endpoints filter with leading-wildcard ILIKE '%q%' across
-- name/email/phone/title columns. A leading wildcard can't use a normal B-tree
-- index, so every search was a full Seq Scan (measured ~11 ms on 30k leads,
-- ~169 ms p50 over HTTP on 50k contacts) and grows linearly with tenant size.
--
-- pg_trgm GIN indexes make `col ILIKE '%q%'` index-backed. The extension is
-- ensured by scripts/migrate.ts before migrations run; this migration just adds
-- the indexes. Uses gin_trgm_ops; IF NOT EXISTS keeps it idempotent.
--
-- Columns indexed are exactly those the search WHERE clauses touch:
--   contacts  : first_name, last_name, email, phone   (contacts list + global search)
--   leads     : first_name, last_name, email, phone   (leads list + global search)
--   companies : name                                   (companies list + joins)
--   deals     : title                                  (deals list)

CREATE INDEX IF NOT EXISTS idx_contacts_first_name_trgm ON contacts USING gin (first_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contacts_last_name_trgm  ON contacts USING gin (last_name  gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contacts_email_trgm      ON contacts USING gin (email      gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contacts_phone_trgm      ON contacts USING gin (phone      gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_leads_first_name_trgm ON leads USING gin (first_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_leads_last_name_trgm  ON leads USING gin (last_name  gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_leads_email_trgm      ON leads USING gin (email      gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_leads_phone_trgm      ON leads USING gin (phone      gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_companies_name_trgm ON companies USING gin (name  gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_deals_title_trgm ON deals USING gin (title gin_trgm_ops);
