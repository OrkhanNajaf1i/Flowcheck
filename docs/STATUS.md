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

## Suggest locators from HTML — done

Paste an element's HTML (DevTools → Copy element) and pick from locators ranked by stability, for the element and for its container. Evidence: web unit tests (7, incl. scripts/event handlers not executed) and a UI e2e test that pastes an icon button with a generated id, picks the suggestion and runs the test.

## Phase 3 (part 1): network checks and outputs — done

Request checks on action steps (listener attached before the action, matching by origin/method/exact path/selected query, 500 ms duplicate window, never re-sent), output variables from network checks and API steps, use of outputs in later steps and cleanup, editor UI for both, hints for NETWORK_TIMEOUT / AMBIGUOUS_NETWORK_MATCH.

Acceptance criteria now covered end-to-end (`e2e/tests/network.spec.ts`, repeated 3× without flakiness): 6 (fast POST /orders not missed), 7 (orderId from 201), 8 (later API step uses it), 9 (GET proves existence), 10, 11 (500 reported as status failure, not "no response"), 12 (UI success but no order), 13 (cart not cleared), 21 (cleanup does not erase the main failure; cleanup with a missing output is skipped with a visible reason).

## Phase 3 (part 2): secrets — done

Encrypted secrets per project (API + "Secrets" tab), `{{secrets.name}}` in fill values and headers with a picker in the editor, plain-password warning, runs refuse to start without required secrets, central redaction of all step evidence and error messages. Evidence: db (8 new: crypto round-trip, owner binding, tampering, key sources, repository), shared (2), server (2), e2e (2, incl. criterion 17 with a secret that ends up in the page URL) and a UI test.

## Phase 3 (part 3): auth profiles — done

"Create login session" on a website card: the runner opens a visible browser (target guard active, 15 min limit, closing the window = `cancelled`), the user logs in by hand and presses "Save session"; the storage state (cookies, localStorage, IndexedDB) is stored encrypted, bound to that website. The capture holds the execution lock; its row is the server → runner command channel (save/cancel requests), orphaned captures fail after 60 s. Tests pick a session in the editor; the run dialog offers only its website, the server refuses others (`AUTH_PROFILE_ENVIRONMENT_MISMATCH`); each run loads the state into a fresh context and never writes it back. Evidence: db (capture lifecycle, lock, orphan handling, upsert, encryption), demo login (`/login`, `/account`), e2e (`auth.spec.ts`: capture → save → logged-in run, cancel, mismatch) and a UI test.

## Phase 4: recorder — done

"Record steps" in the editor's main steps: the runner opens a visible browser (target guard, service workers blocked, 30 min limit) with a recorder script and an in-page "Stop" overlay. Recorded: click, typing (one fill per field, last value; flushed before any other action and on stop), choose from list, tick/untick, Enter/Tab/Escape, direct navigation (not the result of a recorded action, 3 s window); SPA route changes do not add steps. Only trusted events are recorded; the runner validates every event with Zod and stores it with `sequence` assigned in the same transaction, duplicates by `clientEventId` are ignored. Locators: test id → data-* → role + Chromium's own accessible name → label → placeholder → name → alt/title → text → id, each checked to match exactly one element on the page; an ambiguous role/text is scoped to a container with a stable handle; otherwise a CSS path marked fragile. Password values are never sent (draft uses `{{secrets.password}}` + warning). Frames, shadow DOM, popups, file inputs, drag and drop, unsupported fields → warnings. The draft is derived from the events on every read and only becomes a revision when the tester saves. Evidence: shared (draft building, event schema), db (sequence, duplicates, lock, stop, orphans, project delete), server (start/stop/lock/start path), e2e (`recorder.spec.ts`, 8 tests: criteria 4, 24, 29, password, SPA, scoping, overlay Stop, UI flow).

## Phase 5 (part 1): access token and artifact retention — done

The server prints `Open FlowCheck: …/api/session?token=…` (Vite port in dev); opening it sets `flowcheck_session_<port>` (HMAC of the token, HttpOnly, SameSite=Strict, 30 days) and every `/api` request without it gets `401` — the UI explains how to open the link. Token in `data/access.token` (same across restarts) or `FLOWCHECK_ACCESS_TOKEN`. Artifact retention at start and every 6 h: 30 days, then 500 MB per project oldest first, never for queued/running runs. Evidence: db (age, quota, active runs), server (401 incl. artifacts, forged cookie, link exchange, token persistence, file deletion, config validation), e2e (all suites use the cookie; a browser without it sees the explanation and the link signs it in), manual start on port 4510 (link printed, 401, cookie + redirect).

## Recorder: checks from the toolbar — done

The recorder toolbar has "Check it is shown" and "Check text": the next click picks the element (highlighted, never reaches the page, Esc cancels) and becomes an assertVisible / exact assertText step. Toolbar texts follow the UI language (en/az). Evidence: shared (check steps, template-like text dropped), demo SPA dialog, e2e (picking "Close" does not close the dialog; draft with checks replays and passes; Azerbaijani toolbar).

## Screenshots after passed steps — done

Optional per page step (`screenshot: true`, editor: step → Advanced settings): a screenshot is kept after the step passes, labelled "Screenshot after the step". The editor explains that it is evidence, not a check ("Check it is shown" proves e.g. a dialog opened). Evidence: shared schema test (not allowed on API steps), web round-trip, e2e (artifact only when asked, served as PNG).

## Not done yet (next phases)

- **Phase 2 leftovers:** best-effort cleanup after cancel; revision diff view.
- **Phase 5 (rest):** remaining acceptance criteria (1, 2, 5–9, 12, 13, 17, 21, 31) and e2e for real process restart and redirect bypass.

## Next concrete task

Phase 5 (rest): remaining acceptance criteria (service-worker page in the demo for criterion 31, real process restart, redirect bypass), then the phase 2 leftovers (cleanup after cancel, revision diff).
