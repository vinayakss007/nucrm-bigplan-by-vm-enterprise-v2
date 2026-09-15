# Pre-auth RLS blocks first super-admin creation (PP-010)

**Severity:** CRITICAL — blocks go-live
**Area:** Security / auth / tenant isolation · Infra / deploy
**Register:** [`docs/infra/PREPROD-ISSUE-REGISTER.md` → PP-010](../../../docs/infra/PREPROD-ISSUE-REGISTER.md)

## Summary

`POST /api/setup/create-admin` cannot create the first super-admin on the pre-prod stack. The request
fails at the database layer with `new row violates row-level security policy for table "users"`, even
when the correct `x-setup-key` header is supplied. There is no way to bootstrap the platform.

## Steps to reproduce

1. Bring the stack up (`deploy/docker-compose.preprod.yml`) and open `/setup`.
2. Submit the form with the correct value of the `SETUP_KEY` env var.
3. Observe `403` from the route, and in the `app` logs a Postgres error on
   `insert into "users" (...)`. Reproduce directly with:

```bash
docker exec -i nucrm-app node - <<'EOF'
const {Pool}=require('pg'); const p=new Pool({connectionString:process.env.DATABASE_URL});
(async()=>{const c=await p.connect();
  await c.query('BEGIN');
  try { await c.query("INSERT INTO users (email,password_hash,full_name,is_super_admin) VALUES ('probe@example.com','x','Probe',true)");
        console.log('SUCCEEDED'); }
  catch(e){ console.log('FAILED:', e.message); }
  await c.query('ROLLBACK'); c.release(); await p.end();})();
EOF
```

## Expected vs actual

- **Expected:** the first super-admin is created and the platform becomes usable.
- **Actual:** `new row violates row-level security policy for table "users"` — with **and** without
  `SET LOCAL app.is_super_admin = 'true'`.

## Why

`users` is `rls=true forced=true` with policy
`users_insert_auth`: `FOR INSERT WITH CHECK (current_setting('app.current_user') <> '')`.
`app.current_user` is only set by `lib/db/rls.ts::setTenantContext()` **after** authentication, and the
pool resets it to `''` on release — so the pre-auth bootstrap path can never satisfy it. The policy is
unsatisfiable by design of the flow, not by configuration.

## File / route

- `lib/auth/api-handlers.ts` (create-admin handler), `app/api/setup/create-admin/route.ts`
- `drizzle/migrations/0054_rls_phase0.sql` (`users_insert_auth`)
- `lib/db/rls.ts`, `lib/db/pool.ts`

## Proposed fix

Add a bootstrap-capable INSERT policy (permissive policies OR together, so this does **not** weaken
`users_insert_auth`), e.g. `CREATE POLICY users_insert_bootstrap ON users FOR INSERT WITH CHECK (true);`,
keeping the real gate in the route (`SETUP_KEY` + "no super-admin exists yet"). Alternative: an explicit
`app.bootstrap` GUC set by the audited handler (needs an image rebuild).
