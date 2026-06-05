# Setup & Configuration Issues

## 1. Database Not Running
- PostgreSQL container was not started
- App tried connecting to `postgres:5432` (Docker hostname) but no containers were running
- Fix: Started `docker compose up -d postgres redis`

## 2. DATABASE_URL Used Docker Hostname
- `.env` had `DATABASE_URL=postgresql://...@postgres:5432/...`
- Running outside Docker, `postgres` hostname was unresolvable
- Changed to `localhost:5432`

## 3. Merge Conflicts in Schema Files
- `drizzle/schema/ai.ts` and `drizzle/schema/_registry.ts` had unresolved merge conflict markers (`<<<<<<< HEAD`, `=======`, `>>>>>>>`)
- Conflict from branch `e9d03bc` (feat: implement at-risk deal detection engine)
- Broke all schema imports, preventing migrations from running
- Fix: Manually resolved conflicts, merged both versions

## 4. Node.js Version Mismatch
- Project requires `node >=22.0.0` via `engines` field
- Environment has `node v20.9.0`
- Next.js tried auto-installing TypeScript via yarn, which validates engines and fails
- Fix: Installed TypeScript manually via npm with `--ignore-scripts`

## 5. NODE_ENV Set to "production" in Development
- `.env` had `NODE_ENV=production`
- Seed script refused to run (safety check)
- Fix: Overrode with `NODE_ENV=development` when running seed

## 6. .env.local Missing DATABASE_URL
- The project uses both `.env` and `.env.local`
- `.env.local` (loaded first) was missing `DATABASE_URL`
- Seed script loads `.env.local` and couldn't find connection string
- Fix: Added `DATABASE_URL` to `.env`

## 7. Cross-Origin Dev Access Blocked
- Next.js 16 blocks HMR connections from unknown origins by default
- `allowedDevOrigins` in `next.config.mjs` was missing the current host
- Caused hot-reload failures in browser console without visible UI errors
- Fix: Added the host to `allowedDevOrigins` array

## 8. No Super Admin User in Database
- No seed data existed — database was freshly migrated with zero users
- Could not sign in or sign up via the app
- Fix: Created super admin user directly via SQL insert
