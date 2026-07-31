# Working Alongside Other Agents

Several Kiro sessions work this repo in parallel. `global-standards.md` §10.3
already requires a PR to pass CI, and §9.1 requires a clean build before merge.
This document exists because those rules were followed loosely and the same
failures kept recurring — it records what went wrong, with evidence, so the cost
of skipping them is concrete.

---

## 1. Check what is already in flight before writing code

Four of twelve PRs in one batch re-implemented work that already existed: #859
duplicated #852, #886 duplicated merged #866, #885 duplicated #884's
query-timeout, #901 duplicated #887. **Two duplicates were worse than the
original**, so merging the wrong one was a regression, not a no-op.

```bash
# Every file touched by every open PR. Run before starting.
gh pr list --json number -q '.[].number' | while read n; do
  gh pr diff "$n" --name-only | sed "s|^|#$n |"
done | sort -k2 | awk '{a[$2]=a[$2]" "$1} END{for(f in a) if (split(a[f],x," ")>1) print f, "->", a[f]}'
```

Check `main` too, not just open PRs: #886 added `lib/backups/encrypt.ts` when
that file already existed on `main`.

If your change touches a file another open PR owns, split it out. #842 collided
with three PRs at once and had to be reduced to the one file nothing else
touched.

---

## 2. Why "must pass CI" is not negotiable here

The failure compounds:

1. a PR merges with its checks red;
2. `main` is now red, so **every** open PR shows the same failures;
3. a genuinely broken PR is now indistinguishable from one inheriting `main`'s
   failure — so the next batch merges red too.

`main` went red three times this way. Once, **19 typecheck errors landed in a
single batch**. The `Deploy` workflow runs `npm test` *before* Docker and SSH, so
it had never completed successfully in 387 runs.

`Lint & Typecheck` is the fast check that catches real breakage. Wait for it on
the PR itself, not on `main`.

---

## 3. Do not silence a type error you have not understood

#901 cleared errors with casts. It compiled, CI went green, and it shipped two
bugs no check could see:

- `(m as any).requests?.filter(...)` — `requests` is not a property of the metrics
  collector, so the endpoint always returned **zero** requests.
- The quote PDF kept reading `item.unit_price || item.price`, which are not
  columns on `quote_line_items` (it has `unitPrice`), so every unit price on a
  customer-facing PDF rendered as **$0**.

A cast converts a loud compile error into a quiet wrong answer. Read the real
type first. #887 fixed the same 11 files by using the actual APIs.

---

## 4. Repo facts that have each caused a bug

- **`db.execute()` returns a `QueryResult`, not an array.** Rows are on `.rows`.
  `const [row] = await db.execute(...)` is `TS2488` and has appeared **eight
  times across four files**.
- **`sonner` is not a dependency.** This repo uses `react-hot-toast` (160+ files,
  `<Toaster>` already mounted). Importing `sonner` has happened twice. Adding it
  would mean two toast libraries and two toast roots.
- **A new migration must be registered in `drizzle/migrations/meta/_journal.json`.**
  `scripts/migrate.ts` walks the journal, and CI only runs `db:sync`
  (drizzle-kit push from the schema), which never reads raw SQL. An unregistered
  `.sql` file is a **silent no-op** — #884 shipped CHECK constraints that would
  never have existed in any environment while looking green. `_journal.json` is
  also a serialisation point: two PRs editing it will conflict, so claim it.
- **Check nullability before "fixing" an insert.** `leads.lastName` is `NOT NULL`;
  `contacts.lastName` is nullable. The same edit is correct for one, wrong for
  the other.

---

## 5. Test the behaviour, not the mechanism

#860 converted seven routes from hard delete to soft delete. Tests asserting
`db.delete(...)` broke — correctly, because they pinned the mechanism. Assert the
observable outcome (`deletedAt` is stamped, the row stops being visible) so an
implementation change does not produce a false failure.

Do not pin a moving target either. A rollback test hardcoded
`TAG_NO_ROLLBACK = '0000_init'`; #829 then gave that migration a rollback and five
tests broke at once. Two of its assertions were literally *that coverage must be
incomplete* — impossible to satisfy once #640 completes. Use a fixture you
control.
