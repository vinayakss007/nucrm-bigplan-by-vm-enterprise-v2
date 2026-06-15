# NuCRM Enterprise — Safety Checks Protocol

**Read this every session. Run checks before marking any fix as done.**

---

## RULE #1: Never trust "looks right" — prove it

Every time a change is made, these checks MUST pass:

### Quick Check (before commit)
```bash
npm run lint              # No new warnings
npm run test:unit         # All 920+ tests pass
```

### Build Check (before merge to main)
```bash
npm run build             # Must succeed (exit 0)
npx tsc --noEmit          # 0 TypeScript errors
scripts/smoke-test.sh     # Server starts and responds
```

### Import Check (before merge)
```bash
# Find all newly imported things from @/lib — verify they exist
git diff main...HEAD -- '*.ts' '*.tsx' | grep "^+import" | grep "from '@/lib"
# For each one, check the file actually exports what's imported
```

---

## RULE #2: After every merge, check nothing broke

After merging a branch to main:
```bash
# 1. Kill old server
pkill -f "next dev" 2>/dev/null

# 2. Start fresh
npx next dev --port 3000 &
sleep 10

# 3. Test login
curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"super@admin.com","password":"SuperAdmin123!"}' \
  -c /tmp/smoke-cookies.txt

# 4. Test protected page
curl -s -o /dev/null -w "%{http_code}" -b /tmp/smoke-cookies.txt \
  http://localhost:3000/tenant/dashboard

# 5. Test superadmin page (if user is superadmin)
curl -s -o /dev/null -w "%{http_code}" -b /tmp/smoke-cookies.txt \
  http://localhost:3000/superadmin/dashboard

echo "Expected: 200 for all"
```

---

## RULE #3: Track fragile files

Before editing any file from the "Known Fragile Interfaces" list in MASTER-TRACKER.md:
1. Check who else imports it: `grep -r "from '@/lib/that-file'" --include="*.ts" --include="*.tsx"`
2. Verify all existing imports still work after your change
3. Run full test suite before committing

---

## RULE #4: When something breaks unexpectedly

1. Check if it's a **merge issue** — was a branch recently merged?
2. Check if it's a **missing export** — `grep "not found in module" /tmp/nucrm-dev*.log`
3. Check if it's a **test file issue** — `npm run test:unit`
4. Check if it's a **build issue** — `npm run build`
5. Fix → run all checks → verify with smoke test

---

## RULE #5: Session start ritual

Every time a new session starts:
1. Read `GOAL.md` — align on vision
2. Read `MASTER-TRACKER.md` — know current state
3. Read `CHECKS.md` — remember the rules
4. Check if server is running: `curl -s http://localhost:3000/`
5. Check if any branches are unmerged: `git log --oneline --not --remotes --branches`
