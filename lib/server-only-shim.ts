// Shim for `server-only` package used in Vitest tests.
// In production Next.js, this import marks modules as server-only.
// In tests, we need to stub it out since Vitest doesn't know about this package.
