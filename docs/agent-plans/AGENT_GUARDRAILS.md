<!--
  NuCRM Enterprise — Property of abetworks.in
  Copyright (c) 2026 abetworks.in. All Rights Reserved.
  Proprietary & confidential. Unauthorized copying or distribution is prohibited.
-->

# Agent Guardrails — Escape the Fix/Break Loop

> The other plans say **what** to build. This one says **how agents keep
> breaking the repo while "fixing" it**, and the gates that prevent it. Every
> rule here comes from a real incident on this repo (issue/PR numbers included
> so you can check). Read this before your first push, and re-read it whenever
> a PR of yours goes red.

## 1. Why fixes keep breaking things

Observed failure modes, in order of how often they cost a bad commit:

| Loop pattern                                  | What happened                                                                                                                                             | The gate that stops it                                                                             |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Pushed red, CI auto-merged it**             | #3004 merged to `main` with a TS2345 type error. Local lint does NOT catch type errors.                                                                   | §2.1 full `tsc` before every push — non-negotiable while auto-merge is on                          |
| **Two agents fixed the same issue**           | #2999/#3001 were each fixed twice; add/add conflicts on identical test files; one branch's gates were superseded mid-flight by #3031                      | §3 dedupe protocol — check `gh` state and `origin/main` log _before_ writing code                  |
| **Test pinned the bug, fix "broke" the test** | `process-at-risk` test asserted the buggy `emails_sent: 1`; the correct fix looked like a regression                                                      | §2.3 read what a failing test _claims_; if it pins broken behavior, rewrite the test, not the code |
| **Test mock drifted from real contract**      | `contract-renewal` mocked `sendEmail` as `{id}`; the real function resolves `{success,...}` — the moment code checked `result.success` the mock was a lie | §4 doctrine list — mocks must mirror the real return shape                                         |
| **Pipeline masked a failing exit code**       | `npm test 2>&1 \| tail`/`grep` returns the _pipe's_ exit code: red suites reported as green                                                               | §2.2 `set -o pipefail` (or write to a log file) in every verification command                      |
| **A one-line fix bloated past the ratchet**   | #3034 was red purely on `guard:filesize` — comment-heavy edits pushed an existing file over 500 lines                                                     | §2.4 keep route edits minimal-line; files not in `scripts/file-size-baseline.json` must stay ≤500  |
| **OOM "phantom failure"**                     | Full `tsc` with default/8192 heap gets killed on the 8 GB box and looks like a hang                                                                       | §2.1 exact command with `--max-old-space-size=4096`                                                |

## 2. The pre-push gate (all four, in order, every time)

```bash
set -o pipefail                                        # 2.2 — never trust piped exit codes

# 2.1 — full typecheck (this box only survives 4096)
NODE_OPTIONS="--max-old-space-size=4096" npx tsc --noEmit --pretty false
echo "TSC_EXIT=$?"                                     # must be 0

# 2.3 — your new tests + every existing suite touching the files you changed
grep -rln "<changed-module-name>" tests/unit | xargs npx vitest run  # + your test file

# 2.4 — size/any ratchets on changed files (new/ungrouped files must be ≤500 lines)
npx eslint <changed files> && wc -l <changed files>
```

Only then: `git push` + `gh pr create`. Never merge your own PR (AGENTS.md).

## 3. Dedupe protocol (shared repo, concurrent agents)

Before **filing** an issue or **writing** a fix:

1. `gh issue list --state open --search "<keywords>"` and `gh pr list --state open --search "<keywords>"`
2. `git fetch origin main` and check whether the defect still reproduces in
   `origin/main` (`git log origin/main --oneline -20`, then read the file from
   `origin/main`) — another agent may already have fixed it under a different
   issue number.
3. If it's already fixed: comment on your issue with the PR that closed it and
   close yours. **Do not re-implement.** (This is how #3019 became a
   superseded-with-comment close instead of a conflicting re-land of #3016.)
4. On a shared worktree: never force-push, never rebase a branch someone else
   may have pushed to; merge `origin/main` in and resolve properly.
5. One issue per branch. One branch per PR. Branch name `fix/<desc>` links the
   issue number in the commit subject (`fix(#1234): ...`).

## 4. Standing doctrines (recurring bug classes — code against these by default)

- **`sendEmail` never throws.** It resolves `{ success, provider?, messageId?, error? }`.
  A `.catch()` on it is dead code (#2422/#2998/#3045). Check `result.success`.
  Cron dedup markers must be **withheld** on rejection so the next run retries.
- **UTC date math only.** No `setHours(0,0,0,0)` + `toISOString().split('T')`
  day logic — it breaks east of Greenwich (#2429/#2997/#2997-follow-ups). Use
  `utcDateStr()` / `reminderWindows()` from `lib/cron/renewal-windows.ts`.
- **Every server-side `fetch` carries `signal: AbortSignal.timeout(N)`**
  (#3046/#1186-adjacent). No unbounded upstream calls, including self-calls.
- **Crons must not report `ok:true` for work they did not do** — lock refusals
  (#2539), swallowed send failures (#2998/#3045), and truncated batches
  (#3047) are all the same lie. Batch crons use ordered keyset loops
  (`app/api/cron/sla-check.ts` is the reference twin), never a bare `.limit(N)`.
- **Role gates on mutation endpoints**: `requirePerm(ctx, perm)` /
  `isAdmin` checks after `requireAuth` (#2999/#3000/#3001). Matrix guard tests
  slice the handler source and assert the gate order — copy
  `tests/unit/outbound-comms-role-gate-3000.test.ts` when adding routes.
- **Mocks must mirror real exports** — constructor-mockable (`vi.fn(function…)`
  not arrows for classes), full named-export shape (pg-boss ships `default`
  AND `PgBoss`), and real return types (a `sendEmail` mock returning `{id}`
  failed the moment production code checked `.success`).
- **`withApiRoute: <T,>(h: T) => h`** in test mocks — a plain `(h) => h` forces
  `any` and trips the any-suppression ratchet.

## 5. Where the work state actually lives (never write it down in a doc)

Stale state in docs is itself a loop-generator. Query it fresh:

```bash
gh pr list --state open --json number,title,headRefName        # who is mid-flight
gh issue list --state open --label bug --json number,title     # what is known-broken
gh pr view <n> --json statusCheckRollup                        # why a PR is red
git log origin/main --oneline -30                              # what just landed
```

If you cannot answer "is someone already fixing this?" from those four
commands, ask before starting.
