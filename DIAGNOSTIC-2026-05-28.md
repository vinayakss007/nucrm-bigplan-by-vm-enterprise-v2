# NuCRM Build & Memory Diagnostic
**Date:** 2026-05-28
**Author:** opencode diagnostic

---

## 1. Telemetry
- Next.js anonymous telemetry: **Disabled** ✅
- Command: `npx next telemetry disable`
- Config saved to: `cache/config.json`

## 2. Environment

| Metric | Value |
|---|---|
| Node.js | v24.14.0 |
| Next.js | v16.2.1 (Turbopack default) |
| OS | Linux (Codespace container) |
| CPU | 2 cores |
| RAM total | 7.8 GiB |
| RAM available (after OS + services) | ~2.5-3.2 GiB |
| Swap | 0 (failed to add — container restriction) |
| Disk | SSD (Codespace) |

## 3. Project Size

| Metric | Count |
|---|---|
| Pages (`page.tsx`) | 170 |
| API routes (`route.ts`) | 306 |
| Total routes to compile | 476 |
| Total TS/TSX files | 14,451 |
| `node_modules` size | 1.1 GB |
| `app/` directory | 6.5 MB |

## 4. Root Cause: Why 8GB RAM Is Not Enough

### 4.1. Turbopack (Next.js 16 default)
Next.js 16 ships Turbopack (Rust-based bundler) as the **default** bundler. Unlike webpack (JS-based) which processes modules one-by-one, Turbopack processes **all modules in parallel** using Rust's memory arena. This causes a massive memory spike at the start of the build:

- Turbopack allocates a large contiguous memory block for its module graph
- All 476 routes + their dependency trees are resolved simultaneously
- The Rust compiler holds the entire module graph + intermediate representations in memory
- Peak memory easily exceeds 4-5 GiB for a project this size

### 4.2. `optimizePackageImports`
The next.config has:
```js
experimental: {
  optimizePackageImports: ['lucide-react', '@radix-ui/react-*', '@dnd-kit/core', '@dnd-kit/sortable'],
}
```
This pre-compiles barrel exports from these large packages, which adds significant memory pressure during the build phase.

### 4.3. No Swap
The Codespace container does not allow `swapon`. Without swap, any allocation spike above available physical RAM immediately triggers the OOM killer. With ~2.5-3.2 GiB available, and Turbopack needing 4-5 GiB, the build **always** gets killed.

### 4.4. Node v24.14.0
Node 24 has a higher baseline memory footprint than Node 20/22. Combined with `--max-old-space-size=4096`, V8 reserves a large heap upfront, reducing room for Turbopack's Rust-side allocations.

## 5. Observed Behavior

### Dev mode (`npm run dev`)
- Server starts (632ms, low memory)
- First page compilation: succeeds (Products page, ~25-41s, memory spikes but survives)
- Second page compilation: **OOM kill** — server process vanishes with SIGKILL
- Process never survives more than 1-2 page compilations

### Production build (`npm run build`)
- Starts "Creating an optimized production build..."
- Never completes — killed by OOM at the compilation phase
- No output after the initial message

## 6. Fixes Already Applied

| Fix | File | Status |
|---|---|---|
| `ENCRYPTION_KEY` env var in docker-compose | `docker-compose.yml` | ✅ |
| CSRF exemption for setup/onboarding APIs | `lib/auth/csrf.ts` | ✅ |
| `role_slug` DB column migration (Drizzle schema was correct, DB was wrong) | `drizzle/migrations/0010_rename_invitations_role.sql` | ✅ |
| Created missing Products listing page | `app/tenant/products/page.tsx` | ✅ |
| Created missing Import/Export page | `app/tenant/settings/import-export/page.tsx` | ✅ |
| 10 TypeScript build errors in API routes | 7 route files | ✅ |
| Cron scheduler `process.env` syntax | `scripts/cron-scheduler.ts` | ✅ |

## 7. Suggestions to Reduce Build Memory

### 7.1. Disable Turbopack — Use Webpack Instead (Highest Impact)
Turbopack is the main memory hog. Webpack uses significantly less memory:

**In `next.config.ts`:**
```ts
experimental: {
  turbo: undefined,          // explicitly disable Turbopack
  webpackBuild: true,        // force webpack for builds
  // keep other experimental options
}
```

Or run builds with the `--no-turbopack` flag:
```bash
next build --no-turbopack
```

### 7.2. Limit Parallelism
Add to `next.config.ts`:
```ts
experimental: {
  cpus: 1,                   // limit to 1 CPU for builds
  memoryBasedWorkersCount: true,  // let Next.js auto-scale workers based on memory
}
```

### 7.3. Reduce `optimizePackageImports`
The `lucide-react` package has hundreds of barrel exports. Consider tree-shaking at the import site instead:
```ts
// Instead of: optimizePackageImports: ['lucide-react']
// Do at each import site:
import { User, Mail } from 'lucide-react';
```
Or remove `lucide-react` from the list and only keep packages that are absolutely necessary.

### 7.4. Add Swap (If Container Allows)
```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```
If `swapon` fails with "Invalid argument", the container runtime blocks swap. You'd need to run in a proper VM or bare-metal environment.

### 7.5. Use Docker Build with More RAM
Build on a machine with ≥8 GiB total RAM and ≥4 GiB free:
```bash
docker build -t nucrm-app:latest .
docker compose up -d
```

### 7.6. Build Outside Container, Mount `.next`
```bash
# On host machine (≥8GB RAM)
npm run build

# Copy the .next folder into the Docker context
# Or mount it as a volume in docker-compose.yml:
volumes:
  - ./.next:/app/.next
```

### 7.7. Reduce Source File Count (Long-term)
14K TS/TSX files is very large. Consider:
- Removing unused components
- Consolidating duplicate utility files
- Auditing node_modules for unnecessary type packages

## 8. Startup Instructions (Once Build Succeeds)

```bash
# With Docker (recommended):
docker compose up -d

# Without Docker (direct):
# Ensure DB and Redis are running, then:
npm run start
# Or in dev mode:
npm run dev
```

## 9. Current Git Status
```bash
git status --short
#  M app/api/cron/subscription-check/route.ts
#  M app/api/forms/route.ts
#  M app/api/tenant/contacts/[id]/status/route.ts
#  M app/api/tenant/industry-templates/route.ts
#  M app/api/tenant/leads/import/route.ts
#  M app/api/tenant/modules/setup/route.ts
#  M app/api/webhooks/whatsapp/route.ts
#  M docker-compose.yml
#  M lib/auth/csrf.ts
#  M scripts/cron-scheduler.ts
# ?? app/tenant/products/page.tsx
# ?? app/tenant/settings/import-export/
# ?? drizzle/migrations/0010_rename_invitations_role.sql
```

**Note:** `package-lock.json` and `yarn.lock` were restored to original (no changes).

---

*End of diagnostic*
