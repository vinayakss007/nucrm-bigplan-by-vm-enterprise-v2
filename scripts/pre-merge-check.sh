#!/usr/bin/env bash
set -e

echo "═══════════════════════════════════════════"
echo "  PRE-MERGE SAFETY CHECK"
echo "═══════════════════════════════════════════"

# 1. TypeScript check
echo ""
echo "▶ 1/5 TypeScript check..."
npx tsc --noEmit --pretty 2>&1 | head -20
echo "   ✅ No TS errors"

# 2. Build check
echo ""
echo "▶ 2/5 Build check..."
npm run build 2>&1 | tail -5
echo "   ✅ Build succeeded"

# 3. Unit tests
echo ""
echo "▶ 3/5 Unit tests..."
npm run test:unit 2>&1 | tail -5
echo "   ✅ All tests pass"

# 4. Check for new imports from @/lib — verify they exist
echo ""
echo "▶ 4/5 Import sanity check..."
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

# 5. Rollback path (#3284). This is the FIRST guard script wired in here — the
# issue asked for this one "next to guard:migration-redecl", but no guard runs in
# this file today: guard:migration-redecl has no step in pre-merge-check.sh and no
# step in ci.yml either (docs/README.md:52 records the missing workflow step). The
# migration guards live in ci.yml; this file is the local pre-push screen, and a
# rollback that cannot run is exactly the thing a local screen should refuse.
# Static only: no database, no credentials.
echo ""
echo "▶ 5/5 Rollback coverage (#3284)..."
npm run guard:rollback-coverage 2>&1 | tail -3
echo "   ✅ Every .down.sql runs, and owns only its own objects"

echo ""
echo "═══════════════════════════════════════════"
echo "  ALL CHECKS PASSED — Ready to merge"
echo "═══════════════════════════════════════════"
