# Integration Notes

Practical shape traps when driving the NuCRM tenant API from third-party tools
(Postman, curl, k6, Zapier). These cost every QA pass hours in 2026-09 (#2121).

## 1. Auth: cookie session + double-submit CSRF — no bearer tokens

`POST /api/auth/login` (`{"email","password"}`) does **not** return a token.
It sets two cookies:

| Cookie             | Purpose                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| `nucrm_session`    | HttpOnly JWT session — sent automatically on every request                                                    |
| `nucrm_csrf_token` | readable CSRF cookie — must be echoed back in `x-csrf-token` on **mutating** requests (POST/PATCH/PUT/DELETE) |

Bootstrap the CSRF pair with `GET /api/auth/csrf-token` → `{ok:true, token}`
(sets the cookie). Login **rotates** the CSRF cookie — use the jar value, not
the pre-login token.

```bash
BASE=https://your-instance
jar=$(mktemp)

# 1. seed CSRF pair
CSRF=$(curl -s -c "$jar" "$BASE/api/auth/csrf-token" | jq -r .token)

# 2. login (regenerates nucrm_csrf_token in the jar)
curl -s -b "$jar" -c "$jar" \
  -H 'Content-Type: application/json' -H "x-csrf-token: $CSRF" \
  -d '{"email":"you@corp.com","password":"secret"}' \
  "$BASE/api/auth/login" > /dev/null

# 3. read the post-login CSRF value
CSRF=$(grep -P 'nucrm_csrf_token\t' "$jar" | awk '{print $NF}' | tail -1)

# 4. GET: cookies alone are enough
curl -s -b "$jar" "$BASE/api/tenant/contacts?limit=5" | jq '.data | length'

# 5. PATCH: cookie + x-csrf-token header must match
curl -s -b "$jar" \
  -H 'Content-Type: application/json' -H "x-csrf-token: $CSRF" \
  -X PATCH -d '{"job_title":"Updated"}' \
  "$BASE/api/tenant/contacts/<id>"
```

Rate limits that bite scripted traffic first: login 10/15min,
`csrf-token` 10/min, mutating routes 30/min, authenticated edge limiter
120/min per user. For load runs, pre-create sessions (see
`tests/load/make-sessions.sh`).

## 2. Request bodies are snake_case; response bodies are camelCase

Create/update payloads are validated against snake_case Zod schemas
(`lib/api/schemas.ts`): `first_name`, `job_title`, `lead_status`,
`close_date`, `contact_id`, `mime_type`, `size_bytes`, `assigned_to`, ...

Responses are wrapped (`{data: ...}` for get/create, lists add `total`,
`offset`, `limit`), but their key convention is **mixed**: most row returns
use Drizzle camelCase (`firstName`, `createdAt`), while some hand-mapped
create responses (e.g. `POST /api/tenant/contacts` 201) emit snake_case
(`first_name`, `job_title`, `created_at`). Parse ids via `data.id` (that one
is stable); for everything else, don't hardcode casing — read both or check
the route.

```jsonc
// POST /api/tenant/contacts  (request)
{ "first_name": "Ada", "last_name": "Lovelace", "lead_status": "new" }
// response 201 (this route hand-maps to snake_case)
{ "data": { "id": "...", "first_name": "Ada", "lead_status": "new", "created_at": "..." } }
```

## 3. Core resource updates are PATCH, not PUT

`PUT /api/tenant/contacts/:id` → **405**. The core CRM resources (contacts,
leads, deals, tasks, forms, companies) export `GET | PATCH | DELETE` on their
`[id]` routes. A few settings/secondary resources (e.g. quotes, subscriptions,
territories) do export PUT — when in doubt, PATCH first, then check the route.
PATCH is partial: send only changed fields. Some routes (e.g. forms) support
optimistic concurrency via `expectedUpdatedAt` in the body.

## 4. Dashboard stats live under widgets

`GET /api/tenant/dashboard/stats` was removed. Use:

- `/api/tenant/dashboard/widgets/stats/{contacts,pipeline,revenue,tasks}`
- `/api/tenant/dashboard/widgets/contacts/recent`, `/api/tenant/dashboard/widgets/leads`

## 5. Bulk endpoints are resource-keyed, not generic

`POST /api/tenant/<resource>/bulk` takes `{action, <resource>_ids, payload}` —
the id-array key is **per resource**: `lead_ids`, `contact_ids`, `deal_ids`
(not a generic `ids`). All also accept `selectAll: true` + `filters` instead
of explicit ids.

```jsonc
// POST /api/tenant/leads/bulk
{ "action": "update", "lead_ids": ["..."], "payload": { "lead_status": "qualified" } }
// POST /api/tenant/contacts/bulk
{ "action": "delete", "selectAll": true, "filters": { "q": "test" } }
```

## 6. Deletes are soft

`DELETE` returns `{ok:true}` and stamps `deletedAt`; deleted rows vanish from
list endpoints but keep their ids. Do not assume FK cascade or id reuse.

## 7. Errors

Errors are `{error: "<message>"}` with a semantic status
(400 validation, 401/403 auth, 404 not-found-or-wrong-tenant,
409 conflict, 429 rate-limited, 503 from the edge proxy under saturation).
429/503 responses should be retried with backoff; they are limiters doing
their job, not app crashes.
