#!/bin/bash
# Build k6 sessions for the load scripts (#2120).
#
# The app uses cookie sessions + double-submit CSRF and the login endpoint is
# rate-limited, so load runs reuse pre-created sessions instead of logging in
# per VU. This script logs in once per account and emits a JSON array of
# {session, csrf, email} entries for SESSIONS_FILE.
#
# Usage:
#   BASE_URL=https://localhost ACCOUNTS="alice@x.com:pw1,bob@y.com:pw2" \
#     ./tests/load/make-sessions.sh > sessions.json
#   (self-signed https is handled via -k; edit CURL_OPTS for other setups)
#
# WARNING: sessions are bearer credentials. Keep the output file out of git
# (chmod 600) and never commit real accounts.

set -euo pipefail

BASE_URL="${BASE_URL:-https://localhost}"
ACCOUNTS="${ACCOUNTS:?set ACCOUNTS=\"email:password,email:password\"}"
CURL_OPTS=(curl -sS --max-time 20 -k)

out='['
first=1
IFS=',' read -ra accounts <<< "$ACCOUNTS"
for acct in "${accounts[@]}"; do
  email="${acct%%:*}"
  password="${acct#*:}"

  jar="$(mktemp)"

  csrf="$("${CURL_OPTS[@]}" -c "$jar" "$BASE_URL/api/auth/csrf-token" | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')"
  session="$(
    "${CURL_OPTS[@]}" -b "$jar" -c "$jar" -D - -o /dev/null \
      -H 'Content-Type: application/json' -H "x-csrf-token: $csrf" \
      -d "{\"email\":\"$email\",\"password\":\"$password\"}" \
      "$BASE_URL/api/auth/login" \
    | tr -d '\r' | sed -n 's/^[Ss]et-[Cc]ookie: nucrm_session=\([^;]*\).*/\1/p' | head -1
  )"
  # Login rotates the CSRF cookie; read the current pair from the jar.
  csrf_final="$(awk -F'\t' '$6=="nucrm_csrf_token"{v=$7} END{print v}' "$jar")"
  csrf_final="${csrf_final:-$csrf}"
  rm -f "$jar"

  if [ -z "$session" ]; then
    echo "login failed for $email (no nucrm_session cookie)" >&2
    exit 1
  fi

  if [ $first -eq 0 ]; then out="$out,"; fi
  first=0
  out="$out{\"email\":\"$email\",\"session\":\"$session\",\"csrf\":\"$csrf_final\"}"
done
out="$out]"

printf '%s\n' "$out"
