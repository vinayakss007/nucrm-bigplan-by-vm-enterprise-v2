# NuCRM Security Audit Report

**Date**: August 7, 2026  
**Scope**: Full API security review (authorization, IDOR, XSS, SSRF, mass assignment, rate limiting)  
**Auditor**: Automated security analysis

---

## Executive Summary

The codebase demonstrates **strong security fundamentals** with proper tenant isolation, CSRF protection, and SQL injection prevention. However, **3 high-severity** and **4 medium-severity** issues were identified that require remediation.

| Severity  | Count | Status                   |
| --------- | ----- | ------------------------ |
| 🔴 HIGH   | 3     | Requires immediate fix   |
| 🟡 MEDIUM | 4     | Should be addressed soon |
| 🟢 LOW    | 2     | Informational            |

---

## 🔴 HIGH SEVERITY FINDINGS

### H1: Data Explorer PUT — No Field-Level Authorization (IDOR/Broken Access Control)

**File**: `app/api/tenant/data-explorer/route.ts:168-188`  
**CWE**: CWE-862 (Missing Authorization)

**Description**:  
The PUT endpoint allows any authenticated user with `data_explorer.view` permission to update ANY field on ANY record across contacts, leads, deals, companies, and tasks tables. There is no field-level permission check — a user with basic view access can modify fields they shouldn't have permission to edit (e.g., `assignedTo`, `amount`, `score`).

**Impact**:

- Privilege escalation: regular user can reassign deals to themselves
- Data integrity: unauthorized modification of financial data (deal amounts)
- RBAC bypass: no check for `contacts.edit`, `deals.edit`, etc.

**Remediation**:

```typescript
// Add field-level permission check
const editableFields: Record<string, string[]> = {
  contacts: [
    "firstName",
    "lastName",
    "email",
    "phone",
    "jobTitle",
    "leadStatus",
    "notes",
  ],
  deals: ["title", "amount", "stageId", "closeDate"],
  companies: ["name", "industry", "website", "phone"],
  leads: ["firstName", "lastName", "email", "phone", "leadStatus", "score"],
  tasks: ["title", "description", "status", "priority", "dueDate"],
};

const allowed = editableFields[table];
if (!allowed?.includes(safeField)) {
  return NextResponse.json({ error: "Field not editable" }, { status: 403 });
}
```

---

### H2: Document Upload — Missing Server-Side File Size and MIME Validation

**File**: `app/api/tenant/documents/route.ts:38-55`  
**CWE**: CWE-434 (Unrestricted Upload of File with Dangerous Type)

**Description**:  
The POST endpoint for document creation does not validate file size or MIME type server-side. It trusts `mimeType` and `sizeBytes` from the client request body. An attacker can:

1. Bypass client-side validation
2. Upload executable files (`.exe`, `.sh`, `.ps1`)
3. Upload files exceeding storage limits

**Impact**:

- Storage exhaustion attacks
- Potential malware upload if files are served to other users
- Compliance violations (GDPR, HIPAA)

**Remediation**:

```typescript
// Validate in the upload-url endpoint (already exists) but also in POST
const MAX_SIZE_BYTES = 100 * 1024 * 1024; // 100MB
const BLOCKED_MIMES = [
  "application/x-msdownload",
  "application/x-executable",
  "application/x-sh",
  "application/x-bat",
];

if (sizeBytes > MAX_SIZE_BYTES) {
  return NextResponse.json({ error: "File too large" }, { status: 413 });
}
if (BLOCKED_MIMES.includes(mimeType)) {
  return NextResponse.json({ error: "File type not allowed" }, { status: 415 });
}
```

---

### H3: Form Embed Code — Stored XSS via Unescaped User Input

**File**: `app/api/tenant/forms/route.ts:76-89`  
**CWE**: CWE-79 (Cross-site Scripting)

**Description**:  
The form embed code interpolates `f.name` (form name) directly into an HTML `title` attribute without escaping:

```typescript
<iframe title="${f.name}" ...>
```

If a user creates a form with name `"><script>alert(1)</script>`, it will execute JavaScript when the embed code is rendered.

**Impact**:

- Session hijacking via XSS
- Credential theft if forms are embedded on authenticated pages
- Malware distribution

**Remediation**:

```typescript
import { escape } from "lodash"; // or implement HTML escaping

const escapedName = escape(f.name);
const embedCode = `<iframe title="${escapedName}" ...>`;
```

---

## 🟡 MEDIUM SEVERITY FINDINGS

### M1: Rate Limiting Gaps on Mutating Endpoints

**Files**: Multiple `app/api/tenant/*/route.ts`  
**CWE**: CWE-770 (Allocation without Limits)

**Description**:  
15+ tenant endpoints lack rate limiting for POST/PUT/DELETE operations:

- `approvals/route.ts`
- `audit/route.ts`
- `calendar-sync/route.ts`
- `calls/route.ts`
- `canned-responses/route.ts`
- `contracts/route.ts`
- `custom-entities/route.ts`
- `email-templates/route.ts`
- `esignature/route.ts`
- `follow-ups/route.ts`
- `forms/route.ts`
- `industry-templates/route.ts`

**Impact**:

- Denial-of-service via resource exhaustion
- Brute force on creation endpoints
- Abuse for spam/data pollution

**Remediation**:  
Add `rateLimitMutating` to all POST/PUT/DELETE handlers:

```typescript
import { rateLimitMutating } from "@/lib/api/mutating-rate-limit";

export async function POST(req: NextRequest) {
  const rateLimited = await rateLimitMutating(req, ctx.tenantId);
  if (rateLimited) return rateLimited;
  // ... rest of handler
}
```

---

### M2: Cron Endpoints — Weak Authentication (Secret Only)

**Files**: `app/api/cron/*/route.ts`  
**CWE**: CWE-287 (Improper Authentication)

**Description**:  
Cron endpoints use `verifySecret()` which only checks a static bearer token. This provides:

- No IP allowlisting
- No request signing (HMAC)
- No audit trail of which cron job ran
- Single compromised secret = full access to all cron operations

**Impact**:

- Unauthorized job execution if `CRON_SECRET` leaks
- No accountability for cron actions

**Remediation**:

```typescript
// Add IP allowlisting for cloud scheduler IPs
const ALLOWED_CRON_IPS = ["35.191.0.0/16", "130.211.0.0/22"]; // GCP Cloud Scheduler

// Add HMAC request signing
const signature = req.headers.get("x-cron-signature");
const expected = createHmac("sha256", CRON_SECRET).update(body).digest("hex");
if (signature !== expected) return 401;
```

---

### M3: Password Reset — Timing Side-Channel

**File**: `app/api/auth/forgot-password/route.ts:28-40`  
**CWE**: CWE-208 (Observable Timing Discrepancy)

**Description**:  
While the endpoint correctly returns `{ ok: true }` for non-existent emails (preventing enumeration), the database query itself may have different timing for existing vs non-existing users, allowing timing-based enumeration.

**Impact**:

- Email enumeration via response time analysis (statistical)

**Remediation**:

```typescript
// Add consistent timing regardless of user existence
const startTime = Date.now();
const user = await db.query.users.findFirst({ ... });
const elapsed = Date.now() - startTime;
if (elapsed < 100) await sleep(100 - elapsed); // Consistent minimum response time
```

---

### M4: Superadmin Tenant Settings — No Audit Log for Changes

**File**: `app/api/superadmin/tenant-settings/route.ts:82-120`  
**CWE**: CWE-778 (Insufficient Logging)

**Description**:  
The PATCH endpoint modifies tenant settings (localization, login_policy, picklists, user_defaults) without creating an audit log entry. Superadmin actions should always be logged for compliance.

**Impact**:

- No accountability for configuration changes
- Compliance violations (SOC2, ISO 27001)
- Difficult incident response

**Remediation**:

```typescript
import { logAudit } from "@/lib/audit";

// After successful update
await logAudit({
  tenantId: tenant_id,
  actorId: ctx.userId,
  action: "tenant_settings.update",
  entityType: "tenant",
  entityId: tenant_id,
  changes: { settings: { old: existing, new: merged } },
});
```

---

## 🟢 LOW SEVERITY FINDINGS

### L1: Session Cookie — Missing Domain Attribute

**File**: `lib/auth/session.ts:84-95`  
**CWE**: CWE-614 (Sensitive Cookie in HTTPS Session Without 'Secure' Attribute)

**Description**:  
Session cookies are set with `httpOnly: true` and `sameSite: 'strict'`, but no `domain` attribute is specified. This could allow cookie theft via subdomain compromise.

**Impact**:

- Session theft if any subdomain is compromised

**Remediation**:

```typescript
const domain = process.env.COOKIE_DOMAIN || undefined;
return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}${domain ? `; Domain=${domain}` : ""}`;
```

---

### L2: Email Tracking — Incomplete SSRF Protection

**File**: `app/api/tenant/email/track/route.ts:72-85`  
**CWE**: CWE-918 (Server-Side Request Forgery)

**Description**:  
The click tracking endpoint blocks `localhost`, `127.0.0.1`, and metadata IPs, but doesn't block:

- Private IP ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
- IPv6 loopback alternatives
- DNS rebinding attacks

**Impact**:

- Potential internal network scanning
- Access to cloud metadata endpoints via IP rotation

**Remediation**:

```typescript
const isPrivateIP = (ip: string): boolean => {
  return /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|fc00:|fd00:|::ffff:10\.|::ffff:172\.|::ffff:192\.168\.)/.test(
    ip,
  );
};

if (isPrivateIP(parsedUrl.hostname)) {
  return NextResponse.json(
    { error: "Private network access denied" },
    { status: 403 },
  );
}
```

---

## ✅ SECURITY CONTROLS VALIDATED

| Control                        | Status  | Details                                                           |
| ------------------------------ | ------- | ----------------------------------------------------------------- |
| Tenant data isolation          | ✅ PASS | All queries include `WHERE tenant_id = ctx.tenantId`              |
| CSRF protection                | ✅ PASS | Double Submit Cookie pattern implemented                          |
| SQL injection prevention       | ✅ PASS | Drizzle ORM parameterized queries throughout                      |
| Brute force protection         | ✅ PASS | `isBlocked()`, `recordFailedAttempt()`, `recordSuccessfulLogin()` |
| Admin role enforcement         | ✅ PASS | `ctx.isSuperAdmin` / `ctx.isAdmin` checks consistent              |
| Webhook signature verification | ✅ PASS | Stripe webhook verifies signature with idempotency                |
| CORS configuration             | ✅ PASS | No arbitrary origins allowed                                      |
| Security headers               | ✅ PASS | X-Frame-Options, CSP, HSTS, etc.                                  |
| API key hashing                | ✅ PASS | SHA-256, never stored raw                                         |
| File upload validation         | ✅ PASS | Presigned URL endpoint validates size/MIME                        |

---

## RECOMMENDATIONS

### Immediate (This Sprint)

1. **H1**: Add field-level authorization to Data Explorer PUT
2. **H2**: Add server-side file size/MIME validation to document POST
3. **H3**: HTML-escape user input in form embed codes

### Short-Term (Next 2 Weeks)

4. **M1**: Add rate limiting to all 15+ missing mutating endpoints
5. **M4**: Add audit logging to superadmin tenant settings changes
6. **L1**: Add `domain` attribute to session cookies

### Medium-Term (Next Month)

7. **M2**: Implement HMAC signing for cron endpoints
8. **M3**: Add timing protection to password reset
9. **L2**: Complete SSRF protection for email tracking

---

## REFERENCES

- OWASP Top 10 2021: https://owasp.org/Top10/
- CWE/SANS Top 25: https://cwe.mitre.org/top25/
- Previous audit: `docs/SECURITY-ANALYSIS.md` (June 28, 2026)
