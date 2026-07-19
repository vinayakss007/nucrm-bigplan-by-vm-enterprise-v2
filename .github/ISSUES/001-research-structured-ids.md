# Research: Structured ID Systems for Multi-Tenant CRM

## Problem Analysis

### Current Schema Statistics

- **219 total tables** in NuCRM schema
- **211 tables** use `utils.pk()` → `uuid('id').primaryKey().defaultRandom()`
- **3 tables** use `text('id').primaryKey()` (modules, plans, audit logs)
- **3 tables** use composite PKs (junction/tag tables)
- **2 tables** use inline UUID (not using shared helper)
- **~171 tables** have `tenantId` foreign key

### Key Finding

Zero existing structured ID infrastructure. No nanoid, ksuid, ulid, or prefix logic anywhere in the codebase.

---

## Industry Patterns Researched

### 1. Stripe-Style Prefix IDs

**Format:** `<entity>_<base62-uuid>`
**Examples:** `cus_4wr7jBDTEqVBCsXEih4zfP`, `usr_8x9p3q1rTnKmWxYzAbCdEf`
**Used by:** Stripe, OpenAI, CockroachDB

**Pros:**

- Human readable — know entity type from prefix
- URL-safe characters
- Easy to parse with regex

**Cons:**

- No org/department encoding in the ID
- Requires DB lookup for tenant context
- Prefix is just a label, not structural

### 2. UUID v8 Structured (EUID)

**Format:** Standard UUID with topology encoded in bit fields
**Used by:** Snowflake, EUID, various distributed systems

**Pros:**

- Standard UUID format — compatible with existing columns
- Compact (128 bits total)
- Time-ordered for better indexing

**Cons:**

- Complex implementation
- Limited space for encoding (bits are precious)
- Not human-readable
- Requires bit manipulation for encode/decode

### 3. Hierarchical Composite Keys

**Format:** `<org>/<entity>/<uuid>`
**Examples:** `org_abc/deal_123/uuid`, `acme/engr/deal/uuid`
**Used by:** GitHub (`org/repo/issues/123`), Kubernetes resources

**Pros:**

- Natural hierarchy — maps to real-world structure
- System can decode full context from ID
- Excellent for routing and access control

**Cons:**

- Longer IDs (35-50 chars)
- Requires slash/dash encoding (URL safety)
- More complex generation logic

### 4. ULID/KSUID (Time-Ordered)

**Format:** `<48-bit-time><80-bit-random>` = 26 chars base32
**Used by:** Various distributed systems for sorted IDs

**Pros:**

- Time-ordered — better B-tree performance
- Monotonic within millisecond
- Compact and URL-safe

**Cons:**

- No semantic meaning (just time + random)
- No org/entity encoding
- Requires custom parsing

### 5. django-prefix-id (Python Ecosystem)

**Format:** `prefix_base62_uuid`
**Used by:** Django projects needing readable IDs

**Pros:**

- Simple to implement
- Works with existing UUID columns
- Prefix is configurable per model

**Cons:**

- No org awareness
- Just a label, not structural encoding

---

## Design Decision: Why Our Approach

### Chosen Format: `<org-code>-<entity-code>-<base62-uuid>`

**Rationale:**

1. **Meets the requirement** — org is embedded in the ID itself
2. **Stripe-proven** — prefix-based IDs work at massive scale
3. **System-aware** — can decode org from any ID without DB query
4. **Incremental migration** — new records get structured IDs, old keep UUIDs
5. **Extensible** — can add department/category segments later

### Why NOT Other Patterns

| Pattern                | Rejected Because                                      |
| ---------------------- | ----------------------------------------------------- |
| Stripe-only prefix     | Doesn't encode org context                            |
| UUID v8 bit fields     | Too complex, not human-readable                       |
| Full hierarchical path | Overkill — department/category aren't schema entities |
| ULID/KSUID             | No semantic meaning, just time-ordered                |

---

## Technical Deep Dive

### Base62 Encoding

**Why base62?**

- URL-safe (no special characters)
- Case-sensitive (more entropy per char than base36)
- Human-readable (unlike base64 with `+/=`)
- 22 base62 chars ≈ 128 bits (UUID size)

**Alphabet:** `0-9A-Za-z` (62 characters)

**Conversion:**

```
UUID: 550e8400-e29b-41d4-a716-446655440000
Hex:  550e8400e29b41d4a716446655440000
BigInt: 113427455640312821154458202477900951056
Base62: 4wr7jBDTEqVBCsXEih4zfP (22 chars)
```

### Org Short Code Generation

**Algorithm:**

1. Take first 4 chars of tenant slug, uppercase
2. If collision exists, append sequential number (AC01, AC02, ...)
3. Store in `tenants.short_code` — **immutable after creation**

**Uniqueness guarantee:**

- `UNIQUE NOT NULL` constraint on `tenants.short_code`
- Sequential fallback prevents collisions

### Performance Considerations

| Metric       | UUID v4           | Structured ID       |
| ------------ | ----------------- | ------------------- |
| Column type  | `uuid`            | `text`              |
| Storage size | 16 bytes          | 25-35 bytes         |
| Index size   | 16 bytes          | 25-35 bytes         |
| Lookup speed | O(log n)          | O(log n)            |
| Insert speed | Gen_random_uuid() | App-side generation |

**Impact:** Negligible at <10M rows. Text PKs slightly slower for index scans, but the semantic benefits outweigh this.

---

## Migration Strategy

### Phase 1: Non-Breaking (Current Sprint)

- Add `short_code` to tenants
- Create `lib/id.ts`
- New records get structured IDs
- Old records keep UUIDs
- `parseId()` handles both formats

### Phase 2: Backfill (Next Sprint)

- Background job scans all tables
- Generates structured IDs for old records
- Updates all foreign key references
- Runs during low-traffic window
- Includes rollback mechanism

### Phase 3: Optimization (Month 3)

- Add indexes on `short_code` lookups
- Update UI to display structured IDs
- Update logging with parsed context
- Remove UUID fallback from `parseId()`

---

## Files to Modify

| File                       | Change                                  |
| -------------------------- | --------------------------------------- |
| `drizzle/schema/tenant.ts` | Add `shortCode` column to `tenants`     |
| `drizzle/schema/utils.ts`  | Update `pk()` to accept entity name     |
| `lib/id.ts`                | **NEW** — ID generator and parser       |
| `app/layout.tsx`           | Load org registry on startup            |
| `app/api/**/route.ts`      | Update manual UUID generation (Phase 2) |
| `scripts/migrate-ids.ts`   | **NEW** — Background migration job      |

---

## Testing Strategy

### Unit Tests

- `generateId()` produces valid format
- `parseId()` correctly decodes all entity types
- `parseId()` handles old UUID format (backward compatibility)
- `loadOrgRegistry()` loads from DB correctly
- Base62 ↔ UUID conversion is lossless

### Integration Tests

- New record creation uses structured ID
- Foreign key references work with new ID format
- API responses contain structured IDs
- Admin panel displays structured IDs correctly

### Performance Tests

- Insert throughput with text PK vs UUID PK
- Index scan performance with 1M+ rows
- Org registry load time on startup

---

## Rollback Plan

If structured IDs cause issues:

1. `parseId()` falls back to raw UUID for old format
2. `utils.pk()` can revert to `uuid('id').primaryKey().defaultRandom()`
3. No data loss — old UUIDs still valid
4. New structured IDs become orphaned but harmless

---

## References

- Stripe ID Documentation: https://stripe.com/docs/api
- UUID v8 (EUID): https://github.com/ulid/spec
- KSUID: https://github.com/segmentio/ksuid
- django-prefix-id: https://github.com/labd/django-prefix-id
- CockroachDB IDs: https://www.cockroachlabs.com/docs/stable/uuid.html
