#!/usr/bin/env bash
set -e

echo "═══════════════════════════════════════════"
echo "  PRE-MERGE SAFETY CHECK"
echo "═══════════════════════════════════════════"

# 1. TypeScript check
echo ""
echo "▶ 1/8 TypeScript check..."
npx tsc --noEmit --pretty 2>&1 | head -20
echo "   ✅ No TS errors"

# 2. Build check
echo ""
echo "▶ 2/8 Build check..."
npm run build 2>&1 | tail -5
echo "   ✅ Build succeeded"

# 3. Unit tests
echo ""
echo "▶ 3/8 Unit tests..."
npm run test:unit 2>&1 | tail -5
echo "   ✅ All tests pass"

# 4. Check for new imports from @/lib — verify they exist
echo ""
echo "▶ 4/8 Import sanity check..."
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "main" ]; then
  NEW_IMPORTS=$(git diff origin/main...HEAD -- '*.ts' '*.tsx' 2>/dev/null | grep "^+import" | grep "from '@/lib" | sed 's/.*from '\''@\/lib\/\(.*\)'\''.*/\1/' | sort -u)
  if [ -n "$NEW_IMPORTS" ]; then
    echo "   New imports detected:"
    echo "$NEW_IMPORTS" | while read -r mod; do
      if [ -f "lib/${mod}.ts" ]; then
        echo "   ✅ lib/${mod}.ts exists"
      else
        echo "   ❌ lib/${mod}.ts NOT FOUND!"
        exit 1
      fi
    done
  else
    echo "   No new @/lib imports"
  fi
fi

# 5. Rollback path (#3284). This was the FIRST guard script wired in here — the
# issue asked for this one "next to guard:migration-redecl", but no guard ran in
# this file at the time: guard:migration-redecl has no step in pre-merge-check.sh and no
# step in ci.yml either (docs/README.md:52 records the missing workflow step). The
# migration guards live in ci.yml; this file is the local pre-push screen, and a
# rollback that cannot run is exactly the thing a local screen should refuse.
# Static only: no database, no credentials.
echo ""
echo "▶ 5/8 Rollback coverage (#3284)..."
npm run guard:rollback-coverage 2>&1 | tail -3
echo "   ✅ Every .down.sql runs, and owns only its own objects"

# 6. Committed credentials (#3281). The second guard in this file, and the reason it
# is here rather than only in ci.yml is the shape of the failure: a password literal
# pushed once is in the repository's history forever, so the cost of catching it
# before the push is not a re-run of a job, it is a rewrite of history (#2302 is the
# purge that has to happen for the one already published). Static only, and it owns
# the same exit codes ci.yml greps for.
echo ""
echo "▶ 6/8 No committed password literal (#3281)..."
npm run guard:seed-credential 2>&1 | tail -3
echo "   ✅ No password literal survives in scripts, app source or workflows"

# 7. Destructive scripts (#3282). The third guard in this file, and the one whose
# absence is the actual bug: `prod:seed` was not dangerous because nobody wrote a
# gate — it was dangerous because a gate could rot in silence, and #3282 is the
# second issue in a week to find a guard that was green while the thing it guards
# was off. Static only, no database: the screen reads the package.json-reachable
# scripts and asks whether each destructive one names its own confirmation.
echo ""
echo "▶ 7/8 Destructive script gates (#3282)..."
npm run guard:destructive-gate 2>&1 | tail -3
echo "   ✅ Every reachable destructive statement names an opt-in, or is tolerated with a reason"

# 8. Cron authentication (#3298). Ask 2 of that issue names this file, not ci.yml, and
# the reason is the failure it guards: a cron route that compares the secret itself is
# not broken, it is *un-hardened* — and the only signal that it is un-hardened is an
# env var the operator set believing it applied. ci.yml runs the same alias, so this
# step is about catching it before the push, the way steps 5-7 catch their guards.
# Static only — reads route sources, no database, no secret. Deliberately unpiped:
# `set -e` judges a pipeline by its last command, so `| tail` would let a refusal
# through and print the banner anyway. That is the #3282 defect, not a style choice.
echo ""
echo "▶ 8/8 Cron routes authenticate through lib/auth/cron (#3298)..."
npm run guard:cron-auth
echo "   ✅ Every cron route awaits verifyCronSecret; no route compares the secret itself"

echo ""
echo "═══════════════════════════════════════════"
echo "  ALL CHECKS PASSED — Ready to merge"
echo "═══════════════════════════════════════════"
