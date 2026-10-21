# FlowCheck — CLAUDE.md

Local, single-user web app for QA engineers: build or record UI + HTTP API test scenarios, run them in Chromium, see step-by-step evidence of why something failed.

**Source of truth: [docs/PROJECT_RULES.md](docs/PROJECT_RULES.md)** (Azerbaijani). Read the relevant section before implementing a feature. `[DÜZƏLİŞ]` items override the original brief; `[AÇIQ SUAL]` items need the owner's decision — ask, don't guess.

## Where the rules live
Each package has its own CLAUDE.md with the rules for that area; read it before editing there.

| Area | File |
|---|---|
| Contracts, schemas, error codes, definition versioning | [packages/shared/CLAUDE.md](packages/shared/CLAUDE.md) |
| Step execution, verdicts, locators, target policy, redaction | [packages/test-engine/CLAUDE.md](packages/test-engine/CLAUDE.md) |
| SQLite, migrations, queue claim, immutability | [packages/db/CLAUDE.md](packages/db/CLAUDE.md) |
| REST API, local server security, artifacts | [apps/server/CLAUDE.md](apps/server/CLAUDE.md) |
| Worker loop, cancel/timeout/restart, screenshots | [apps/runner/CLAUDE.md](apps/runner/CLAUDE.md) |
| Demo shop and bug modes | [apps/demo/CLAUDE.md](apps/demo/CLAUDE.md) |
| React UI | [apps/web/CLAUDE.md](apps/web/CLAUDE.md) |
| Acceptance tests | [e2e/CLAUDE.md](e2e/CLAUDE.md) |
| Progress per phase | [docs/STATUS.md](docs/STATUS.md) |
| Architecture & decisions | [docs/architecture.md](docs/architecture.md) |
| Security model | [docs/security.md](docs/security.md) |
| Limitations | [docs/limitations.md](docs/limitations.md) |

## Communication
- The owner writes in Azerbaijani; reply in Azerbaijani. Code, identifiers, commits, UI text, README: English.
- Keep `docs/PROJECT_RULES.md` in Azerbaijani when updating it; log every rule change in its §24.

## Honesty rules (non-negotiable)
- Never claim tests pass unless you ran them in this session; never claim the app works unless you started it.
- Never present placeholder/mock output as real functionality. No hardcoded success, no fake numbers.
- Never simplify engine logic in a way that yields wrong verdicts (silent `first()`, status-based network matching, type coercion, `""` for missing variables, hidden retries).
- Don't invent library APIs — check the installed package's types in `node_modules` or its docs.
- Unsupported features fail loudly with a specific error code; never skip silently.
- End each phase with: implemented / commands actually run / tests actually passed / not run and why / remaining limitations — and update `docs/STATUS.md`.

## Architecture in one paragraph
pnpm workspace. `apps/server` (Fastify) and `apps/runner` (Playwright worker) are separate processes that communicate **only through SQLite** (`packages/db`). The runner executes definitions with `packages/test-engine`. Contracts live in `packages/shared` (zod only). `apps/web` (phase 2) talks only to the server API. `apps/demo` is the deterministic test target on its own origin. No Redis, no HTTP between server and runner.

## Stack (details: PROJECT_RULES §3)
- TypeScript 5.9 strict + `noUncheckedIndexedAccess` + `erasableSyntaxOnly`; Node 24 LTS runs `.ts` directly (native type stripping) — no build step for server/runner/demo. Use `.ts` extensions in relative imports, `import type` for types, no enums/namespaces/parameter properties.
- pnpm 12 workspaces, Turborepo, Biome (lint + format; also enforces package import boundaries).
- Server: Fastify 5, `fastify-type-provider-zod`, Zod 4, @fastify/helmet. Runner: Playwright 1.64.1 (exact pin). DB: SQLite (better-sqlite3) + Drizzle + drizzle-kit.
- Web (phase 2): React 19, Vite 8, TanStack Router/Query/Table, Zustand, react-hook-form, shadcn/ui + Tailwind 4, Monaco (local bundle), dnd-kit, ky.
- Tests: Vitest, Playwright Test (e2e against the real demo).
- `.env` is loaded with Node's `--env-file-if-exists` (see start scripts).
- Forbidden: Next/Remix/TanStack Start, Redux, Prisma/Sequelize/TypeORM, Redis/BullMQ, Express/Koa/Hono, Jest/Mocha, MUI/AntD/Chakra, Docker/K8s, GraphQL/tRPC, ESLint/Prettier.
- Dev OS is Windows: use `node:path`, no bash-only scripts in package.json.

## Commands (all verified)
```
corepack enable && pnpm install
pnpm playwright:install          # Chromium for the pinned Playwright version (never `pnpm dlx`)
pnpm start                       # server + runner, UI at http://127.0.0.1:4310 (builds UI on first start)
pnpm start:with-demo             # + demo shop on 4320
pnpm dev                         # Vite UI on 5173 + server + runner with --watch
pnpm build:web                   # rebuild UI for pnpm start
pnpm check                       # biome + typecheck + unit/integration tests
pnpm e2e                         # builds UI; API + UI acceptance tests on ports 4420/4410
pnpm db:generate                 # after editing packages/db/src/schema.ts
```
The owner may already run FlowCheck on 4310 with real data in `./data`. For manual verification use another port and data dir (`FLOWCHECK_SERVER_PORT`, `FLOWCHECK_DATA_DIR`) — never send test requests to the owner's instance. Every `/api` request needs the session cookie: set `FLOWCHECK_ACCESS_TOKEN` (≥ 32 chars) and open `/api/session?token=…`, or send the cookie from `sessionValue()`.
