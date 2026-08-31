# archive/

Retired / stray files kept for reference instead of being deleted. Nothing in
this folder is imported by the application or referenced by the build. It exists
so we can clean up the repository root without losing history.

| File                                    | What it is                                                                                                                                                                                                                     | Why it's here                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `drizzle-generate-terminal-capture.txt` | A `script`/terminal capture of a `drizzle-kit generate` run that errored on a TTY prompt (originally committed at the repo root as a file literally named `typescript`).                                                       | Accidental artifact — not source code. Kept in case the captured error output is useful.    |
| `_instrumentation.ts.orphan`            | An older, orphaned copy of `instrumentation.ts` (Sentry-only `register()`), superseded by the root `instrumentation.ts` which also wires graceful shutdown, metrics and the Telegram webhook. Not referenced anywhere in code. | Removed from the root so there is a single instrumentation entry point. Kept for reference. |

If you are certain a file here is no longer needed, it is safe to delete it in a
follow-up change.
