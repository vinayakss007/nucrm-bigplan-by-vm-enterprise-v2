# API Authentication

Every non-public NuCRM API request must be authenticated and is scoped to a single **tenant**
(workspace).

---

## Authentication methods

| Method | Best for | How |
| --- | --- | --- |
| **API key** | Server-to-server integrations | `Authorization: Bearer <api_key>` |
| **Session cookie** | Browser / first-party apps | `nucrm_session` cookie (set on login) |
| **Bearer JWT** | Authenticated user context | `Authorization: Bearer <jwt>` |

For most integrations, use an **API key**.

### Getting an API key

A workspace admin generates keys under **Settings → API keys**. Keys are scoped to that workspace.
Treat them like passwords: store them securely and rotate them if exposed.

---

## Tenant resolution

Because NuCRM is multi-tenant, each request must resolve to one workspace. The API gateway
determines the tenant from, in order of applicability:

1. The **API key** (each key belongs to a workspace), or the authenticated **session/JWT**.
2. An explicit **`X-Tenant-ID`** header (used for privileged/cross-tenant operations).
3. A **custom domain** mapped to a workspace.

If a request can't be authenticated, the API returns a generic `401 Unauthorized` (it intentionally
does not reveal which auth method failed).

---

## Example requests

```bash
# API key (recommended for integrations)
curl https://your-domain.com/api/v2/contacts \
  -H "Authorization: Bearer $NUCRM_API_KEY"
```

```bash
# Explicit tenant header (privileged operations)
curl https://your-domain.com/api/v2/contacts \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Tenant-ID: <workspace-uuid>"
```

---

## Mutations & CSRF

For **cookie-based** (browser) requests, state-changing calls (`POST`/`PUT`/`PATCH`/`DELETE`)
require a CSRF token (double-submit pattern). Obtain it from the CSRF token endpoint and send it
with your mutation. **Bearer/API-key** requests are not subject to CSRF, since they don't rely on
ambient cookies.

---

## Session lifetime

Interactive sessions are issued as secure, http-only cookies and remain valid for up to 30 days
unless the user logs out or an admin revokes the session. API keys do not expire on a timer but can
be revoked at any time.

---

## Related

- [REST API Reference](./rest-api.md) — endpoints, pagination, errors, rate limits
- [SDK](./sdk.md) — the SDK handles auth headers for you
- [Workspace Admin → Security Settings](../admin-guide/security-settings.md) — SSO, 2FA, sessions
