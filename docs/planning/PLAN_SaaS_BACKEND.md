# CRM as SaaS Backend — Extensibility Plan

## Vision

Transform the CRM from a fixed-schema application into a **programmable backend** that:

- Accepts **any data type** from integrations
- Supports **custom entities** created by tenants
- Can be **sold as an API** to other SaaS platforms
- Handles **file storage** via S3/R2
- Supports **bulk data import** for onboarding
- Enables **field-level encryption** for sensitive data
- Supports **API versioning** for backward compatibility

---

## Current Architecture Analysis

### What Exists Today

| Component                | Status      | Tables | Notes                                    |
| ------------------------ | ----------- | ------ | ---------------------------------------- |
| Multi-tenancy            | ✅ Complete | All    | RLS policies, tenant_id on every table   |
| Custom fields            | ✅ Complete | 7      | JSONB column, 64KB limit                 |
| Metadata bag             | ✅ Complete | 81     | JSONB column, catch-all storage          |
| Custom field definitions | ✅ Complete | 1      | Schema-on-read for custom fields         |
| File attachments         | ⚠️ Partial  | 1      | Local FS only, no S3                     |
| Storage documents        | ⚠️ Partial  | 1      | Schema exists, no implementation         |
| Entity linking           | ✅ Complete | 1      | 16 entity types, any-to-any              |
| Tags                     | ✅ Complete | 2      | Unlimited tags per entity                |
| CHECK constraints        | ✅ Complete | 154    | Status, type, amount, email, text length |
| JSONB safety             | ✅ Complete | 20     | Size, depth, key count limits            |
| FK constraints           | ✅ Complete | 487    | All validated, all indexed               |

### What's Missing

| Component                   | Status     | Impact                        | Effort |
| --------------------------- | ---------- | ----------------------------- | ------ |
| S3 file storage             | ❌ Missing | Files lost on restart         | 4h     |
| Dynamic entity creation     | ❌ Missing | Can't add new tables          | 8h     |
| Custom relationships        | ❌ Missing | Can't define new FKs          | 4h     |
| Data import API             | ❌ Missing | Can't bulk load data          | 4h     |
| Field-level encryption      | ❌ Missing | Sensitive data exposed        | 6h     |
| API versioning              | ❌ Missing | Custom fields break contracts | 4h     |
| Webhook field mapping table | ❌ Missing | Already coded, needs DB table | 1h     |

---

## Feature Specifications

### Feature 1: S3/R2 File Storage

**Problem**: Files stored in `uploads/` directory, lost on container restart, can't scale horizontally.

**Solution**: Use S3-compatible storage (AWS S3, Cloudflare R2, MinIO).

**Architecture**:

```
Client → POST /api/tenant/files (multipart)
       → Validate MIME type + size
       → Generate unique key: tenants/{tenantId}/files/{uuid}.{ext}
       → Upload to S3
       → Store metadata in file_attachments table
       → Return { id, url, key }

Client → GET /api/tenant/files/:id/download
       → Generate presigned URL (expires in 15 min)
       → Return { downloadUrl }
```

**Database Changes**:

```sql
-- file_attachments already exists, no schema changes needed
-- Just need to implement S3 client in lib/storage/s3.ts
```

**Files to Create/Modify**:

- `lib/storage/s3.ts` — S3 client wrapper (new)
- `lib/storage/presign.ts` — Presigned URL generation (new)
- `app/api/tenant/files/route.ts` — Update upload handler
- `app/api/tenant/files/[id]/download/route.ts` — Add presigned download
- `.env.example` — Add S3 config vars

**Configuration**:

```env
# Storage (S3/R2)
S3_ENDPOINT=https://s3.amazonaws.com
S3_ACCESS_KEY_ID=your-access-key
S3_SECRET_ACCESS_KEY=your-secret-key
S3_BUCKET=nucrm-files
S3_REGION=us-east-1
```

**Risks**:

- S3 latency on every file access
- Need to handle S3 failures gracefully
- Presigned URL security (expiration, IP restrictions)

---

### Feature 2: Dynamic Entity Registry

**Problem**: Can't create new entity types — schema is fixed at 222 tables.

**Solution**: Entity registry table + generic JSONB storage.

**Architecture**:

```
Tenant creates entity type:
  POST /api/tenant/custom-entities
  Body: {
    name: "invoices_v2",
    displayName: "Invoice V2",
    schema: {
      columns: [
        { name: "invoice_number", type: "text", required: true },
        { name: "amount", type: "decimal", required: true },
        { name: "status", type: "text", enum: ["draft","sent","paid"] },
        { name: "due_date", type: "date" },
        { name: "metadata", type: "jsonb" }
      ],
      relationships: [
        { name: "contact", type: "belongs_to", entity: "contacts" }
      ]
    }
  }

Tenant creates row:
  POST /api/tenant/custom-entities/{entityId}/data
  Body: {
    invoice_number: "INV-001",
    amount: 1500.00,
    status: "draft",
    due_date: "2026-09-01",
    contact_id: "uuid-of-contact"
  }
```

**Database Schema**:

```sql
-- Entity type definitions
CREATE TABLE custom_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  entity_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  schema JSONB NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  UNIQUE(tenant_id, entity_name)
);

-- Generic data storage
CREATE TABLE custom_entity_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  entity_id UUID NOT NULL REFERENCES custom_entities(id),
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_custom_entity_data_tenant ON custom_entity_data(tenant_id);
CREATE INDEX idx_custom_entity_data_entity ON custom_entity_data(entity_id);
CREATE INDEX idx_custom_entity_data_entity_tenant ON custom_entity_data(entity_id, tenant_id);
```

**API Endpoints**:

```
POST   /api/tenant/custom-entities              — create entity type
GET    /api/tenant/custom-entities              — list entity types
GET    /api/tenant/custom-entities/:id          — get entity type
PATCH  /api/tenant/custom-entities/:id          — update entity type
DELETE /api/tenant/custom-entities/:id          — delete entity type

POST   /api/tenant/custom-entities/:id/data     — create row
GET    /api/tenant/custom-entities/:id/data     — list rows (with filtering)
GET    /api/tenant/custom-entities/:id/data/:rowId — get row
PATCH  /api/tenant/custom-entities/:id/data/:rowId — update row
DELETE /api/tenant/custom-entities/:id/data/:rowId — delete row
```

**Validation**:

- Schema validation on entity creation (column types, required fields)
- Data validation on row creation (type checking, enum validation)
- CHECK constraints enforced via application layer (not DB, since data is JSONB)

**Risks**:

- No DB-level CHECK constraints on JSONB data (application-level only)
- No DB-level JOIN support (must query separately)
- Performance degradation with large datasets (no column indexes)
- Complex queries (aggregations, JOINs) not possible

---

### Feature 3: Data Import API

**Problem**: Can't bulk-load custom data for onboarding new tenants.

**Solution**: Generic import endpoint with field mapping.

**Architecture**:

```
Client → POST /api/tenant/import
       → { entity: "contacts", format: "csv", data: "...", mappings: {...} }
       → Parse CSV/JSON
       → Map fields (source → target)
       → Validate each row (CHECK constraints)
       → Insert/update in batches (1000 rows/batch)
       → Return { jobId, totalRows, successCount, errorCount, errors: [...] }
```

**API Endpoint**:

```
POST /api/tenant/import
Content-Type: application/json
{
  "entity": "contacts",
  "format": "csv",
  "data": "first_name,last_name,email\nJohn,Doe,john@example.com",
  "mappings": {
    "first_name": "firstName",
    "last_name": "lastName",
    "email": "email"
  },
  "options": {
    "upsert": true,
    "upsert_key": "email",
    "skip_duplicates": true,
    "validate": true,
    "batch_size": 1000
  }
}
```

**Response**:

```json
{
  "jobId": "import-uuid",
  "status": "completed",
  "totalRows": 10000,
  "successCount": 9950,
  "errorCount": 50,
  "errors": [
    { "row": 42, "error": "Invalid email format", "data": {...} },
    { "row": 108, "error": "Duplicate email", "data": {...} }
  ]
}
```

**Database Changes**:

```sql
-- Import job tracking
CREATE TABLE import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  entity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, running, completed, failed
  total_rows INTEGER,
  success_count INTEGER,
  error_count INTEGER,
  errors JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);
```

**Risks**:

- Large imports can timeout (need async processing)
- Memory usage for large CSV files (streaming needed)
- Partial failures (need rollback strategy)

---

### Feature 4: Field-Level Encryption

**Problem**: Sensitive custom data (SSN, credit card, API keys) stored unencrypted.

**Solution**: Encrypt sensitive fields before write, decrypt on read.

**Architecture**:

```
Client → POST /api/tenant/contacts
       → { first_name: "John", ssn: "123-45-6789" }
       → Field marked as is_encrypted in custom_field_defs
       → Encrypt ssn before DB write
       → Store encrypted value in custom_fields.ssn
       → Return { first_name: "John", ssn: "***-**-6789" }  // masked

Client → GET /api/tenant/contacts/:id
       → Read encrypted value from DB
       → Decrypt ssn
       → Return { first_name: "John", ssn: "123-45-6789" }
```

**Database Changes**:

```sql
-- Mark fields as encrypted
ALTER TABLE custom_field_defs ADD COLUMN is_encrypted BOOLEAN DEFAULT false;

-- Encrypted fields storage (separate table for key management)
CREATE TABLE field_encryption_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  field_key TEXT NOT NULL,
  encryption_key BYTEA NOT NULL,  -- AES-256 key
  created_at TIMESTAMPTZ DEFAULT now(),
  rotated_at TIMESTAMPTZ,
  UNIQUE(tenant_id, field_key)
);
```

**Encryption Implementation**:

```typescript
// lib/security/field-encryption.ts
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";

export function encryptField(
  value: string,
  key: Buffer,
): { encrypted: string; iv: string; tag: string } {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = cipher.update(value, "utf8", "hex") + cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  return { encrypted, iv: iv.toString("hex"), tag };
}

export function decryptField(
  encrypted: string,
  key: Buffer,
  iv: string,
  tag: string,
): string {
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, "hex"));
  decipher.setAuthTag(Buffer.from(tag, "hex"));
  return decipher.update(encrypted, "hex", "utf8") + decipher.final("utf8");
}
```

**Risks**:

- Encrypted fields can't be searched/indexed
- Key management complexity (rotation, backup)
- Performance overhead on read/write
- Need to handle key loss (data becomes unreadable)

---

### Feature 5: API Versioning

**Problem**: Custom fields break API contracts — adding a field changes the response shape.

**Solution**: Versioned API endpoints.

**Architecture**:

```
/api/v1/contacts      →  current schema (no custom fields in response)
/api/v2/contacts      →  schema with custom fields included
/api/v1/custom-entities/:id/data  →  custom entity CRUD
```

**Implementation**:

```typescript
// app/api/v1/contacts/route.ts
export async function GET(req: NextRequest) {
  const contacts = await db.query.contacts.findMany();
  // V1: Strip custom_fields from response
  return NextResponse.json(
    contacts.map((c) => ({ ...c, custom_fields: undefined })),
  );
}

// app/api/v2/contacts/route.ts
export async function GET(req: NextRequest) {
  const contacts = await db.query.contacts.findMany();
  // V2: Include custom_fields
  return NextResponse.json(contacts);
}
```

**Version Negotiation**:

```
# Via URL path (recommended)
GET /api/v1/contacts
GET /api/v2/contacts

# Via header (alternative)
GET /api/contacts
Accept-Version: v2
```

**Risks**:

- Code duplication between v1 and v2
- Need to maintain backward compatibility
- Migration path for existing API consumers

---

### Feature 6: Custom Relationships

**Problem**: Can't define new FK relationships between entities.

**Solution**: Relationship registry table.

**Database Schema**:

```sql
CREATE TABLE custom_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,                  -- e.g., 'contact_invoices'
  source_entity TEXT NOT NULL,         -- e.g., 'contacts'
  target_entity TEXT NOT NULL,         -- e.g., 'invoices'
  relationship_type TEXT NOT NULL,     -- 'one_to_many', 'many_to_many', 'belongs_to'
  foreign_key_column TEXT,             -- e.g., 'contact_id'
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, name)
);
```

**API Endpoints**:

```
POST   /api/tenant/custom-relationships       — create relationship
GET    /api/tenant/custom-relationships       — list relationships
DELETE /api/tenant/custom-relationships/:id   — delete relationship
```

**Risks**:

- No DB-level FK enforcement (application-level only)
- Complex JOIN queries not possible
- Cascading deletes must be implemented in application layer

---

### Feature 7: Webhook Field Mapping Table

**Problem**: Code exists in `lib/webhooks/field-mapping.ts` but the database table doesn't exist.

**Solution**: Create the missing table.

**Database Schema**:

```sql
CREATE TABLE webhook_field_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  api_key_id UUID,                      -- NULL = tenant-wide default
  entity_type TEXT NOT NULL,            -- 'contact', 'lead', 'deal', 'company', 'task'
  source_key TEXT NOT NULL,             -- incoming key name
  target_type TEXT NOT NULL,            -- 'native' or 'custom_field'
  target_key TEXT NOT NULL,             -- target column or custom field key
  transform TEXT,                       -- 'string', 'number', 'boolean', 'date', 'trim', 'lowercase'
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);
```

**Risks**:

- Low risk (code already exists)
- Just needs DB table creation

---

## Implementation Phases

### Phase 1: Foundation (Week 1)

1. **S3 File Storage** (4h)
   - Create `lib/storage/s3.ts`
   - Update file upload handler
   - Add presigned URL support
   - Test with MinIO locally

2. **Webhook Field Mapping Table** (1h)
   - Create missing DB table
   - Run migration
   - Verify existing code works

### Phase 2: Dynamic Entities (Week 2)

3. **Entity Registry** (8h)
   - Create `custom_entities` table
   - Create `custom_entity_data` table
   - Build CRUD API for entity types
   - Build CRUD API for entity data
   - Add schema validation
   - Add filtering/search

### Phase 3: Data Management (Week 3)

4. **Data Import API** (4h)
   - Create `import_jobs` table
   - Build CSV/JSON parser
   - Add field mapping
   - Add batch processing
   - Add error handling

5. **Field-Level Encryption** (6h)
   - Create `field_encryption_keys` table
   - Implement encryption/decryption
   - Update custom_fields handling
   - Add key rotation support

### Phase 4: API Polish (Week 4)

6. **API Versioning** (4h)
   - Create `/api/v1/` routes
   - Create `/api/v2/` routes
   - Add version negotiation
   - Update documentation

7. **Custom Relationships** (4h)
   - Create `custom_relationships` table
   - Build CRUD API
   - Add relationship enforcement

---

## Risk Assessment

### High Risk

- **Dynamic Entity Registry**: JSONB storage means no DB-level constraints, no JOINs, poor performance at scale
- **Field-Level Encryption**: Key management is complex, encrypted fields can't be searched

### Medium Risk

- **S3 File Storage**: Need to handle S3 failures, latency, and cost
- **Data Import API**: Large imports can timeout, memory usage concerns

### Low Risk

- **Webhook Field Mapping**: Code already exists, just needs DB table
- **API Versioning**: Straightforward but adds code duplication
- **Custom Relationships**: Application-level enforcement only

---

## Cost Analysis

### S3 Storage Costs

- Standard: $0.023/GB/month
- 10TB storage: ~$230/month
- 1M PUT requests: ~$5
- 10M GET requests: ~$4

### Encryption Costs

- CPU overhead: ~5-10% on read/write
- Key management: Internal (no external service)

### Performance Impact

- S3 latency: 50-200ms (vs 1ms local)
- Encryption: 1-5ms per field
- JSONB queries: 10-100x slower than column queries

---

## Success Criteria

### Must Have

- [ ] Files uploaded to S3 survive container restart
- [ ] Tenant can create custom entity via API
- [ ] Tenant can CRUD rows in custom entity
- [ ] Sensitive fields encrypted at rest
- [ ] API v1 backward compatible

### Should Have

- [ ] Bulk import 10K records in < 5 minutes
- [ ] Presigned URLs for file upload/download
- [ ] Custom relationships enforced at application level
- [ ] Webhook field mapping working

### Nice to Have

- [ ] API version negotiation via header
- [ ] Key rotation for encrypted fields
- [ ] Import job async processing

---

## Open Questions — RESOLVED

> All questions answered 2026-08-04. Decisions based on current architecture (self-hosted MinIO, PostgreSQL, single-VM).

### Q1: Dynamic Entities — DB Constraints or App-Level Only?

**Answer: Option C — Hybrid**

- App-level validation for speed (Zod schemas on every route)
- DB-level CHECK constraints for critical fields (status enums, type fields)
- No DB triggers (maintenance burden, migration complexity)
- Rationale: We already do this pattern — CHECK constraints on status/type, JSONB validation at app layer

### Q2: Encryption — Managed KMS or Self-Managed Keys?

**Answer: Option C — Hybrid**

- Master key in environment variable (`ENCRYPTION_KEY` already exists in .env)
- Field keys derived via HKDF from master key
- No external KMS dependency (self-hosted, cost-sensitive)
- Key rotation: re-encrypt on write, lazy decryption on read
- Rationale: Already have `ENCRYPTION_KEY` in auth/sso/state.ts, proven pattern

### Q3: API Versioning — How Long to Maintain v1?

**Answer: Option B — 12 months after v2 launch**

- Standard industry practice (Stripe, GitHub, Twilio all do 12 months)
- Gives integrators time to migrate without breaking their apps
- After 12 months, v1 returns `410 Gone` with migration link

### Q4: Import — Streaming for Large Files?

**Answer: Option C — Chunked processing (1000 rows at a time)**

- Memory-safe without streaming complexity
- 1000 rows ≈ 5MB worst case (generous row estimate)
- Progress tracking per chunk (easy to resume on failure)
- Rationale: Matches existing CSV import pattern in data import route

### Q5: Relationships — Real FKs or Virtual Relationships?

**Answer: Option A — Application-level only**

- No DB-level FKs on custom entities (can't alter existing tables without downtime)
- Application enforces referential integrity via queries
- Custom entity data stored in JSONB with `entity_type` + `entity_id` references
- Audit log tracks relationship changes
- Rationale: Dynamic entities are inherently schema-flexible; DB FKs require DDL changes

### Q6: S3 Provider — Which S3-Compatible Service?

**Answer: Option D — Support all via config (already done)**

- `s3-config.ts` already supports AWS S3, Cloudflare R2, and MinIO
- Config via env vars: `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, etc.
- `forcePathStyle: true` for non-AWS endpoints (MinIO)
- Rationale: This is already implemented and working

### Q7: Custom Entity Limits — How Many Per Tenant?

**Answer: Option B — Plan-based limits**

- Free: 5 custom entities
- Pro: 50 custom entities
- Enterprise: unlimited
- Enforced via `custom_entities` table count + plan check middleware
- Rationale: Matches existing pattern (contacts, deals, users all have plan limits)

### Q8: Import Limits — Max Rows Per Import?

**Answer: Option B — Plan-based limits**

- Free: 1,000 rows per import
- Pro: 100,000 rows per import
- Enterprise: unlimited
- Enforced via `import_jobs` table + plan check before processing
- Rationale: Consistent with all other resource limits in the system

---

## Related Issues

- #1000 — Landing audit (database safety)
- #1015 — FK integrity + CHECK constraints (merged)
- #1016 — This issue (CRM as SaaS Backend)
- #435 — Customer self-service portal
- #436 — Embeddable form JS widget

---

## Labels

`enhancement` `database` `api` `saas-readiness` `priority/critical` `epic`
