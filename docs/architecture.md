# FlowCheck architecture

## Processes

```
 browser (UI, phase 2) ──HTTP /api──▶ apps/server (Fastify, 127.0.0.1:4310)
                                           │  reads/writes
                                           ▼
                                  data/flowcheck.db (SQLite, WAL)
                                           ▲  claims runs, writes results
                                           │
                                     apps/runner (worker) ──Playwright──▶ Chromium ──▶ system under test
                                           │                                          (e.g. apps/demo, 127.0.0.1:4320)
                                           └──▶ data/artifacts/<projectId>/<runId>/…
```

- **server** — REST API, validation, DB writes. Never starts a browser.
- **runner** — one worker. Claims queued runs, runs them through `packages/test-engine`, writes step results and artifacts, heartbeats, honours cancellation and timeouts.
- **SQLite** is the only channel between them. There is no HTTP between server and runner and no Redis.

## Packages

| Package | Depends on | Purpose |
|---|---|---|
| `packages/shared` | zod | API contract, definition schema (versioned), error codes, template grammar |
| `packages/test-engine` | shared, playwright, ipaddr.js | step executor, locator resolution, assertions, JSON Pointer, variables, target policy, redaction |
| `packages/db` | shared, drizzle, better-sqlite3 | schema, migrations, repositories, queue |
| `apps/server` | shared, db | HTTP |
| `apps/runner` | shared, db, test-engine | worker |
| `apps/demo` | fastify | test target |
| `e2e` | shared, @playwright/test | acceptance tests |

Boundaries are enforced by Biome `noRestrictedImports` (see `biome.json`).

## Run lifecycle

1. `POST /api/test-cases/:id/runs` validates the stored definition (own `schemaVersion`), inputs and environment, snapshots the environment, inserts a `queued` run → `202 { runId }`.
2. Runner: `claimNextRun` — in one IMMEDIATE transaction: lock free? oldest queued run → `running` (guarded by `WHERE status='queued'`) → take `execution_lock`.
3. Runner re-validates, creates all step rows as `pending`, launches Chromium (`serviceWorkers: 'block'`) and installs the target guard.
4. Engine runs setup → main → cleanup; each step: `running` → final status, evidence (`expected`/`actual`), screenshot on failed UI steps.
5. `computeRunStatus` (cancelled > interrupted > error > failed > passed) → `finishRun` releases the lock.

Cancellation: `POST /runs/:id/cancel` sets `cancellation_requested_at` (queued runs are cancelled immediately); the runner sees it on the next heartbeat, aborts, and force-closes the browser after 5 s.
Restart: on start and every loop tick, runs whose worker process is gone (or whose heartbeat is > 30 s old) become `interrupted`; queued runs continue FIFO.

## Decisions (ADR log)

**ADR-001 — SQLite is the only server↔runner channel.** Avoids a second protocol, an internal token and an extra attack surface. Commands to the runner (recorder, auth capture) will go through a `runner_commands` table.

**ADR-002 — Node native type stripping, no build step for Node apps.** Node 24 runs `.ts` directly. Constraints: `erasableSyntaxOnly` (no enums, namespaces, parameter properties), `.ts` extensions in relative imports, `import type` for types. Saves a bundler/tsc build for server, runner and demo; `tsc --noEmit` checks types. Only `apps/web` (Vite) has a build.

**ADR-003 — Environment snapshot at run creation, not at start.** The run executes exactly what the tester saw when pressing Run. `enabled` is re-checked when the runner starts.

**ADR-004 — Schema = implemented features.** The definition schema only contains step types and fields the engine executes. Additive changes stay in `schemaVersion` 1; breaking changes get a new version with its own schema. Old revisions are never migrated silently.

**ADR-005 — Immutability enforced twice.** Revisions and run snapshots are protected by repository code and by SQLite triggers.

**ADR-006 — Polling instead of SSE/WebSocket for run progress.** TanStack Query polling is enough for one local user; state is always read from the DB, so reconnects need no special handling.

**ADR-007 — `.env` via Node `--env-file-if-exists` instead of dotenvx.** The only secret-like setting is the master key; dotenvx's encrypted env files add a dependency without benefit here.

**ADR-008 — No CORS at all.** UI and API are same-origin (Vite proxy in dev, server serves the built UI in production-like mode).

**ADR-009 — Network errors are `failed`, not `error`.** An unreachable system under test is an observed fact about that system. `error` is reserved for FlowCheck's own faults.

**ADR-010 — `ACTION_FAILED` separate from `LOCATOR_NOT_FOUND`.** "Element exists but cannot be clicked" and "element does not exist" lead to different fixes.
