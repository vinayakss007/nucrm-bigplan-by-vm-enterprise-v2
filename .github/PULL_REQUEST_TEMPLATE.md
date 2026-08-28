<!--
Keep PRs focused: one issue / one concern per PR (see AGENTS.md).
Target branch is always `main`. Never push directly to `main`.
-->

## What & why

<!-- One or two sentences: what does this change and what problem does it solve? -->

Closes #<!-- issue number, or remove this line if no tracked issue -->

## Changes

<!-- Bullet the concrete changes. Reference files/functions where useful. -->

-

## Verification

<!-- This repo requires green checks before merge. Tick what you actually ran. -->

- [ ] `npm run typecheck` — clean
- [ ] `npm run lint` — clean
- [ ] `npm run test:unit` — pass
- [ ] `npm run test:integration` — pass (or N/A)
- [ ] `npm run build` — exit 0 (if build-affecting)
- [ ] Migration added/verified (if schema changed) — journal is sequential, no gap/duplicate
- [ ] Security-sensitive paths reviewed (authz, tenant isolation, input validation) — or N/A

## Risk & rollback

<!-- Anything reviewers should watch for? Data migration? Behavior change? How to revert? -->

## Screenshots / notes

<!-- Optional: UI screenshots, benchmark numbers, or context that helps review. -->
