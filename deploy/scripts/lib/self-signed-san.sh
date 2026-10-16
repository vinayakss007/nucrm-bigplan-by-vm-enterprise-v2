#!/usr/bin/env bash
###############################################################################
#  NuCRM — subjectAltName computation for the self-signed TLS fallback  [#2592]
#
#  RFC 6125 §6.4.4 says a presented identifier MUST come from the SAN; since
#  Chrome 58 / Firefox 48 (and never Safari) browsers do NOT fall back to the
#  certificate's CN= field. A self-signed cert minted with only `-subj /CN=…`
#  is therefore valid for *nothing* a browser can name — and worse, an operator
#  smoke-testing it with `curl` (which still honours CN for DNS names) sees it
#  pass, so the breakage stays invisible. Only an IP identifier exposes it,
#  because OpenSSL/curl do NOT fall back to CN for an IP.
#
#  Kept in its own sourceable file (with `set -e` callers safe to `. ` it) so
#  the decision can be unit-tested without docker or a running stack — see
#  tests/unit/ssl-self-signed-san-2592.test.ts.
###############################################################################

# Echo the value to use for `openssl req -addext "subjectAltName=<here>"` given
# the edge identifier (an IP address, a DNS hostname, or empty → localhost).
compute_subject_alt_name() {
  local id="${1:-localhost}"
  if [[ "$id" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
    # IP literal — the browser will check an IP SAN, never the CN.
    echo "IP:${id}"
  elif [[ "$id" == "localhost" ]]; then
    # Local / IP-only testing: cover both spellbacks a client might use.
    echo "DNS:localhost,IP:127.0.0.1"
  else
    echo "DNS:${id}"
  fi
}
