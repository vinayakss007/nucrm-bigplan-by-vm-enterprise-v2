# Missing third-party credentials: `RESEND_API_KEY`, `ANTHROPIC_API_KEY` (PP-019)

**Severity:** MEDIUM — features degrade silently
**Area:** Infra / deploy
**Register:** [`docs/infra/PREPROD-ISSUE-REGISTER.md` → PP-019](../../../docs/infra/PREPROD-ISSUE-REGISTER.md)

## Summary

Two integrations have no credentials on the pre-prod stack: `RESEND_API_KEY` (transactional email) and
`ANTHROPIC_API_KEY` (AI features). Both fail silently — e.g. invites and password-reset emails are
generated but never delivered, which looks like an application bug from the outside.

## Steps to reproduce

1. Trigger an invite or a password reset on pre-prod.
2. The API responds successfully, no email arrives; the app log shows the mail provider rejected the
   request (or the call is skipped).
3. `grep -E 'RESEND_API_KEY|ANTHROPIC_API_KEY' .env` → not set.

## Expected vs actual

- **Expected:** email is delivered and AI-backed features respond.
- **Actual:** no email; AI features unavailable, with no user-visible error.

## Proposed fix

Supply both keys for pre-prod, and make the failure visible: a startup/health signal (or an explicit
"email not configured" state in the UI) instead of a successful response that does nothing. Keys are
accepted when emailed/rotated — nothing else is blocked on this issue.
