# apps/demo — deterministic demo shop

Test target for acceptance tests, on its own origin (default `http://127.0.0.1:4320`). Not production code, not a mock of FlowCheck results.
Spec: PROJECT_RULES §19.

## Rules
- Fastify + static HTML + inline vanilla JS (no build step). In-memory state; restart resets it.
- Bug modes: `success`, `create-order-500`, `ui-success-but-no-order`, `cart-not-cleared`. Set via `DEMO_BUG_MODE` or loopback-only `POST /__demo/mode`; `POST /__demo/reset` clears carts and orders.
- Keep behaviour deterministic: no randomness in flows except IDs.
- Intentional traps used by tests — do not "fix" them:
  - every product button is named "Add to cart" (ambiguous role locator);
  - `GET /api/admin-only` always returns 403.
- Cart is cookie-session based (`demo_session`) so UI and API steps share the session through browser cookies.
- Phase 3+ will add: a page with a service worker, a login page for auth profiles, an SPA route for the recorder.

## Tests
`pnpm --filter @flowcheck/demo test` — bug-mode behaviour via `app.inject`.
