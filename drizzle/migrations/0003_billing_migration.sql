CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid,
	"company_id" uuid,
	"title" text NOT NULL,
	"contract_number" text,
	"contract_type" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"signed_at" timestamp with time zone,
	"renewed_at" timestamp with time zone,
	"total_value" numeric(15, 2),
	"billing_frequency" text,
	"terms" text,
	"notes" text,
	"document_url" text,
	"parent_contract_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "invoice_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"product_id" uuid,
	"service_id" uuid,
	"description" text NOT NULL,
	"item_type" text NOT NULL,
	"quantity" numeric(15, 4) DEFAULT '1' NOT NULL,
	"unit_price" numeric(15, 2) NOT NULL,
	"discount_type" text DEFAULT 'percentage',
	"discount_value" numeric(15, 2) DEFAULT '0',
	"discount_amount" numeric(15, 2) DEFAULT '0',
	"tax_rate" numeric(5, 2) DEFAULT '0',
	"tax_amount" numeric(15, 2) DEFAULT '0',
	"total" numeric(15, 2) NOT NULL,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "invoice_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount" numeric(15, 2) NOT NULL,
	"payment_date" date NOT NULL,
	"payment_method" text,
	"reference" text,
	"notes" text,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid,
	"company_id" uuid,
	"invoice_number" text NOT NULL,
	"title" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date,
	"sent_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"subtotal" numeric(15, 2) DEFAULT '0' NOT NULL,
	"discount_type" text DEFAULT 'percentage',
	"discount_value" numeric(15, 2) DEFAULT '0',
	"discount_amount" numeric(15, 2) DEFAULT '0',
	"tax_amount" numeric(15, 2) DEFAULT '0',
	"tax_rate" numeric(5, 2) DEFAULT '0',
	"total_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"amount_paid" numeric(15, 2) DEFAULT '0',
	"balance_due" numeric(15, 2) DEFAULT '0',
	"currency" text DEFAULT 'USD',
	"notes" text,
	"terms" text,
	"footer" text,
	"quote_id" uuid,
	"order_id" uuid,
	"payment_method" text,
	"payment_reference" text,
	"is_recurring" boolean DEFAULT false,
	"recurring_frequency" text,
	"next_billing_date" date,
	"parent_invoice_id" uuid,
	"sent_reminder" boolean DEFAULT false,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "order_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid,
	"service_id" uuid,
	"description" text NOT NULL,
	"item_type" text NOT NULL,
	"quantity" numeric(15, 4) DEFAULT '1' NOT NULL,
	"unit_price" numeric(15, 2) NOT NULL,
	"total" numeric(15, 2) NOT NULL,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"contact_id" uuid,
	"company_id" uuid,
	"order_number" text NOT NULL,
	"title" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"order_date" date NOT NULL,
	"expected_delivery_date" date,
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"subtotal" numeric(15, 2) DEFAULT '0' NOT NULL,
	"discount_amount" numeric(15, 2) DEFAULT '0',
	"tax_amount" numeric(15, 2) DEFAULT '0',
	"shipping_amount" numeric(15, 2) DEFAULT '0',
	"total_amount" numeric(15, 2) DEFAULT '0' NOT NULL,
	"shipping_address" text,
	"shipping_city" text,
	"shipping_state" text,
	"shipping_country" text,
	"shipping_postal_code" text,
	"tracking_number" text,
	"shipping_carrier" text,
	"billing_address" text,
	"billing_city" text,
	"billing_state" text,
	"billing_country" text,
	"billing_postal_code" text,
	"notes" text,
	"customer_notes" text,
	"quote_id" uuid,
	"invoice_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "service_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text DEFAULT '#6366f1',
	"icon" text,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_by" uuid
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"pricing_type" text DEFAULT 'fixed' NOT NULL,
	"unit_price" numeric(15, 2),
	"hourly_rate" numeric(15, 2),
	"monthly_price" numeric(15, 2),
	"yearly_price" numeric(15, 2),
	"tax_rate" numeric(5, 2) DEFAULT '0',
	"taxable" boolean DEFAULT true,
	"currency" text DEFAULT 'USD',
	"is_active" boolean DEFAULT true,
	"is_featured" boolean DEFAULT false,
	"duration_minutes" integer,
	"duration_hours" integer,
	"image_url" text,
	"times_used" integer DEFAULT 0,
	"total_revenue" numeric(15, 2) DEFAULT '0',
	"tags" text[] DEFAULT '{}',
	"custom_fields" jsonb DEFAULT '{}'::jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"deleted_by" uuid
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_categories" ADD CONSTRAINT "service_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_categories" ADD CONSTRAINT "service_categories_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_categories" ADD CONSTRAINT "service_categories_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_categories" ADD CONSTRAINT "service_categories_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_contracts_tenant" ON "contracts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_contracts_contact" ON "contracts" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "idx_contracts_company" ON "contracts" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_contracts_status" ON "contracts" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_contracts_active" ON "contracts" USING btree ("id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_invoice_line_items_invoice" ON "invoice_line_items" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "idx_invoice_payments_invoice" ON "invoice_payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "idx_invoice_payments_date" ON "invoice_payments" USING btree ("payment_date");--> statement-breakpoint
CREATE INDEX "idx_invoices_tenant" ON "invoices" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_invoices_number" ON "invoices" USING btree ("tenant_id","invoice_number");--> statement-breakpoint
CREATE INDEX "idx_invoices_contact" ON "invoices" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "idx_invoices_company" ON "invoices" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_invoices_status" ON "invoices" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_invoices_due_date" ON "invoices" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "idx_invoices_active" ON "invoices" USING btree ("id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_order_line_items_order" ON "order_line_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_orders_tenant" ON "orders" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_orders_number" ON "orders" USING btree ("tenant_id","order_number");--> statement-breakpoint
CREATE INDEX "idx_orders_contact" ON "orders" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "idx_orders_company" ON "orders" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_orders_status" ON "orders" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_orders_active" ON "orders" USING btree ("id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_service_categories_tenant" ON "service_categories" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_service_categories_name" ON "service_categories" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_services_tenant" ON "services" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_services_name" ON "services" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_services_category" ON "services" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_services_active" ON "services" USING btree ("id") WHERE deleted_at IS NULL;