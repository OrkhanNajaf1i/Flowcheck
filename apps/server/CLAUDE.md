# apps/server — Fastify REST API

HTTP + DB only. Never imports Playwright or the test engine (Biome enforces this).
Spec: PROJECT_RULES §15, §16, §17, §18.

## Rules
- All routes under `/api`. Request schemas come from `@flowcheck/shared` (`fastify-type-provider-zod`). Responses go through DTO mappers in `dto.ts` (ISO timestamps, no DB internals).
- Errors: always `{ error: { code, message, details } }` via `errors.ts`. Validation errors carry `details.issues[]` with field paths. Never put secret values in `details`.
- Status codes: run create → 202 `{ runId }`; create → 201; cancel → 202 and idempotent.
- GET never changes state.
- Definitions are validated with `parseDefinition` (own schemaVersion). Unknown version → `UNSUPPORTED_SCHEMA_VERSION`.
- Run create: validate inputs (`resolveInputs`), environment enabled and in the same project, then snapshot the environment **at creation**.
- Revision save requires `baseRevisionId` = current revision, else 409 `REVISION_CONFLICT`.

## Local security (`security.ts`) — from phase 1, do not weaken
- Listen on `127.0.0.1` only.
- Host header must be a known loopback host:port (DNS rebinding).
- Non-GET/HEAD/OPTIONS requests need an `Origin` from `config.allowedOrigins`; missing Origin is rejected.
- No CORS plugin, no CORS headers.
- Helmet CSP is `'self'` based; Monaco workers need `worker-src blob:` (already set).
- Artifacts are served only via `/api/runs/:runId/artifacts/:artifactId` with the run↔artifact relation checked, path resolved inside the artifacts root, `nosniff` + `CSP: sandbox`.
- Access token (`access.ts`): every `/api` request needs the `flowcheck_session_<port>` cookie (HMAC of the token); `GET /api/session?token=` exchanges the printed link for it and redirects to `/`. `buildServer` requires `accessToken`; tests pass a fixed one and send the cookie.
- Artifact retention (`retention.ts`): at start and every 6 h, by age and per-project quota, never for queued/running runs; rows first, then files (failures logged).

## Tests
`pnpm --filter @flowcheck/server test` uses `app.inject` with a temp DB. Requests must send `host: 127.0.0.1:4310` and, for writes, `origin: http://127.0.0.1:4310`.
