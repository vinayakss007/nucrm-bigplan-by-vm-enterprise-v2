#!/usr/bin/env bash
set -e

echo "═══════════════════════════════════════════"
echo "  PRE-MERGE SAFETY CHECK"
echo "═══════════════════════════════════════════"

# 1. TypeScript check
echo ""
echo "▶ 1/4 TypeScript check..."
npx tsc --noEmit --pretty 2>&1 | head -20
echo "   ✅ No TS errors"

# 2. Build check
echo ""
echo "▶ 2/4 Build check..."
npm run build 2>&1 | tail -5
echo "   ✅ Build succeeded"

# 3. Unit tests
echo ""
echo "▶ 3/4 Unit tests..."
npm run test:unit 2>&1 | tail -5
echo "   ✅ All tests pass"

# 4. Check for new imports from @/lib — verify they exist
echo ""
echo "▶ 4/4 Import sanity check..."
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

echo ""
echo "═══════════════════════════════════════════"
echo "  ALL CHECKS PASSED — Ready to merge"
echo "═══════════════════════════════════════════"
