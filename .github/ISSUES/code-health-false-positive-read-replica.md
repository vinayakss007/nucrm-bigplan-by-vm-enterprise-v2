# False Positive: Commented-out code in read-replica.ts

**File:** `lib/db/read-replica.ts`

## Analysis
The code health tool identified the following lines as "commented-out code" to be removed:

```typescript
    // Already determined there's no replica — use primary.
    // Dynamic import is not usable here (sync getter), so we import at module
    // level and cache. The circular dependency is safe: drizzle/db.ts does not
    // import this file.
```

However, these lines are not dead or commented-out executable code. They are highly valuable, explanatory comments written in plain English that describe architectural decisions (why dynamic imports aren't used and why a circular dependency is safe).

## Resolution
Removing this comment would contradict the goal of improving maintainability and readability, as it would delete crucial context about circular dependencies and introduce a documentation regression. Therefore, the correct action is to recognize the false positive and leave the valuable comment intact. No modifications were made to `lib/db/read-replica.ts`.
