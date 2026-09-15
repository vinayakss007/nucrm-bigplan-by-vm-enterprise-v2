# Pre-prod Sentry events carry no `environment` / `release` (PP-016)

**Severity:** LOW — observability hygiene
**Area:** Infra / deploy
**Register:** [`docs/infra/PREPROD-ISSUE-REGISTER.md` → PP-016](../../../docs/infra/PREPROD-ISSUE-REGISTER.md)

## Summary

Errors raised by the pre-prod stack land in Sentry with no `environment` or `release` tag, so pre-prod
noise cannot be told apart from production traffic, filtered out, or tied to a deployment.

## Steps to reproduce

1. Trigger any app error on pre-prod (e.g. the login failure from PP-012).
2. Open the event in Sentry: no `environment`, no `release` tag.
   `/api/health` already reports `"sentry":"configured"`, so the DSN is wired — only the tags are missing.

## Expected vs actual

- **Expected:** `environment=preprod` and a release identifier on every event.
- **Actual:** untagged events.

## Proposed fix

Set `SENTRY_ENVIRONMENT=preprod` (and `SENTRY_RELEASE`, e.g. the image tag or commit SHA) for the
pre-prod stack, then confirm a new event carries both.
