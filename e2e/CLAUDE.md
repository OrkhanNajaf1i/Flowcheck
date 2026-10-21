# e2e — acceptance tests

Playwright Test against the real stack: demo (4420), server (4410) and runner start as separate processes (`playwright.config.ts` → `webServer`) with a throwaway data dir. Spec: PROJECT_RULES §20, §21.

## Rules
- Never mock the engine, runner or server here. Tests drive the public API like the UI does (same-origin `Origin` header) and poll `GET /api/runs/:id` until a final status.
- `workers: 1`: one runner, one execution lock and shared demo state. Call `setDemoMode(...)` (it also resets demo state) at the start of tests that depend on the mode.
- Assert the exact status and error code, not just "not passed".
- Map each test to the acceptance criterion it proves (PROJECT_RULES §20); list uncovered criteria in `docs/STATUS.md`.
- Run: `pnpm e2e` (needs `pnpm playwright:install` once).
