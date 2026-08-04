-- Migration 0056: Text length limits on remaining critical columns
-- Pattern: (col IS NULL OR length(col) <= N)
-- Limits chosen based on field semantics (email=255, phone=50, name=100, etc.)

-- ============================================================
-- COMPANIES
-- ============================================================
ALTER TABLE companies ADD CONSTRAINT chk_companies_name_length
  CHECK (name IS NULL OR length(name) <= 255);
ALTER TABLE companies ADD CONSTRAINT chk_companies_description_length
  CHECK (description IS NULL OR length(description) <= 5000);
ALTER TABLE companies ADD CONSTRAINT chk_companies_notes_length
  CHECK (notes IS NULL OR length(notes) <= 5000);
ALTER TABLE companies ADD CONSTRAINT chk_companies_address_length
  CHECK (address IS NULL OR length(address) <= 500);
ALTER TABLE companies ADD CONSTRAINT chk_companies_address_line1_length
  CHECK (address_line1 IS NULL OR length(address_line1) <= 255);
ALTER TABLE companies ADD CONSTRAINT chk_companies_phone_length
  CHECK (phone IS NULL OR length(phone) <= 50);
ALTER TABLE companies ADD CONSTRAINT chk_companies_website_length
  CHECK (website IS NULL OR length(website) <= 500);
ALTER TABLE companies ADD CONSTRAINT chk_companies_domain_length
  CHECK (domain IS NULL OR length(domain) <= 255);
ALTER TABLE companies ADD CONSTRAINT chk_companies_industry_length
  CHECK (industry IS NULL OR length(industry) <= 100);
ALTER TABLE companies ADD CONSTRAINT chk_companies_company_size_length
  CHECK (company_size IS NULL OR length(company_size) <= 50);
ALTER TABLE companies ADD CONSTRAINT chk_companies_country_length
  CHECK (country IS NULL OR length(country) <= 100);
ALTER TABLE companies ADD CONSTRAINT chk_companies_state_length
  CHECK (state IS NULL OR length(state) <= 100);
ALTER TABLE companies ADD CONSTRAINT chk_companies_city_length
  CHECK (city IS NULL OR length(city) <= 100);
ALTER TABLE companies ADD CONSTRAINT chk_companies_postal_code_length
  CHECK (postal_code IS NULL OR length(postal_code) <= 20);
ALTER TABLE companies ADD CONSTRAINT chk_companies_timezone_length
  CHECK (timezone IS NULL OR length(timezone) <= 50);
ALTER TABLE companies ADD CONSTRAINT chk_companies_headquarters_length
  CHECK (headquarters IS NULL OR length(headquarters) <= 255);
ALTER TABLE companies ADD CONSTRAINT chk_companies_logo_url_length
  CHECK (logo_url IS NULL OR length(logo_url) <= 2048);
ALTER TABLE companies ADD CONSTRAINT chk_companies_facebook_url_length
  CHECK (facebook_url IS NULL OR length(facebook_url) <= 2048);
ALTER TABLE companies ADD CONSTRAINT chk_companies_linkedin_url_length
  CHECK (linkedin_url IS NULL OR length(linkedin_url) <= 2048);
ALTER TABLE companies ADD CONSTRAINT chk_companies_twitter_url_length
  CHECK (twitter_url IS NULL OR length(twitter_url) <= 2048);

-- ============================================================
-- CONTACTS (additional columns beyond 0053)
-- ============================================================
ALTER TABLE contacts ADD CONSTRAINT chk_contacts_address_line1_length
  CHECK (address_line1 IS NULL OR length(address_line1) <= 255);
ALTER TABLE contacts ADD CONSTRAINT chk_contacts_address_line2_length
  CHECK (address_line2 IS NULL OR length(address_line2) <= 255);
ALTER TABLE contacts ADD CONSTRAINT chk_contacts_city_length
  CHECK (city IS NULL OR length(city) <= 100);
ALTER TABLE contacts ADD CONSTRAINT chk_contacts_state_length
  CHECK (state IS NULL OR length(state) <= 100);
ALTER TABLE contacts ADD CONSTRAINT chk_contacts_country_length
  CHECK (country IS NULL OR length(country) <= 100);
ALTER TABLE contacts ADD CONSTRAINT chk_contacts_postal_code_length
  CHECK (postal_code IS NULL OR length(postal_code) <= 20);
ALTER TABLE contacts ADD CONSTRAINT chk_contacts_job_title_length
  CHECK (job_title IS NULL OR length(job_title) <= 100);
ALTER TABLE contacts ADD CONSTRAINT chk_contacts_department_length
  CHECK (department IS NULL OR length(department) <= 100);
ALTER TABLE contacts ADD CONSTRAINT chk_contacts_company_name_length
  CHECK (company_name IS NULL OR length(company_name) <= 255);
ALTER TABLE contacts ADD CONSTRAINT chk_contacts_lead_source_length
  CHECK (lead_source IS NULL OR length(lead_source) <= 100);
ALTER TABLE contacts ADD CONSTRAINT chk_contacts_lead_status_length
  CHECK (lead_status IS NULL OR length(lead_status) <= 50);
ALTER TABLE contacts ADD CONSTRAINT chk_contacts_lifecycle_stage_length
  CHECK (lifecycle_stage IS NULL OR length(lifecycle_stage) <= 50);
ALTER TABLE contacts ADD CONSTRAINT chk_contacts_gender_length
  CHECK (gender IS NULL OR length(gender) <= 20);
ALTER TABLE contacts ADD CONSTRAINT chk_contacts_timezone_length
  CHECK (timezone IS NULL OR length(timezone) <= 50);
ALTER TABLE contacts ADD CONSTRAINT chk_contacts_secondary_email_length
  CHECK (secondary_email IS NULL OR length(secondary_email) <= 255);
ALTER TABLE contacts ADD CONSTRAINT chk_contacts_mobile_phone_length
  CHECK (mobile_phone IS NULL OR length(mobile_phone) <= 50);
ALTER TABLE contacts ADD CONSTRAINT chk_contacts_work_phone_length
  CHECK (work_phone IS NULL OR length(work_phone) <= 50);
ALTER TABLE contacts ADD CONSTRAINT chk_contacts_avatar_url_length
  CHECK (avatar_url IS NULL OR length(avatar_url) <= 2048);
ALTER TABLE contacts ADD CONSTRAINT chk_contacts_facebook_url_length
  CHECK (facebook_url IS NULL OR length(facebook_url) <= 2048);
ALTER TABLE contacts ADD CONSTRAINT chk_contacts_linkedin_url_length
  CHECK (linkedin_url IS NULL OR length(linkedin_url) <= 2048);
ALTER TABLE contacts ADD CONSTRAINT chk_contacts_twitter_url_length
  CHECK (twitter_url IS NULL OR length(twitter_url) <= 2048);
ALTER TABLE contacts ADD CONSTRAINT chk_contacts_owner_notes_length
  CHECK (owner_notes IS NULL OR length(owner_notes) <= 5000);

-- ============================================================
-- LEADS (additional columns beyond 0053)
-- ============================================================
ALTER TABLE leads ADD CONSTRAINT chk_leads_address_line1_length
  CHECK (address_line1 IS NULL OR length(address_line1) <= 255);
ALTER TABLE leads ADD CONSTRAINT chk_leads_city_length
  CHECK (city IS NULL OR length(city) <= 100);
ALTER TABLE leads ADD CONSTRAINT chk_leads_state_length
  CHECK (state IS NULL OR length(state) <= 100);
ALTER TABLE leads ADD CONSTRAINT chk_leads_country_length
  CHECK (country IS NULL OR length(country) <= 100);
ALTER TABLE leads ADD CONSTRAINT chk_leads_postal_code_length
  CHECK (postal_code IS NULL OR length(postal_code) <= 20);
ALTER TABLE leads ADD CONSTRAINT chk_leads_company_name_length
  CHECK (company_name IS NULL OR length(company_name) <= 255);
ALTER TABLE leads ADD CONSTRAINT chk_leads_company_industry_length
  CHECK (company_industry IS NULL OR length(company_industry) <= 100);
ALTER TABLE leads ADD CONSTRAINT chk_leads_company_size_length
  CHECK (company_size IS NULL OR length(company_size) <= 50);
ALTER TABLE leads ADD CONSTRAINT chk_leads_full_name_length
  CHECK (full_name IS NULL OR length(full_name) <= 200);
ALTER TABLE leads ADD CONSTRAINT chk_leads_lead_source_length
  CHECK (lead_source IS NULL OR length(lead_source) <= 100);
ALTER TABLE leads ADD CONSTRAINT chk_leads_lead_status_length
  CHECK (lead_status IS NULL OR length(lead_status) <= 50);
ALTER TABLE leads ADD CONSTRAINT chk_leads_lifecycle_stage_length
  CHECK (lifecycle_stage IS NULL OR length(lifecycle_stage) <= 50);
ALTER TABLE leads ADD CONSTRAINT chk_leads_budget_currency_length
  CHECK (budget_currency IS NULL OR length(budget_currency) <= 10);
ALTER TABLE leads ADD CONSTRAINT chk_leads_authority_level_length
  CHECK (authority_level IS NULL OR length(authority_level) <= 50);
ALTER TABLE leads ADD CONSTRAINT chk_leads_timeline_length
  CHECK (timeline IS NULL OR length(timeline) <= 100);
ALTER TABLE leads ADD CONSTRAINT chk_leads_need_description_length
  CHECK (need_description IS NULL OR length(need_description) <= 5000);
ALTER TABLE leads ADD CONSTRAINT chk_leads_internal_notes_length
  CHECK (internal_notes IS NULL OR length(internal_notes) <= 5000);
ALTER TABLE leads ADD CONSTRAINT chk_leads_utm_source_length
  CHECK (utm_source IS NULL OR length(utm_source) <= 255);
ALTER TABLE leads ADD CONSTRAINT chk_leads_utm_medium_length
  CHECK (utm_medium IS NULL OR length(utm_medium) <= 255);
ALTER TABLE leads ADD CONSTRAINT chk_leads_utm_campaign_length
  CHECK (utm_campaign IS NULL OR length(utm_campaign) <= 255);
ALTER TABLE leads ADD CONSTRAINT chk_leads_twitter_handle_length
  CHECK (twitter_handle IS NULL OR length(twitter_handle) <= 100);
ALTER TABLE leads ADD CONSTRAINT chk_leads_mobile_length
  CHECK (mobile IS NULL OR length(mobile) <= 50);
ALTER TABLE leads ADD CONSTRAINT chk_leads_form_id_length
  CHECK (form_id IS NULL OR length(form_id) <= 100);
ALTER TABLE leads ADD CONSTRAINT chk_leads_product_id_length
  CHECK (product_id IS NULL OR length(product_id) <= 100);
ALTER TABLE leads ADD CONSTRAINT chk_leads_lead_oid_length
  CHECK (lead_oid IS NULL OR length(lead_oid) <= 100);

-- ============================================================
-- DEALS (additional columns beyond 0053)
-- ============================================================
ALTER TABLE deals ADD CONSTRAINT chk_deals_currency_length
  CHECK (currency IS NULL OR length(currency) <= 10);
ALTER TABLE deals ADD CONSTRAINT chk_deals_stage_length
  CHECK (stage IS NULL OR length(stage) <= 100);
ALTER TABLE deals ADD CONSTRAINT chk_deals_priority_length
  CHECK (priority IS NULL OR length(priority) <= 50);
ALTER TABLE deals ADD CONSTRAINT chk_deals_status_length
  CHECK (status IS NULL OR length(status) <= 50);
ALTER TABLE deals ADD CONSTRAINT chk_deals_source_length
  CHECK (source IS NULL OR length(source) <= 100);
ALTER TABLE deals ADD CONSTRAINT chk_deals_description_length
  CHECK (description IS NULL OR length(description) <= 5000);
ALTER TABLE deals ADD CONSTRAINT chk_deals_notes_length
  CHECK (notes IS NULL OR length(notes) <= 5000);

-- ============================================================
-- USERS
-- ============================================================
ALTER TABLE users ADD CONSTRAINT chk_users_email_length
  CHECK (email IS NULL OR length(email) <= 255);
ALTER TABLE users ADD CONSTRAINT chk_users_full_name_length
  CHECK (full_name IS NULL OR length(full_name) <= 200);
ALTER TABLE users ADD CONSTRAINT chk_users_phone_length
  CHECK (phone IS NULL OR length(phone) <= 50);
ALTER TABLE users ADD CONSTRAINT chk_users_avatar_url_length
  CHECK (avatar_url IS NULL OR length(avatar_url) <= 2048);
ALTER TABLE users ADD CONSTRAINT chk_users_timezone_length
  CHECK (timezone IS NULL OR length(timezone) <= 50);
ALTER TABLE users ADD CONSTRAINT chk_users_locale_length
  CHECK (locale IS NULL OR length(locale) <= 10);
ALTER TABLE users ADD CONSTRAINT chk_users_oauth_provider_length
  CHECK (oauth_provider IS NULL OR length(oauth_provider) <= 50);
ALTER TABLE users ADD CONSTRAINT chk_users_oauth_id_length
  CHECK (oauth_id IS NULL OR length(oauth_id) <= 255);
ALTER TABLE users ADD CONSTRAINT chk_users_theme_length
  CHECK (theme IS NULL OR length(theme) <= 50);

-- ============================================================
-- TENANTS
-- ============================================================
ALTER TABLE tenants ADD CONSTRAINT chk_tenants_name_length
  CHECK (name IS NULL OR length(name) <= 255);
ALTER TABLE tenants ADD CONSTRAINT chk_tenants_slug_length
  CHECK (slug IS NULL OR length(slug) <= 100);
ALTER TABLE tenants ADD CONSTRAINT chk_tenants_short_code_length
  CHECK (short_code IS NULL OR length(short_code) <= 20);
ALTER TABLE tenants ADD CONSTRAINT chk_tenants_subdomain_length
  CHECK (subdomain IS NULL OR length(subdomain) <= 100);
ALTER TABLE tenants ADD CONSTRAINT chk_tenants_custom_domain_length
  CHECK (custom_domain IS NULL OR length(custom_domain) <= 255);
ALTER TABLE tenants ADD CONSTRAINT chk_tenants_billing_email_length
  CHECK (billing_email IS NULL OR length(billing_email) <= 255);
ALTER TABLE tenants ADD CONSTRAINT chk_tenants_billing_type_length
  CHECK (billing_type IS NULL OR length(billing_type) <= 50);
ALTER TABLE tenants ADD CONSTRAINT chk_tenants_status_length
  CHECK (status IS NULL OR length(status) <= 50);
ALTER TABLE tenants ADD CONSTRAINT chk_tenants_plan_id_length
  CHECK (plan_id IS NULL OR length(plan_id) <= 50);
ALTER TABLE tenants ADD CONSTRAINT chk_tenants_industry_length
  CHECK (industry IS NULL OR length(industry) <= 100);
ALTER TABLE tenants ADD CONSTRAINT chk_tenants_company_size_length
  CHECK (company_size IS NULL OR length(company_size) <= 50);
ALTER TABLE tenants ADD CONSTRAINT chk_tenants_country_length
  CHECK (country IS NULL OR length(country) <= 100);
ALTER TABLE tenants ADD CONSTRAINT chk_tenants_primary_color_length
  CHECK (primary_color IS NULL OR length(primary_color) <= 20);
ALTER TABLE tenants ADD CONSTRAINT chk_tenants_logo_url_length
  CHECK (logo_url IS NULL OR length(logo_url) <= 2048);
ALTER TABLE tenants ADD CONSTRAINT chk_tenants_favicon_url_length
  CHECK (favicon_url IS NULL OR length(favicon_url) <= 2048);
ALTER TABLE tenants ADD CONSTRAINT chk_tenants_admin_notes_length
  CHECK (admin_notes IS NULL OR length(admin_notes) <= 5000);
ALTER TABLE tenants ADD CONSTRAINT chk_tenants_stripe_customer_id_length
  CHECK (stripe_customer_id IS NULL OR length(stripe_customer_id) <= 255);
ALTER TABLE tenants ADD CONSTRAINT chk_tenants_stripe_subscription_id_length
  CHECK (stripe_subscription_id IS NULL OR length(stripe_subscription_id) <= 255);
ALTER TABLE tenants ADD CONSTRAINT chk_tenants_subscription_id_length
  CHECK (subscription_id IS NULL OR length(subscription_id) <= 255);

-- ============================================================
-- INVOICES (additional columns beyond 0053)
-- ============================================================
ALTER TABLE invoices ADD CONSTRAINT chk_invoices_invoice_number_length
  CHECK (invoice_number IS NULL OR length(invoice_number) <= 50);
ALTER TABLE invoices ADD CONSTRAINT chk_invoices_currency_length
  CHECK (currency IS NULL OR length(currency) <= 10);
ALTER TABLE invoices ADD CONSTRAINT chk_invoices_status_length
  CHECK (status IS NULL OR length(status) <= 50);
ALTER TABLE invoices ADD CONSTRAINT chk_invoices_payment_method_length
  CHECK (payment_method IS NULL OR length(payment_method) <= 50);
ALTER TABLE invoices ADD CONSTRAINT chk_invoices_payment_reference_length
  CHECK (payment_reference IS NULL OR length(payment_reference) <= 255);
ALTER TABLE invoices ADD CONSTRAINT chk_invoices_discount_type_length
  CHECK (discount_type IS NULL OR length(discount_type) <= 50);
ALTER TABLE invoices ADD CONSTRAINT chk_invoices_recurring_frequency_length
  CHECK (recurring_frequency IS NULL OR length(recurring_frequency) <= 50);
ALTER TABLE invoices ADD CONSTRAINT chk_invoices_terms_length
  CHECK (terms IS NULL OR length(terms) <= 5000);
ALTER TABLE invoices ADD CONSTRAINT chk_invoices_footer_length
  CHECK (footer IS NULL OR length(footer) <= 2000);

-- ============================================================
-- QUOTES (additional columns beyond 0053)
-- ============================================================
ALTER TABLE quotes ADD CONSTRAINT chk_quotes_quote_number_length
  CHECK (quote_number IS NULL OR length(quote_number) <= 50);
ALTER TABLE quotes ADD CONSTRAINT chk_quotes_status_length
  CHECK (status IS NULL OR length(status) <= 50);
ALTER TABLE quotes ADD CONSTRAINT chk_quotes_terms_length
  CHECK (terms IS NULL OR length(terms) <= 5000);

-- ============================================================
-- ORDERS (additional columns beyond 0053)
-- ============================================================
ALTER TABLE orders ADD CONSTRAINT chk_orders_order_number_length
  CHECK (order_number IS NULL OR length(order_number) <= 50);
ALTER TABLE orders ADD CONSTRAINT chk_orders_status_length
  CHECK (status IS NULL OR length(status) <= 50);
ALTER TABLE orders ADD CONSTRAINT chk_orders_shipping_address_length
  CHECK (shipping_address IS NULL OR length(shipping_address) <= 500);
ALTER TABLE orders ADD CONSTRAINT chk_orders_shipping_city_length
  CHECK (shipping_city IS NULL OR length(shipping_city) <= 100);
ALTER TABLE orders ADD CONSTRAINT chk_orders_shipping_state_length
  CHECK (shipping_state IS NULL OR length(shipping_state) <= 100);
ALTER TABLE orders ADD CONSTRAINT chk_orders_shipping_country_length
  CHECK (shipping_country IS NULL OR length(shipping_country) <= 100);
ALTER TABLE orders ADD CONSTRAINT chk_orders_shipping_postal_code_length
  CHECK (shipping_postal_code IS NULL OR length(shipping_postal_code) <= 20);
ALTER TABLE orders ADD CONSTRAINT chk_orders_shipping_carrier_length
  CHECK (shipping_carrier IS NULL OR length(shipping_carrier) <= 100);
ALTER TABLE orders ADD CONSTRAINT chk_orders_tracking_number_length
  CHECK (tracking_number IS NULL OR length(tracking_number) <= 255);
ALTER TABLE orders ADD CONSTRAINT chk_orders_billing_address_length
  CHECK (billing_address IS NULL OR length(billing_address) <= 500);
ALTER TABLE orders ADD CONSTRAINT chk_orders_billing_city_length
  CHECK (billing_city IS NULL OR length(billing_city) <= 100);
ALTER TABLE orders ADD CONSTRAINT chk_orders_billing_state_length
  CHECK (billing_state IS NULL OR length(billing_state) <= 100);
ALTER TABLE orders ADD CONSTRAINT chk_orders_billing_country_length
  CHECK (billing_country IS NULL OR length(billing_country) <= 100);
ALTER TABLE orders ADD CONSTRAINT chk_orders_billing_postal_code_length
  CHECK (billing_postal_code IS NULL OR length(billing_postal_code) <= 20);
ALTER TABLE orders ADD CONSTRAINT chk_orders_customer_notes_length
  CHECK (customer_notes IS NULL OR length(customer_notes) <= 5000);

-- ============================================================
-- PRODUCTS
-- ============================================================
ALTER TABLE products ADD CONSTRAINT chk_products_name_length
  CHECK (name IS NULL OR length(name) <= 255);
ALTER TABLE products ADD CONSTRAINT chk_products_description_length
  CHECK (description IS NULL OR length(description) <= 5000);
ALTER TABLE products ADD CONSTRAINT chk_products_sku_length
  CHECK (sku IS NULL OR length(sku) <= 100);

-- ============================================================
-- SERVICES
-- ============================================================
ALTER TABLE services ADD CONSTRAINT chk_services_name_length
  CHECK (name IS NULL OR length(name) <= 255);
ALTER TABLE services ADD CONSTRAINT chk_services_description_length
  CHECK (description IS NULL OR length(description) <= 5000);
ALTER TABLE services ADD CONSTRAINT chk_services_category_length
  CHECK (category IS NULL OR length(category) <= 100);
ALTER TABLE services ADD CONSTRAINT chk_services_pricing_type_length
  CHECK (pricing_type IS NULL OR length(pricing_type) <= 50);
ALTER TABLE services ADD CONSTRAINT chk_services_currency_length
  CHECK (currency IS NULL OR length(currency) <= 10);
ALTER TABLE services ADD CONSTRAINT chk_services_image_url_length
  CHECK (image_url IS NULL OR length(image_url) <= 2048);

-- ============================================================
-- FORMS
-- ============================================================
ALTER TABLE forms ADD CONSTRAINT chk_forms_name_length
  CHECK (name IS NULL OR length(name) <= 255);
ALTER TABLE forms ADD CONSTRAINT chk_forms_title_length
  CHECK (title IS NULL OR length(title) <= 255);
ALTER TABLE forms ADD CONSTRAINT chk_forms_description_length
  CHECK (description IS NULL OR length(description) <= 2000);
ALTER TABLE forms ADD CONSTRAINT chk_forms_slug_length
  CHECK (slug IS NULL OR length(slug) <= 255);
ALTER TABLE forms ADD CONSTRAINT chk_forms_submit_label_length
  CHECK (submit_label IS NULL OR length(submit_label) <= 100);
ALTER TABLE forms ADD CONSTRAINT chk_forms_success_message_length
  CHECK (success_message IS NULL OR length(success_message) <= 1000);
ALTER TABLE forms ADD CONSTRAINT chk_forms_redirect_url_length
  CHECK (redirect_url IS NULL OR length(redirect_url) <= 2048);

-- ============================================================
-- EMAIL TEMPLATES
-- ============================================================
ALTER TABLE email_templates ADD CONSTRAINT chk_email_templates_name_length
  CHECK (name IS NULL OR length(name) <= 255);
ALTER TABLE email_templates ADD CONSTRAINT chk_email_templates_subject_length
  CHECK (subject IS NULL OR length(subject) <= 500);
ALTER TABLE email_templates ADD CONSTRAINT chk_email_templates_body_html_length
  CHECK (body_html IS NULL OR length(body_html) <= 100000);
ALTER TABLE email_templates ADD CONSTRAINT chk_email_templates_body_text_length
  CHECK (body_text IS NULL OR length(body_text) <= 100000);
ALTER TABLE email_templates ADD CONSTRAINT chk_email_templates_category_length
  CHECK (category IS NULL OR length(category) <= 100);

-- ============================================================
-- SMS TEMPLATES
-- ============================================================
ALTER TABLE sms_templates ADD CONSTRAINT chk_sms_templates_name_length
  CHECK (name IS NULL OR length(name) <= 255);
ALTER TABLE sms_templates ADD CONSTRAINT chk_sms_templates_body_length
  CHECK (body IS NULL OR length(body) <= 1600);

-- ============================================================
-- WEBHOOKS
-- ============================================================
ALTER TABLE webhooks ADD CONSTRAINT chk_webhooks_name_length
  CHECK (name IS NULL OR length(name) <= 255);
ALTER TABLE webhooks ADD CONSTRAINT chk_webhooks_url_length
  CHECK (url IS NULL OR length(url) <= 2048);
ALTER TABLE webhooks ADD CONSTRAINT chk_webhooks_secret_length
  CHECK (secret IS NULL OR length(secret) <= 255);

-- ============================================================
-- ROLES
-- ============================================================
ALTER TABLE roles ADD CONSTRAINT chk_roles_name_length
  CHECK (name IS NULL OR length(name) <= 100);
ALTER TABLE roles ADD CONSTRAINT chk_roles_slug_length
  CHECK (slug IS NULL OR length(slug) <= 100);
ALTER TABLE roles ADD CONSTRAINT chk_roles_description_length
  CHECK (description IS NULL OR length(description) <= 500);

-- ============================================================
-- PLANS
-- ============================================================
ALTER TABLE plans ADD CONSTRAINT chk_plans_name_length
  CHECK (name IS NULL OR length(name) <= 100);
ALTER TABLE plans ADD CONSTRAINT chk_plans_slug_length
  CHECK (slug IS NULL OR length(slug) <= 100);
ALTER TABLE plans ADD CONSTRAINT chk_plans_description_length
  CHECK (description IS NULL OR length(description) <= 2000);

-- ============================================================
-- INVITATIONS
-- ============================================================
ALTER TABLE invitations ADD CONSTRAINT chk_invitations_email_length
  CHECK (email IS NULL OR length(email) <= 255);
ALTER TABLE invitations ADD CONSTRAINT chk_invitations_role_slug_length
  CHECK (role_slug IS NULL OR length(role_slug) <= 100);
ALTER TABLE invitations ADD CONSTRAINT chk_invitations_token_length
  CHECK (token IS NULL OR length(token) <= 255);

-- ============================================================
-- SUPPORT TICKETS
-- ============================================================
ALTER TABLE support_tickets ADD CONSTRAINT chk_support_tickets_subject_length
  CHECK (subject IS NULL OR length(subject) <= 500);
ALTER TABLE support_tickets ADD CONSTRAINT chk_support_tickets_body_length
  CHECK (body IS NULL OR length(body) <= 50000);
ALTER TABLE support_tickets ADD CONSTRAINT chk_support_tickets_status_length
  CHECK (status IS NULL OR length(status) <= 50);
ALTER TABLE support_tickets ADD CONSTRAINT chk_support_tickets_priority_length
  CHECK (priority IS NULL OR length(priority) <= 50);
ALTER TABLE support_tickets ADD CONSTRAINT chk_support_tickets_category_length
  CHECK (category IS NULL OR length(category) <= 100);

-- ============================================================
-- KB ARTICLES
-- ============================================================
ALTER TABLE kb_articles ADD CONSTRAINT chk_kb_articles_title_length
  CHECK (title IS NULL OR length(title) <= 255);
ALTER TABLE kb_articles ADD CONSTRAINT chk_kb_articles_slug_length
  CHECK (slug IS NULL OR length(slug) <= 255);
ALTER TABLE kb_articles ADD CONSTRAINT chk_kb_articles_content_length
  CHECK (content IS NULL OR length(content) <= 100000);
ALTER TABLE kb_articles ADD CONSTRAINT chk_kb_articles_excerpt_length
  CHECK (excerpt IS NULL OR length(excerpt) <= 5000);
ALTER TABLE kb_articles ADD CONSTRAINT chk_kb_articles_status_length
  CHECK (status IS NULL OR length(status) <= 50);

-- ============================================================
-- CONTRACTS
-- ============================================================
ALTER TABLE contracts ADD CONSTRAINT chk_contracts_title_length
  CHECK (title IS NULL OR length(title) <= 255);
ALTER TABLE contracts ADD CONSTRAINT chk_contracts_contract_number_length
  CHECK (contract_number IS NULL OR length(contract_number) <= 50);
ALTER TABLE contracts ADD CONSTRAINT chk_contracts_contract_type_length
  CHECK (contract_type IS NULL OR length(contract_type) <= 50);
ALTER TABLE contracts ADD CONSTRAINT chk_contracts_status_length
  CHECK (status IS NULL OR length(status) <= 50);
ALTER TABLE contracts ADD CONSTRAINT chk_contracts_billing_frequency_length
  CHECK (billing_frequency IS NULL OR length(billing_frequency) <= 50);
ALTER TABLE contracts ADD CONSTRAINT chk_contracts_terms_length
  CHECK (terms IS NULL OR length(terms) <= 10000);
ALTER TABLE contracts ADD CONSTRAINT chk_contracts_notes_length
  CHECK (notes IS NULL OR length(notes) <= 5000);
ALTER TABLE contracts ADD CONSTRAINT chk_contracts_document_url_length
  CHECK (document_url IS NULL OR length(document_url) <= 2048);

-- ============================================================
-- SEGMENTS
-- ============================================================
ALTER TABLE segments ADD CONSTRAINT chk_segments_name_length
  CHECK (name IS NULL OR length(name) <= 255);
ALTER TABLE segments ADD CONSTRAINT chk_segments_description_length
  CHECK (description IS NULL OR length(description) <= 2000);
ALTER TABLE segments ADD CONSTRAINT chk_segments_entity_type_length
  CHECK (entity_type IS NULL OR length(entity_type) <= 50);

-- ============================================================
-- PORTAL CLIENTS
-- ============================================================
ALTER TABLE portal_clients ADD CONSTRAINT chk_portal_clients_name_length
  CHECK (name IS NULL OR length(name) <= 255);
ALTER TABLE portal_clients ADD CONSTRAINT chk_portal_clients_email_length
  CHECK (email IS NULL OR length(email) <= 255);
ALTER TABLE portal_clients ADD CONSTRAINT chk_portal_clients_access_token_length
  CHECK (access_token IS NULL OR length(access_token) <= 255);

-- ============================================================
-- TASKS (additional columns beyond 0053)
-- ============================================================
ALTER TABLE tasks ADD CONSTRAINT chk_tasks_status_length
  CHECK (status IS NULL OR length(status) <= 50);
ALTER TABLE tasks ADD CONSTRAINT chk_tasks_priority_length
  CHECK (priority IS NULL OR length(priority) <= 50);
