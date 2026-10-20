# packages/db — SQLite, Drizzle, repositories

Shared by server and runner (two processes, one SQLite file). Spec: PROJECT_RULES §5, §13.

## Rules
- Schema in `src/schema.ts`; migrations are generated SQL in `migrations/` and committed.
  - Change schema → `pnpm db:generate` (drizzle-kit) → commit the new SQL file. Never edit an applied migration.
  - Triggers and other hand-written SQL: `pnpm --filter @flowcheck/db exec drizzle-kit generate --custom --name <name>`.
- Add tables in the phase that uses them; don't create tables for unimplemented features.
- Timestamps are epoch ms integers; JSON columns use `text(..., { mode: 'json' }).$type<T>()`.
- IDs: `newId()` (UUIDv7).
- Every multi-statement write uses `db.transaction(fn, { behavior: 'immediate' })` so concurrent writers (server + runner) serialize instead of failing with SQLITE_BUSY mid-transaction.
- Repositories throw `RepoError` with a shared `ErrorCode`; the server maps it to HTTP.
- Drizzle-derived types stay inside this package and the apps; they are never the API contract.

## Invariants enforced in the DB
- `test_revisions` cannot be updated (trigger). Revisions are only inserted.
- `test_runs` revision/environment/snapshot/input columns cannot be updated (trigger).
- `execution_lock` has at most one row (`id = 1` check) — shared by runs, recordings, auth captures.
- Queue claim (`claimNextRun`) checks the lock, picks the oldest queued run and flips it to `running` with `WHERE status='queued'`, all in one IMMEDIATE transaction.
- Test cases are never hard-deleted in v1 (archive only), so run history stays intact.

## Tests
`pnpm --filter @flowcheck/db test` — migrations, immutability, FIFO claim, 4-thread concurrent claim, cancel, restart recovery.
