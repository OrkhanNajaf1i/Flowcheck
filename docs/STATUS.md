# Implementation status

Last updated: 2026-10-20 (phase 2).

## Phase 1 — done

| Item | State | Evidence |
|---|---|---|
| Monorepo (pnpm 12, Turborepo, Biome, TS 5.9, Node 24) | done | `pnpm check` |
| Shared schemas: definition v1, locators, templates, API contract, error codes | done | `packages/shared` tests (12) |
| DB: schema, migrations, immutability triggers, queue claim, cancel, restart recovery | done | `packages/db` tests (11), incl. 4-thread concurrent claim |
| Demo shop with 4 bug modes | done | `apps/demo` tests (5) |
| Engine: navigate, click, fill, assertVisible, apiRequest (9 assertion kinds) | done | `packages/test-engine` tests (25) + e2e |
| Target guard (origin allowlist, SSRF/IP checks, no redirects for API steps) | done | unit + e2e |
| Server API: projects, environments, test cases, revisions, runs, cancel, artifacts | done | `apps/server` tests (13) |
| Local server security: loopback, Host check, Origin check, no CORS | done | server tests + manual curl smoke test |
| Runner: claim, heartbeat, cancel with grace period, run timeout, shutdown, orphan recovery, screenshots | done | `apps/runner` tests (6) + e2e |
| Real passing and failing runs | done | `e2e` (10 tests, real Chromium) |

### Acceptance criteria covered so far (PROJECT_RULES §20)

| # | Criterion | Covered by |
|---|---|---|
| 3 | navigate → click → assertVisible built and run (via API; UI in phase 2) | e2e "passes in success mode" |
| 10 | success mode passes | e2e |
| 11 | create-order-500 fails on the status assertion, observed 500 reported | e2e (API variant; network-check variant in phase 3) |
| 14 | ambiguous locator → `AMBIGUOUS_LOCATOR` | e2e |
| 15 | 403 expected and received → passed | e2e |
| 16 | missing variable rejected clearly | shared + e2e |
| 18 | edits do not change an earlier run's revision | db + server tests |
| 19 | environment snapshot unaffected by later edits | db + server tests |
| 20 | after the first main failure, remaining main steps skipped | e2e |
| 22 | cancel works | e2e (browser closing verified only indirectly via `finally`) |
| 23 | restart → running run interrupted | db test (real process restart not yet e2e) |
| 25 | queue never runs the same run twice | db concurrent claim test |
| 26 | outside-allowlist navigation blocked | e2e (redirect bypass: covered by design, no dedicated e2e yet) |
| 27 | executable code rejected in definitions | shared + server tests |
| 28 | archived test keeps run history | server test |
| 30 | not executed ≠ passed | engine status tests |
| 32 | cloud metadata blocked | unit + e2e |
| 33 | run timeout → interrupted | e2e |

## Phase 2 — done

| Item | State | Evidence |
|---|---|---|
| Web UI (React 19, Vite 8, TanStack Router/Query/Table, Zustand, react-hook-form, shadcn-style components, Tailwind 4) | done | `apps/web` tests (6), e2e UI tests (4) |
| Projects, environments (allowed origins, private network switch), tests list with name/result filters, duplicate, archive | done | e2e UI test |
| Test editor: setup/main/cleanup, add/edit/delete, drag-and-drop reorder (keyboard too), inputs, timeouts, save revision, conflict detection, unsaved-changes guard, field-level validation, Advanced JSON (Monaco, bundled locally) | done | e2e UI tests + form conversion tests |
| Run dialog with real-request warning and inputs; run detail with live polling, step timeline, expected/actual, screenshots, blocked requests, cancel | done | e2e UI tests |
| `pnpm start` (server + runner + UI on one origin), `pnpm dev` (Vite) | done | started manually on a separate port |
| Blocked requests shown on passing steps too (helps find missing CDN origins) | done | engine change |

Manual verification: a run against `https://example.com` executed and reported `LOCATOR_NOT_FOUND` because the page no longer has the expected heading (confirmed with curl and the stored screenshot).

## Usability pass (after phase 2) — done

| Item | Evidence |
|---|---|
| English + Azerbaijani UI with a language switch | e2e "switched to Azerbaijani" |
| Getting-started checklist on the project page | e2e main UI flow |
| Simplified website form (only the address required; local-address warning) | web component tests (2) + e2e |
| Test templates (Login, Page shows text, API check, Blank) | e2e "login template" |
| Step-type picker with icons and descriptions; readable one-line step summaries; locator "How do I find this?" help | e2e main UI flow |
| Optional sections collapsed (before/after steps, inputs, timeouts, JSON) | visual check (screenshots) |
| "Things to check" hints per error code on the run page | e2e failing run |
| Permanent project deletion (typed-name confirmation; refused while a run is active; artifact files removed) | db (2), server (2), e2e (1) |

## Remaining step types — done

All step types of PROJECT_RULES §6 are implemented in schema, engine, editor (grouped picker, both languages) and covered by tests:
assertText (exact/contains, whitespace normalization, empty text ≠ missing element), assertHidden (every match inspected), assertValue, assertEnabled, assertUrl (pathname/full URL, query ignore/include, hash ignored), selectOption (by label or value), check, uncheck, press (allowlisted combinations, on an element or the page).

Evidence: shared (3 new), engine (4 new), web round-trip (1 new), e2e steps.spec (5) + UI test (1). The full-suite run exposed a real engine bug (a final read with a ~1 ms timeout turned an unmet expectation into INTERNAL_ERROR); fixed with a minimum read time and timeout handling in the poll loop, then verified with 3 repeated runs (45/45).

## Extra locator kinds — done

ID, other attribute (name + exact value), image alt text and title locators, plus a warning for auto-generated ids. Evidence: shared (3 new), web round-trip (extended), e2e steps.spec (1: id, aria-label via role, title, alt, attribute, quote-injection attempt) and UI test (1).

## Scoped locators — done

Optional "search only inside another element" (`locator.within`, one level). Evidence: shared (1 new), web round-trip (extended), e2e steps.spec (scoped vs. unscoped, ambiguous container, missing container) and UI test (1).

## Not done yet (next phases)

- **Phase 2 leftovers:** best-effort cleanup after cancel; revision diff view.
- **Phase 3:** network checks on UI actions, output variables, setup/cleanup acceptance flow with demo order deletion, secrets (encryption, redaction in runs), auth profiles.
- **Phase 4:** recorder.
- **Phase 5:** bootstrap token, artifact retention/quota, remaining acceptance criteria (1, 2, 4–9, 12, 13, 17, 21, 24, 29, 31) and e2e for real process restart and redirect bypass.

## Next concrete task

Phase 3: network checks on UI actions (with output variables such as orderId), then secrets and auth profiles.
