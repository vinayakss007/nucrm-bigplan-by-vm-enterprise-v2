#!/usr/bin/env bash
set -euo pipefail

# #3351: this file used to run under `set -e` WITHOUT `pipefail`, and 6 of its 7
# steps piped their command into `head`/`tail` — so the pipeline's status was
# head's/tail's (always 0) and the script printed "ALL CHECKS PASSED — Ready to
# merge" over a tree where tsc, the build, the unit suite or a guard had failed.
# Adding pipefail alone is not enough for the `| head -20` step: head closing the
# pipe makes the real command die of SIGPIPE (status 141) on a successful run. So
# every step now goes through run_step, which captures the output, reads the
# status, prints a bounded excerpt, and fails the gate naming the step.

fail() {
  echo ""
  echo "═══════════════════════════════════════════"
  echo "  ✖ $1"
  echo "  PRE-MERGE GATE STOPPED — not ready to merge"
  echo "═══════════════════════════════════════════"
  exit 1
}

# run_step "<marker + n/N label>" <excerpt lines> "<success line>" <command...>
#
# The exit status of the command — not of the tool that truncates its output — is
# what decides which verdict prints. Anything added here must come through this
# helper; tests/unit/pre-merge-check-status-3351.test.ts fails a bare step.
run_step() {
  local label="$1" limit="$2" success="$3"
  shift 3
  local step="${label#▶ }"
  step="${step%% *}"
  local out status=0
  echo ""
  echo "${label}..."
  out=$("$@" 2>&1) || status=$?
  if [ "$status" -ne 0 ]; then
    printf '%s\n' "$out" | tail -n "$limit"
    fail "Step ${step} (${label#▶ }) exited ${status}; its output is above"
  fi
  printf '%s\n' "$out" | tail -n "$limit"
  echo "   ✅ ${success}"
}

echo "═══════════════════════════════════════════"
echo "  PRE-MERGE SAFETY CHECK"
echo "═══════════════════════════════════════════"

# 1. TypeScript check
run_step "▶ 1/8 TypeScript check" 20 "No TS errors" npx tsc --noEmit --pretty

# 2. Build check
run_step "▶ 2/8 Build check" 5 "Build succeeded" npm run build

# 3. Unit tests
run_step "▶ 3/8 Unit tests" 5 "All tests pass" npm run test:unit

# 4. Check for new imports from @/lib — verify they exist
echo ""
echo "▶ 4/8 Import sanity check..."
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "main" ]; then
  # `|| true` because grep exits 1 when there is nothing to import, which is the
  # normal case and not a failing step.
  NEW_IMPORTS=$(git diff origin/main...HEAD -- '*.ts' '*.tsx' | grep "^+import" | grep "from '@/lib" | sed 's/.*from '\''@\/lib\/\(.*\)'\''.*/\1/' | sort -u || true)
  MISSING=""
  # A here-string, not a pipe: `echo … | while read` runs the loop in a subshell,
  # so the old `exit 1` inside it only ever ended the subshell and the verdict for
  # a missing module was left to the pipeline's status by accident.
  while read -r mod; do
    [ -z "$mod" ] && continue
    if [ -f "lib/${mod}.ts" ]; then
      echo "   ✅ lib/${mod}.ts exists"
    else
      MISSING="${MISSING} lib/${mod}.ts"
    fi
  done <<< "$NEW_IMPORTS"
  if [ -n "$MISSING" ]; then
    fail "Step 4/8 (4/8 Import sanity check) found @/lib imports with no file behind them:${MISSING}"
  fi
  if [ -z "$NEW_IMPORTS" ]; then
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
run_step "▶ 5/8 Rollback coverage (#3284)" 3 "Every .down.sql runs, and owns only its own objects" npm run guard:rollback-coverage

# 6. Committed credentials (#3281). The second guard in this file, and the reason it
# is here rather than only in ci.yml is the shape of the failure: a password literal
# pushed once is in the repository's history forever, so the cost of catching it
# before the push is not a re-run of a job, it is a rewrite of history (#2302 is the
# purge that has to happen for the one already published). Static only, and it owns
# the same exit codes ci.yml greps for.
run_step "▶ 6/8 No committed password literal (#3281)" 3 "No password literal survives in scripts, app source or workflows" npm run guard:seed-credential

# 7. Destructive scripts (#3282). The third guard in this file, and the one whose
# absence is the actual bug: `prod:seed` was not dangerous because nobody wrote a
# gate — it was dangerous because a gate could rot in silence, and #3282 is the
# second issue in a week to find a guard that was green while the thing it guards
# was off. Static only, no database: the screen reads the package.json-reachable
# scripts and asks whether each destructive one names its own confirmation.
run_step "▶ 7/8 Destructive script gates (#3282)" 3 "Every reachable destructive statement names an opt-in, or is tolerated with a reason" npm run guard:destructive-gate

# 8. Cron authentication (#3298). Ask 2 of that issue names this file, not ci.yml, and
# the reason is the failure it guards: a cron route that compares the secret itself is
# not broken, it is *un-hardened* — and the only signal that it is un-hardened is an
# env var the operator set believing it applied. ci.yml runs the same alias; this step
# is about catching it before the push, the way steps 5-7 catch their guards. It goes
# through run_step for the #3351 reason: a `| tail` here would let a refusal through and
# print the banner anyway.
run_step "▶ 8/8 Cron routes authenticate through lib/auth/cron (#3298)" 3 "Every cron route awaits verifyCronSecret; no route compares the secret itself" npm run guard:cron-auth

echo ""
echo "═══════════════════════════════════════════"
echo "  ALL CHECKS PASSED — Ready to merge"
echo "═══════════════════════════════════════════"
