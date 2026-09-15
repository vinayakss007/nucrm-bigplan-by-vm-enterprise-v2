# promtail ships no container logs to Loki (`docker_sd_configs` unset) (PP-017)

**Severity:** LOW — observability gap
**Area:** Infra / deploy
**Register:** [`docs/infra/PREPROD-ISSUE-REGISTER.md` → PP-017](../../../docs/infra/PREPROD-ISSUE-REGISTER.md)

## Summary

The promtail container runs, but no `docker_sd_configs` target discovery is configured, so it discovers
nothing and Loki receives no container logs. Logs are verbatim *not* collected while the monitoring page
suggests log shipping is in place; Grafana/Loki are also only reachable through an SSH tunnel.

## Steps to reproduce

1. `docker compose -f deploy/docker-compose.preprod.yml ps` → `promtail` is up.
2. Query Loki for a known container log line (e.g. from `nucrm-app`) → no results.
3. Inspect the merged config: `docker compose config` shows no `docker_sd_configs` scrape config.

## Expected vs actual

- **Expected:** container logs are queryable in Loki/Grafana.
- **Actual:** Loki has no container targets.

## Proposed fix

Add a `docker_sd_configs` scrape config to promtail using the Docker socket, plus a follow-up runbook
entry for the Grafana/Loki tunnel. Note that compose overrides **append** to list fields — use the
`!override` tag when replacing the scrape configs rather than merging with the existing ones.
