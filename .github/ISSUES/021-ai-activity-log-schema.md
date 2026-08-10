# Issue: Missing AI Activity Log Schema and Database Table

## Description
In the `docs/planning/POSITIONING.md` file, there is a documented gap regarding the AI activity log. The documentation explicitly states: `| AI activity log — schema TODO | UI ready, table not | High |`

The UI for the AI activity log exists, but the underlying database schema/table (`ai_activity_logs` or similar) to store and retrieve these logs has not been implemented.

## Location
- Documentation: `docs/planning/POSITIONING.md`
- Related UI: The AI activity log page/component.

## Impact
Without the database schema and table, the AI activity log UI cannot display actual data or persist AI interactions. This breaks the observability of AI features, which is critical for debugging, auditing, and cost tracking (token usage).

## Expected Behavior
A new Drizzle schema definition should be created for storing AI activity logs (including fields like tenantId, userId, action, prompt, response, token usage, cost, and timestamps). A migration should be generated and applied to create this table in the database, and the corresponding API routes and UI components should be wired up to use this new schema.
