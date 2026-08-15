-- Migration ID: 0038_cross_module_record_linking
-- Name: Connect tasks, tickets, activities, quotes and invoices across modules
-- Dependencies: 0037_tenant_isolation_hardening

-- WHY THIS EXISTS
-- ---------------
-- The modules were effectively siloed at the data layer:
--
--   tasks           only contact_id + deal_id, so "a task for this company",
--                   "follow up on this lead" and "do this for that ticket" had
--                   nowhere to live
--   support_tickets only contact_id, so "all tickets for this company" was
--                   unanswerable and a ticket could not be tied to the deal it
--                   threatened
--   activities      had denormalised contact/deal/company columns but NO
--                   lead_id, so lead history was only reachable through the
--                   polymorphic entity_type/entity_id pair
--   quotes          had no company_id at all, while invoices, orders and
--                   contracts all did — which is why quote -> invoice
--                   conversion set companyId to undefined
--   invoices        had no deal_id, so revenue attribution had to hop
--                   invoice -> quote -> deal and broke if the quote was deleted
--
-- Relationships the product treats as first-class get real nullable FK columns.
-- Open-ended "also relates to" associations go in record_links instead, so that
-- adding a new pairing does not require a migration every time.

-- UP Migration
BEGIN;

-- ── First-class relationships ───────────────────────────────────────────────
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS lead_id    uuid;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS ticket_id  uuid;

ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS deal_id    uuid;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS lead_id    uuid;

ALTER TABLE activities ADD COLUMN IF NOT EXISTS lead_id uuid;

ALTER TABLE quotes   ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS deal_id    uuid;

COMMIT;


BEGIN;

-- Foreign keys, added per-column so one pre-existing problem cannot block the
-- rest. SET NULL everywhere: losing a company must never delete the tasks or
-- tickets that referenced it.
DO $$
DECLARE
  fk record;
BEGIN
  FOR fk IN
    SELECT * FROM (VALUES
      -- child table,      column,       parent,            on delete
      ('tasks',           'company_id', 'companies',       'SET NULL'),
      ('tasks',           'lead_id',    'leads',           'SET NULL'),
      ('tasks',           'ticket_id',  'support_tickets', 'SET NULL'),
      ('support_tickets', 'company_id', 'companies',       'SET NULL'),
      ('support_tickets', 'deal_id',    'deals',           'SET NULL'),
      ('support_tickets', 'lead_id',    'leads',           'SET NULL'),
      -- activities.contact_id/deal_id/company_id are all CASCADE: an activity
      -- about a deleted record has nothing left to describe. lead_id follows the
      -- same rule so the four columns behave identically.
      ('activities',      'lead_id',    'leads',           'CASCADE'),
      ('quotes',          'company_id', 'companies',       'SET NULL'),
      ('invoices',        'deal_id',    'deals',           'SET NULL')
    ) AS t(child, col, parent, on_delete)
  LOOP
    BEGIN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I)
           REFERENCES %I(id) ON DELETE %s NOT VALID',
        fk.child, fk.child || '_' || fk.col || '_fkey', fk.col, fk.parent, fk.on_delete
      );
      RAISE NOTICE 'added %.% -> %(id) ON DELETE %', fk.child, fk.col, fk.parent, fk.on_delete;
    EXCEPTION
      WHEN duplicate_object THEN
        RAISE NOTICE '%.% foreign key already present', fk.child, fk.col;
      WHEN others THEN
        RAISE WARNING 'could not add %.% -> % (%)', fk.child, fk.col, fk.parent, SQLERRM;
    END;
  END LOOP;
END $$;

-- Indexes on every new FK: these columns exist to be filtered on ("all tickets
-- for this company"), and an unindexed FK would turn each such panel into a
-- sequential scan.
CREATE INDEX IF NOT EXISTS idx_tasks_company            ON tasks(tenant_id, company_id);
CREATE INDEX IF NOT EXISTS idx_tasks_lead               ON tasks(tenant_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_tasks_ticket             ON tasks(tenant_id, ticket_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_company  ON support_tickets(tenant_id, company_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_deal     ON support_tickets(tenant_id, deal_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_lead     ON support_tickets(tenant_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_activities_lead          ON activities(tenant_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_quotes_company           ON quotes(tenant_id, company_id);
CREATE INDEX IF NOT EXISTS idx_invoices_deal            ON invoices(tenant_id, deal_id);

COMMIT;


BEGIN;

-- ── Backfill what is already derivable ──────────────────────────────────────
-- These values exist today, just one join away. Filling them in means the new
-- columns are useful immediately instead of only for records created from now
-- on. Each UPDATE is guarded on IS NULL so re-running changes nothing.

-- A task's company follows from its contact, or from its deal.
UPDATE tasks t SET company_id = c.company_id
  FROM contacts c
 WHERE t.contact_id = c.id AND t.company_id IS NULL AND c.company_id IS NOT NULL;

UPDATE tasks t SET company_id = d.company_id
  FROM deals d
 WHERE t.deal_id = d.id AND t.company_id IS NULL AND d.company_id IS NOT NULL;

-- A ticket's company follows from its contact.
UPDATE support_tickets s SET company_id = c.company_id
  FROM contacts c
 WHERE s.contact_id = c.id AND s.company_id IS NULL AND c.company_id IS NOT NULL;

-- A quote's company follows from its contact, or from its deal.
UPDATE quotes q SET company_id = c.company_id
  FROM contacts c
 WHERE q.contact_id = c.id AND q.company_id IS NULL AND c.company_id IS NOT NULL;

UPDATE quotes q SET company_id = d.company_id
  FROM deals d
 WHERE q.deal_id = d.id AND q.company_id IS NULL AND d.company_id IS NOT NULL;

-- An invoice's deal follows from the quote it came from.
UPDATE invoices i SET deal_id = q.deal_id
  FROM quotes q
 WHERE i.quote_id = q.id AND i.deal_id IS NULL AND q.deal_id IS NOT NULL;

-- Existing lead activity was only recorded polymorphically; promote it into the
-- denormalised column so lead timelines match contact/deal/company timelines.
UPDATE activities a SET lead_id = a.entity_id::uuid
 WHERE a.entity_type = 'lead'
   AND a.lead_id IS NULL
   AND EXISTS (SELECT 1 FROM leads l WHERE l.id = a.entity_id);

COMMIT;


BEGIN;

-- ── record_links: open-ended associations ───────────────────────────────────
-- For pairings that are not worth a dedicated column. The endpoints are
-- polymorphic and therefore cannot be foreign-keyed, so the CHECK constraints
-- below plus the tenant scope are what keep the data honest. Existence of the
-- target row is checked in lib/record-links.ts.
CREATE TABLE IF NOT EXISTS record_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  from_type   text NOT NULL,
  from_id     uuid NOT NULL,
  to_type     text NOT NULL,
  to_id       uuid NOT NULL,

  relation    text NOT NULL DEFAULT 'related',
  note        text,

  created_at  timestamp with time zone DEFAULT now() NOT NULL,
  updated_at  timestamp with time zone DEFAULT now(),
  deleted_at  timestamp with time zone,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by  uuid,
  deleted_by  uuid,

  CONSTRAINT record_links_from_type_valid CHECK (from_type IN (
    'contact','company','lead','deal','task','ticket','quote','order',
    'invoice','contract','product','service','project','document','meeting','activity'
  )),
  CONSTRAINT record_links_to_type_valid CHECK (to_type IN (
    'contact','company','lead','deal','task','ticket','quote','order',
    'invoice','contract','product','service','project','document','meeting','activity'
  )),
  CONSTRAINT record_links_relation_valid CHECK (relation IN (
    'related','blocks','blocked_by','duplicate_of','parent_of','child_of','caused_by','resolves'
  )),
  -- Linking a record to itself is always a mistake.
  CONSTRAINT record_links_not_self CHECK (NOT (from_type = to_type AND from_id = to_id))
);

CREATE INDEX IF NOT EXISTS idx_record_links_from
  ON record_links(tenant_id, from_type, from_id);
CREATE INDEX IF NOT EXISTS idx_record_links_to
  ON record_links(tenant_id, to_type, to_id);

-- Makes linking idempotent: a double-submit cannot create two identical links.
CREATE UNIQUE INDEX IF NOT EXISTS idx_record_links_unique
  ON record_links(tenant_id, from_type, from_id, to_type, to_id, relation);

-- Bring the new table under the same isolation policy as everything else.
-- 0043 discovers tables from the catalogue, so a later re-run would also cover
-- this one; doing it here means it is protected from the moment it exists.
ALTER TABLE record_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON record_links;
CREATE POLICY tenant_isolation ON record_links
  FOR ALL
  USING (tenant_id::text = current_setting('app.current_tenant'))
  WITH CHECK (tenant_id::text = current_setting('app.current_tenant'));

COMMIT;


