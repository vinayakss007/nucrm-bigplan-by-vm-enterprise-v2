# Issue: Structured UUID/ID System — Org-Aware, Hierarchical, Semantic IDs

**Labels:** `enhancement` `architecture` `database` `multi-tenant`
**Milestone:** Structured ID System — Phase 1: Foundation
**Assignee:** TBD

---

## Problem Statement

### Current State

NuCRM uses **random UUID v4 primary keys** across **211 of 219 tables** via the `utils.pk()` helper:

```typescript
// drizzle/schema/utils.ts
export const pk = () => uuid("id").primaryKey().defaultRandom();
```

This generates PostgreSQL `gen_random_uuid()` values like:

```
550e8400-e29b-41d4-a716-446655440000
```

### Why This Is a Problem

**1. Zero Semantic Meaning**

- Random UUIDs carry **no information** about what entity they represent
- Can't tell if an ID belongs to a contact, deal, invoice, or user just by looking at it
- Debugging requires DB lookups for basic context

**2. No Org Awareness**

- In a multi-tenant system with 1000+ users, there's no way to know which organization an ID belongs to without querying the database
- On system restart, the app has **zero built-in knowledge** of ID-to-org mapping
- Audit logs, error traces, and support tickets reference opaque UUIDs

**3. Poor Developer Experience**

- Copy-pasting an ID into a search gives no context
- Logs filled with meaningless UUID strings
- No visual distinction between entity types in admin panels

**4. Scaling Concerns**

- With 1000+ users generating records, UUID collisions (while astronomically unlikely) provide no protection
- No way to batch-process records by org without full table scans
- Cross-tenant debugging is opaque

### Current Schema Breakdown

| Pattern                                                  | Count   | Description                                 |
| -------------------------------------------------------- | ------- | ------------------------------------------- |
| `utils.pk()` — `uuid('id').primaryKey().defaultRandom()` | **211** | Standard UUID PK                            |
| `text('id').primaryKey()`                                | **3**   | Human-readable (modules, plans, audit logs) |
| Inline `uuid('id').defaultRandom().primaryKey()`         | **2**   | Same as utils.pk(), not using helper        |
| Composite PKs (no `id` column)                           | **3**   | Junction/tag tables                         |
| **Total tables**                                         | **219** | —                                           |

**Tables with `tenantId`:** ~171 (multi-tenant aware)

---

## Proposed Solution: Structured IDs with Org/Entity Prefix

### Format: `<org-code>-<entity-code>-<base62-uuid>`

```
AC01-DL-4wr7jBDTEqVBCsXEih4zfP
│     │   └── unique identifier (base62-encoded UUID, 22 chars)
│     └── entity type code (2-4 chars)
└── org short code (from tenants.short_code, 2-6 chars)
```

### Example IDs

| Entity         | Structured ID                     | What It Tells You          |
| -------------- | --------------------------------- | -------------------------- |
| User           | `AC01-US-4wr7jBDTEqVBCsXEih4zfP`  | User in org AC01           |
| Deal           | `AC01-DL-8x9p3q1rTnKmWxYzAbCdEf`  | Deal in org AC01           |
| Contact        | `BI01-CT-Kj8mN2pQ4rStUvWxYzAbCd`  | Contact in org BI01        |
| Invoice        | `AC01-IN-a1b2c3d4-e5f6-7890-abcd` | Invoice in org AC01        |
| Support Ticket | `AC01-SB-x9y8z7w6v5u4t3s2r1q0p`   | Support ticket in org AC01 |

### System Awareness

**On startup:** Load org registry from DB

```typescript
// lib/id.ts
let orgRegistry: Map<string, string> = new Map(); // shortCode → tenantId

export async function loadOrgRegistry(db) {
  const tenants = await db.select({
    id: tenants.id,
    shortCode: tenants.shortCode,
  });
  for (const t of tenants) {
    orgRegistry.set(t.shortCode, t.id);
  }
}
```

**Parse any ID without DB:**

```typescript
const parsed = parseId("AC01-DL-4wr7jBDTEqVBCsXEih4zfP");
// → { orgCode: "AC01", entityCode: "DL", entityName: "deals", tenantId: "t_abc123" }
```

---

## Entity Type Code Registry

### Platform-level (no org prefix)

| Code | Entity |
| ---- | ------ |
| `US` | User   |
| `PL` | Plan   |
| `MO` | Module |

### Tenant-scoped

| Code | Entity               | Code | Entity               |
| ---- | -------------------- | ---- | -------------------- |
| `OR` | Organization/Tenant  | `RL` | Role                 |
| `TM` | TenantMember         | `CO` | Company              |
| `CT` | Contact              | `LD` | Lead                 |
| `DL` | Deal                 | `PI` | Pipeline Stage       |
| `TK` | Task                 | `PJ` | Project              |
| `AR` | Activity             | `EV` | Event                |
| `IN` | Invoice              | `PM` | Payment Method       |
| `QM` | Quote/Estimate       | `PT` | Product              |
| `PR` | Product Variant      | `FG` | Product Flag         |
| `FO` | Form                 | `FR` | Form Response        |
| `WA` | Webhook              | `WH` | Webhook Delivery     |
| `AU` | Automation           | `AT` | Automation Trigger   |
| `AC` | Automation Condition | `AE` | Automation Execution |
| `SQ` | Email Sequence       | `SE` | Sequence Enroll      |
| `EM` | Email Message        | `SB` | Support Ticket       |
| `TR` | Thread/Comment       | `CS` | CSAT Survey          |
| `AT` | Attachment           | `SG` | Saved View/Segment   |
| `TL` | Tag                  | `SH` | Share/Permission     |
| `RP` | Report               | `NT` | Notification         |
| `KE` | API Key              | `TF` | Tenant Feature       |
| `IP` | Integration/Provider | `IH` | Integration History  |
| `DV` | Device               | `SS` | Session              |
| `SC` | Refresh Token        | `PR` | Password Reset       |
| `OI` | OAuth Identity       | `PS` | Permission State     |
| `CA` | Cron Activity        | `EL` | Error Log            |
| `UL` | Usage Log            | `SE` | Security Event       |
| `AP` | Audit/History        | `AH` | Activity History     |
| `CD` | Custom Dashboard     | `DI` | Dashboard Item       |
| `DT` | Dashboard Template   | `CE` | Cron Event           |
| `IS` | Instance State       | `CP` | Cron Policy          |
| `CN` | Cron Node            | `CD` | Cron DAG             |
| `CR` | Cron Run             | —    | —                    |

---

## Implementation Plan

### Phase 1: Foundation (This Sprint)

**Step 1: Add `short_code` column to `tenants` table**

```sql
ALTER TABLE tenants ADD COLUMN short_code VARCHAR(6) UNIQUE;
-- Backfill existing tenants
UPDATE tenants SET short_code = UPPER(SUBSTRING(slug FROM 1 FOR 4));
ALTER TABLE tenants ALTER COLUMN short_code SET NOT NULL;
```

**Step 2: Create `lib/id.ts` — ID generator and parser**

- `generateId(tenantId, entityName)` → structured ID
- `parseId(id)` → decoded context (org, entity type, tenant ID)
- `loadOrgRegistry(db)` → load on startup
- Base62 ↔ UUID conversion helpers

**Step 3: Update `drizzle/schema/utils.ts`**

```typescript
import { generateId } from "@/lib/id";

export const pk = (entityName: string) =>
  text("id")
    .primaryKey()
    .$defaultFn(() => generateId(currentTenantId(), entityName));
```

**Step 4: Update app startup to load org registry**

- Call `loadOrgRegistry()` in `app/layout.tsx` or `lib/db.ts`

### Phase 2: Migration (Next Sprint)

**Step 5: Background migration job**

- Scan all tables with UUID PKs
- Generate structured ID for each existing record
- Update all foreign key references
- Run during low-traffic window
- Include rollback mechanism

**Step 6: Update API routes** that manually create UUIDs

- OAuth token generation
- Portal session tokens
- Email tracking IDs
- (These may keep random format since they're not entity PKs)

### Phase 3: Optimization (Month 3)

**Step 7: Add database indexes** on `short_code` lookups

**Step 8: Update admin panels** to display structured IDs with color coding

**Step 9: Update logging** to include parsed ID context (org, entity type)

**Step 10: Update error tracking** with org/entity context in traces

---

## Risks & Mitigations

| Risk                                   | Impact   | Mitigation                                                                 |
| -------------------------------------- | -------- | -------------------------------------------------------------------------- |
| Org code collision (AC01 exists twice) | High     | Sequential numbering + unique constraint on `short_code`                   |
| Migration breaks foreign keys          | Critical | Phased rollout: new records get structured IDs first, old UUIDs still work |
| Performance impact (text vs uuid PK)   | Low      | Text PKs slightly slower for indexing, negligible at <10M rows             |
| ID length increase (26→35 chars)       | Low      | Still fits in varchar/text, no DB schema change needed                     |
| System restart loses org registry      | Medium   | Registry loaded from DB on startup, cached in memory                       |
| Existing API consumers break           | Medium   | Old UUID format still parseable (fallback in `parseId()`)                  |

---

## Industry References

| Company              | Pattern                        | Notes                                     |
| -------------------- | ------------------------------ | ----------------------------------------- |
| **Stripe**           | `cus_xxx`, `usr_xxx`, `in_xxx` | Prefix tells entity type, no org encoding |
| **CockroachDB**      | `region/nid/table/id`          | Hierarchical, org-aware                   |
| **EUID (UUID v8)**   | Encoded topology in bit fields | Compact but complex                       |
| **ULID/KSUID**       | Time-ordered + random          | Good for sorting, no org encoding         |
| **django-prefix-id** | `prefix_base62_uuid`           | Django ecosystem pattern                  |

Our approach combines **Stripe's prefix simplicity** with **CockroachDB's org-awareness** for the best of both worlds.

---

## Future Extension

If departments become a first-class entity in the schema, extend the format:

```
AC01-ENGR-DL-4wr7jBDTEqVBCsXEih4zfP
│     │     │   └── unique identifier
│     │     └── entity type code
│     └── department code (4 chars)
└── org short code
```

---

## Acceptance Criteria

- [ ] `lib/id.ts` created with `generateId()`, `parseId()`, `loadOrgRegistry()`
- [ ] `tenants` table has `short_code` column (VARCHAR(6), UNIQUE, NOT NULL)
- [ ] `utils.pk()` generates structured IDs for new records
- [ ] Org registry loads on app startup
- [ ] Any ID can be parsed to reveal org + entity type
- [ ] Existing UUID records still work (backward compatibility)
- [ ] Background migration job created (can run manually)
- [ ] Unit tests for ID generation and parsing
- [ ] Documentation updated with ID format reference

---

## Questions for Discussion

1. **Short code length:** 4 chars enough? (26^4 = 456K unique orgs) Or 6 chars for safety?
2. **Migration timeline:** Can we do a full migration in one sprint, or need phased approach?
3. **Manual UUID routes:** Should OAuth tokens, tracking IDs, etc. also use structured format, or keep random?
4. **Backward compatibility:** How long do we support parsing old UUID format?
