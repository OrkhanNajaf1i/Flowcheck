# packages/test-engine — step execution

Executes a validated definition inside a Playwright `BrowserContext` given by the runner.
Spec: PROJECT_RULES §6, §7, §9, §10, §11, §13, §16, §17.

## Boundaries
- Depends on `@flowcheck/shared`, Playwright and `ipaddr.js`. Never on Fastify or `@flowcheck/db` (enforced by Biome `noRestrictedImports`).
- Persistence happens through the `EngineReporter` interface; the engine never writes files or DB rows.
- Callbacks passed to `locator.evaluate()` run in the browser: type them structurally (no DOM lib in this package).

## Verdict rules (do not "simplify" these)
- `failed` = the system under test did not meet an expectation (assertion, locator not found, ambiguous locator, target unreachable, blocked origin). `error` = FlowCheck could not evaluate (internal error, browser crash, invalid variable). See `errors.ts` → `ERROR_KIND_BY_CODE`.
- Locators must match exactly one element. More than one → `AMBIGUOUS_LOCATOR` immediately. Never `first()` / `nth(0)`. No fallback chains.
- Element found but action impossible → `ACTION_FAILED`, not `LOCATOR_NOT_FOUND`.
- API: every HTTP status is a normal response; 4xx/5xx only fail through assertions. Transport failures → `NETWORK_ERROR` / `NETWORK_TIMEOUT`.
- No retries of any request. `maxRedirects: 0`.
- JSON Pointer is RFC 6901 (`json-pointer.ts`), own properties only. Comparisons are strict (`compare.ts`): `"1" ≠ 1`, `null ≠ missing`.
- Missing variable → `MISSING_VARIABLE`, never `""`. Scope uses `Map`s.
- `computeRunStatus` never returns `passed` unless every setup and main step passed.
- First main failure skips the rest of main; cleanup still runs; cleanup with a missing variable is `skipped` with a reason; cleanup never overwrites `primaryFailure`.

## Target policy
- `installTargetGuard` routes every browser request: non-allowlisted origin or blocked IP → aborted and recorded.
- API steps check origin + resolved IPs before sending (`assertTargetAllowed`). Metadata IPs are always blocked; private/loopback only with `allowPrivateNetwork`.
- `startTargetGuard(policy)`: local proxy for all browser traffic of a context (`contextOptions`, bypass `<-loopback>`) + route check for the first request. Never rely on `route()` alone: it does not see redirect hops.
- Known gap (documented, not hidden): for API steps DNS can change between our check and the real connection (TOCTOU).

## Redaction
- `redact.ts`: sensitive headers, known secret values (plain, URL-encoded, base64). Persisted bodies ≤ 256 KB, parse limit 1 MB. Screenshots are not redacted — mark them `sensitive`.

## Tests
`pnpm --filter @flowcheck/test-engine test` (pure logic). Browser behaviour is covered by `e2e/` against the real demo.
