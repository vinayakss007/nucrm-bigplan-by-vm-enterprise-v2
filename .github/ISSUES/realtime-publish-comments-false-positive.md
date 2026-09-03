# Issue: False Positive for Commented-Out Code

**File:** `lib/realtime/publish.ts`

**Description:**
An automated tool reported a code health issue to remove "commented-out code" in `lib/realtime/publish.ts`. Upon review, the flagged lines (such as `// Not an error: single-instance dev without Redis simply has no push.` and `// A publish must never queue up behind a dead connection — fail fast and let the caller carry on. The client's polling fallback covers the gap.`) are not dead code but valuable explanatory documentation comments.

**Resolution:**
The comments have been left intact to preserve code maintainability and readability. The automated tool's flag is considered a false positive.
