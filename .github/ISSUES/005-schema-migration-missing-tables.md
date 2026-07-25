# Schema Migration: 42 Missing Tables (Issue #219)

We have identified an issue with the database schema migration state. According to our tracking (Issue #219), the current migration snapshots were likely regenerated directly from the schema files rather than using proper DB introspection, leading to 42 tables missing from the actual production migration scripts.

## Issue Details
- The application defines numerous tables in `drizzle/schema/` (e.g. 215 tables across 35 files as per `README.md`).
- A gap exists between the TypeScript Drizzle schema and the generated `.sql` migration files.
- If deployed to a fresh environment using `npm run db:migrate`, 42 tables will not be created, causing immediate application crashes when those tables are queried.

## Recommendation
- Do **NOT** use `drizzle-kit push` in production.
- Run `npx drizzle-kit generate` to properly generate the missing `.sql` migration files that encapsulate the creation of the 42 missing tables.
- Review the generated SQL to ensure no destructive operations (like drops) are unintentionally executed against existing data.
- Once validated, apply the migration using `npm run db:migrate`.
