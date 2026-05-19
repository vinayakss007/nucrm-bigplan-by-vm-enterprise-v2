-- NuCRM Seed Data - simple INSERTs with verified column names
-- Tenant: 62f771dd-f2f7-4084-a2b2-df6a103ebd89
-- Admin: 450b060d-086b-4fbd-a8a0-d95771f76a1e

-- Companies
INSERT INTO companies (tenant_id, name, industry, company_size, created_by) VALUES
('62f771dd-f2f7-4084-a2b2-df6a103ebd89', 'Acme Corp', 'Technology', '50-200', '450b060d-086b-4fbd-a8a0-d95771f76a1e'),
('62f771dd-f2f7-4084-a2b2-df6a103ebd89', 'Globex Inc', 'Manufacturing', '200-1000', '450b060d-086b-4fbd-a8a0-d95771f76a1e'),
('62f771dd-f2f7-4084-a2b2-df6a103ebd89', 'Initech', 'Finance', '10-50', '450b060d-086b-4fbd-a8a0-d95771f76a1e');

-- Contacts
INSERT INTO contacts (tenant_id, first_name, last_name, email, phone, company_id, assigned_to, created_by) VALUES
('62f771dd-f2f7-4084-a2b2-df6a103ebd89', 'John', 'Doe', 'john@acme.com', '+1-555-0101', (SELECT id FROM companies WHERE name='Acme Corp' LIMIT 1), '450b060d-086b-4fbd-a8a0-d95771f76a1e', '450b060d-086b-4fbd-a8a0-d95771f76a1e');
INSERT INTO contacts (tenant_id, first_name, last_name, email, phone, assigned_to, created_by) VALUES
('62f771dd-f2f7-4084-a2b2-df6a103ebd89', 'Jane', 'Smith', 'jane@globex.com', '+1-555-0102', '450b060d-086b-4fbd-a8a0-d95771f76a1e', '450b060d-086b-4fbd-a8a0-d95771f76a1e'),
('62f771dd-f2f7-4084-a2b2-df6a103ebd89', 'Bob', 'Johnson', 'bob@initech.com', '+1-555-0103', '450b060d-086b-4fbd-a8a0-d95771f76a1e', '450b060d-086b-4fbd-a8a0-d95771f76a1e'),
('62f771dd-f2f7-4084-a2b2-df6a103ebd89', 'Alice', 'Williams', 'alice@example.com', '+1-555-0104', '450b060d-086b-4fbd-a8a0-d95771f76a1e', '450b060d-086b-4fbd-a8a0-d95771f76a1e'),
('62f771dd-f2f7-4084-a2b2-df6a103ebd89', 'Charlie', 'Brown', 'charlie@example.com', '+1-555-0105', '450b060d-086b-4fbd-a8a0-d95771f76a1e', '450b060d-086b-4fbd-a8a0-d95771f76a1e');

-- Leads
INSERT INTO leads (tenant_id, first_name, last_name, email, phone, lead_status, lead_source, assigned_to, created_by) VALUES
('62f771dd-f2f7-4084-a2b2-df6a103ebd89', 'David', 'Miller', 'david@test.com', '+1-555-0201', 'new', 'website', '450b060d-086b-4fbd-a8a0-d95771f76a1e', '450b060d-086b-4fbd-a8a0-d95771f76a1e'),
('62f771dd-f2f7-4084-a2b2-df6a103ebd89', 'Eve', 'Davis', 'eve@test.com', '+1-555-0202', 'contacted', 'referral', '450b060d-086b-4fbd-a8a0-d95771f76a1e', '450b060d-086b-4fbd-a8a0-d95771f76a1e'),
('62f771dd-f2f7-4084-a2b2-df6a103ebd89', 'Frank', 'Wilson', 'frank@test.com', '+1-555-0203', 'qualified', 'linkedin', '450b060d-086b-4fbd-a8a0-d95771f76a1e', '450b060d-086b-4fbd-a8a0-d95771f76a1e');

-- Pipeline (only if not exists)
INSERT INTO pipelines (tenant_id, name, is_default)
SELECT '62f771dd-f2f7-4084-a2b2-df6a103ebd89', 'Sales Pipeline', true
WHERE NOT EXISTS (SELECT 1 FROM pipelines WHERE tenant_id = '62f771dd-f2f7-4084-a2b2-df6a103ebd89' AND is_default = true);

-- Stages
INSERT INTO deal_stages (pipeline_id, name, "order")
SELECT p.id, s.name, s.seq
FROM (SELECT id FROM pipelines WHERE tenant_id = '62f771dd-f2f7-4084-a2b2-df6a103ebd89' AND is_default = true LIMIT 1) p
CROSS JOIN (VALUES ('Lead',1),('Qualified',2),('Proposal',3),('Negotiation',4),('Won',5),('Lost',6)) AS s(name, seq)
WHERE NOT EXISTS (SELECT 1 FROM deal_stages ds WHERE ds.pipeline_id = p.id LIMIT 1);

-- Deals
INSERT INTO deals (tenant_id, title, amount, stage_id, pipeline_id, contact_id, assigned_to, created_by)
SELECT '62f771dd-f2f7-4084-a2b2-df6a103ebd89', 'Website Redesign', 25000, ds.id, ds.pipeline_id, c.id, '450b060d-086b-4fbd-a8a0-d95771f76a1e', '450b060d-086b-4fbd-a8a0-d95771f76a1e'
FROM (SELECT id FROM contacts WHERE email='john@acme.com') c,
     (SELECT ds.id, ds.pipeline_id FROM deal_stages ds JOIN pipelines p ON p.id = ds.pipeline_id WHERE p.tenant_id = '62f771dd-f2f7-4084-a2b2-df6a103ebd89' AND ds.name='Qualified') ds;

INSERT INTO deals (tenant_id, title, amount, stage_id, pipeline_id, contact_id, assigned_to, created_by)
SELECT '62f771dd-f2f7-4084-a2b2-df6a103ebd89', 'Software License', 50000, ds.id, ds.pipeline_id, c.id, '450b060d-086b-4fbd-a8a0-d95771f76a1e', '450b060d-086b-4fbd-a8a0-d95771f76a1e'
FROM (SELECT id FROM contacts WHERE email='jane@globex.com') c,
     (SELECT ds.id, ds.pipeline_id FROM deal_stages ds JOIN pipelines p ON p.id = ds.pipeline_id WHERE p.tenant_id = '62f771dd-f2f7-4084-a2b2-df6a103ebd89' AND ds.name='Proposal') ds;

INSERT INTO deals (tenant_id, title, amount, stage_id, pipeline_id, contact_id, assigned_to, created_by)
SELECT '62f771dd-f2f7-4084-a2b2-df6a103ebd89', 'Consulting Contract', 15000, ds.id, ds.pipeline_id, c.id, '450b060d-086b-4fbd-a8a0-d95771f76a1e', '450b060d-086b-4fbd-a8a0-d95771f76a1e'
FROM (SELECT id FROM contacts WHERE email='bob@initech.com') c,
     (SELECT ds.id, ds.pipeline_id FROM deal_stages ds JOIN pipelines p ON p.id = ds.pipeline_id WHERE p.tenant_id = '62f771dd-f2f7-4084-a2b2-df6a103ebd89' AND ds.name='Lead') ds;

-- Tasks
INSERT INTO tasks (tenant_id, title, description, priority, status, assigned_to, contact_id, deal_id, created_by, due_date)
SELECT '62f771dd-f2f7-4084-a2b2-df6a103ebd89', 'Follow up with Acme', 'Send proposal', 'high', 'pending', '450b060d-086b-4fbd-a8a0-d95771f76a1e', c.id, d.id, '450b060d-086b-4fbd-a8a0-d95771f76a1e', now() + interval '3 days'
FROM (SELECT id FROM contacts WHERE email='john@acme.com') c,
     (SELECT id FROM deals WHERE title='Website Redesign') d;

INSERT INTO tasks (tenant_id, title, description, priority, status, assigned_to, contact_id, deal_id, created_by, due_date)
SELECT '62f771dd-f2f7-4084-a2b2-df6a103ebd89', 'Schedule demo with Globex', 'Show features', 'medium', 'pending', '450b060d-086b-4fbd-a8a0-d95771f76a1e', c.id, d.id, '450b060d-086b-4fbd-a8a0-d95771f76a1e', now() + interval '5 days'
FROM (SELECT id FROM contacts WHERE email='jane@globex.com') c,
     (SELECT id FROM deals WHERE title='Software License') d;

INSERT INTO tasks (tenant_id, title, description, priority, status, assigned_to, created_by, due_date)
VALUES ('62f771dd-f2f7-4084-a2b2-df6a103ebd89', 'Review quarterly targets', 'Prepare Q2 review', 'medium', 'pending', '450b060d-086b-4fbd-a8a0-d95771f76a1e', '450b060d-086b-4fbd-a8a0-d95771f76a1e', now() + interval '7 days');

-- Activities
INSERT INTO activities (tenant_id, event_type, action, description, entity_type, entity_id, user_id)
SELECT '62f771dd-f2f7-4084-a2b2-df6a103ebd89', 'note', 'created', 'Initial interest in redesign', 'deal', d.id, '450b060d-086b-4fbd-a8a0-d95771f76a1e'
FROM deals d WHERE d.title='Website Redesign' LIMIT 1;

-- Notes
INSERT INTO notes (tenant_id, entity_type, entity_id, content, created_by)
SELECT '62f771dd-f2f7-4084-a2b2-df6a103ebd89', 'contact', c.id, 'Key decision maker. Prefers email.', '450b060d-086b-4fbd-a8a0-d95771f76a1e'
FROM contacts c WHERE c.email='john@acme.com' LIMIT 1;
