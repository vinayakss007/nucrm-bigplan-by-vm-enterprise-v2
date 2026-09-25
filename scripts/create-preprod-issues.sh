#!/usr/bin/env bash
#
# File the pre-prod bring-up issues documented in docs/infra/issues/*.md
# onto GitHub, idempotently.
#
# Copyright © 2026 abetworks.in — see LICENSE.
#
# Why a script and not the `gh` CLI: `gh` is not installed on the pre-prod VM,
# but curl + jq are. This uses the GitHub REST API directly.
#
# Usage:
#   scripts/create-preprod-issues.sh --dry-run          # print what would be filed
#   scripts/create-preprod-issues.sh                    # file everything
#   scripts/create-preprod-issues.sh --only PP-010,PP-011
#
# Token (needs Contents:write + Issues:write on the repo — fine-grained PAT):
#   GITHUB_TOKEN / GH_TOKEN in the environment, or `GITHUB_TOKEN=...` in /root/all-keys.
#
# Every *.md in docs/infra/issues/ is one issue: the first `# ` heading becomes the
# title, the rest of the file becomes the body. Re-running skips issues whose title
# already exists (open or closed), so it is safe to run repeatedly.

set -euo pipefail

REPO_DEFAULT="vinayakss007/nucrm-bigplan-by-vm-enterprise-v2"
ISSUE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/docs/infra/issues"
API="https://api.github.com"
LABELS=("bug" "preprod")

REPO="$REPO_DEFAULT"
DRY_RUN=0
ONLY=""

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
info() { printf '%s\n' "$*"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --repo) REPO="${2:?--repo needs owner/name}"; shift ;;
    --only) ONLY="${2:?--only needs a comma-separated list like PP-010,PP-011}"; shift ;;
    -h|--help) sed -n '2,21p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument: $1 (try --help)" ;;
  esac
  shift
done

command -v curl >/dev/null || die "curl is required"
command -v jq   >/dev/null || die "jq is required"
[ -d "$ISSUE_DIR" ] || die "issue directory not found: $ISSUE_DIR"

TOKEN="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
if [ -z "$TOKEN" ] && [ -r /root/all-keys ]; then
  TOKEN="$(grep -E '^(GITHUB_TOKEN|GH_TOKEN)=' /root/all-keys | head -1 | cut -d= -f2- | tr -d '"'"'"' \r' || true)"
fi
if [ "$DRY_RUN" -eq 0 ] && [ -z "$TOKEN" ]; then
  die "no GitHub token. Set GITHUB_TOKEN (Contents:write + Issues:write) or add it to /root/all-keys. Use --dry-run to preview."
fi

api() { # api METHOD PATH [JSON] -> prints the response body
  local method="$1" path="$2" data="${3:-}"
  if [ -n "$data" ]; then
    curl -sS -X "$method" -H "Authorization: Bearer $TOKEN" \
      -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" \
      -d "$data" "$API$path"
  else
    curl -sS -X "$method" -H "Authorization: Bearer $TOKEN" \
      -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" \
      "$API$path"
  fi
}

api_code() { # api_code METHOD PATH [JSON] -> prints only the HTTP status code
  local method="$1" path="$2" data="${3:-}"
  if [ -n "$data" ]; then
    curl -sS -o /dev/null -w '%{http_code}' -X "$method" -H "Authorization: Bearer $TOKEN" \
      -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" \
      -d "$data" "$API$path"
  else
    curl -sS -o /dev/null -w '%{http_code}' -X "$method" -H "Authorization: Bearer $TOKEN" \
      -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28" \
      "$API$path"
  fi
}

# ── existing titles (idempotency) ────────────────────────────────────────────
EXISTING=""
if [ "$DRY_RUN" -eq 0 ]; then
  info "Reading existing issues in $REPO ..."
  for page in 1 2 3 4 5; do
    raw="$(api GET "/repos/$REPO/issues?state=all&per_page=100&page=$page")"
    apierr="$(printf '%s' "$raw" | jq -r '.message? // empty' 2>/dev/null || true)"
    if [ -n "$apierr" ]; then
      die "GitHub API refused the issue listing: $apierr
(${TOKEN:+token present}; needs a token with Issues:read/write on $REPO — see docs/infra/github-push-access.md)"
    fi
    chunk="$(printf '%s' "$raw" | jq -r '.[]?|select(.pull_request|not)|.title' 2>/dev/null || true)"
    [ -z "$chunk" ] && break
    EXISTING="$EXISTING
$chunk"
  done
fi

# ── labels ───────────────────────────────────────────────────────────────────
if [ "$DRY_RUN" -eq 0 ]; then
  for label in "${LABELS[@]}"; do
    case "$label" in
      bug) continue ;; # exists in every repo (ISSUE_TEMPLATE/bug_report.yml declares it)
    esac
    payload="$(jq -nc --arg n "$label" '{name:$n,color:"d4c5f9",description:"Found during pre-prod bring-up"}')"
    code="$(api_code POST "/repos/$REPO/labels" "$payload" || true)"
    case "$code" in
      201) info "created label: $label" ;;
      422) : ;;                     # already exists
      *)   info "WARN: could not create label $label (HTTP $code) — continuing" ;;
    esac
  done
fi

# ── file the issues ──────────────────────────────────────────────────────────
created=0 skipped=0 failed=0
shopt -s nullglob
for file in "$ISSUE_DIR"/PP-*.md; do
  base="$(basename "$file")"; id="$(printf '%s' "$base" | cut -d- -f1,2)"   # PP-010-first-x.md -> PP-010
  if [ -n "$ONLY" ] && ! printf '%s' ",$ONLY," | grep -q ",$id,"; then continue; fi

  title="$(head -1 "$file" | sed 's/^# //')"
  body="$(tail -n +2 "$file" | sed '/./,$!d')"
  [ -n "$title" ] || die "no '# Title' first line in $base"

  if [ "$DRY_RUN" -eq 1 ]; then
    info "[dry-run] $id -> \"$title\" ($(printf '%s' "$body" | wc -l | tr -d ' ') body lines, labels: ${LABELS[*]})"
    continue
  fi

  if printf '%s\n' "$EXISTING" | grep -Fxq "$title"; then
    info "skip  $id (already filed): $title"; skipped=$((skipped+1)); continue
  fi

  payload="$(jq -nc --arg t "$title" --arg b "$body" --argjson l "$(printf '%s\n' "${LABELS[@]}" | jq -R . | jq -sc .)" \
             '{title:$t, body:$b, labels:$l}')"
  resp="$(api POST "/repos/$REPO/issues" "$payload")"
  url="$(printf '%s' "$resp" | jq -r '.html_url // empty')"
  if [ -n "$url" ]; then
    info "filed $id -> $url"; created=$((created+1)); EXISTING="$EXISTING
$title"
  else
    info "FAILED $id: $(printf '%s' "$resp" | jq -r '.message // .error // "unknown error"')"
    failed=$((failed+1))
  fi
done

info ""
info "done: created=$created skipped=$skipped failed=$failed"
[ "$failed" -eq 0 ]
