# FlowCheck limitations

FlowCheck reports the result of the checks you configured and the facts it observed. It does not find all bugs, does not replace QA, and does not determine root causes.

## What a result means

| Status | Meaning |
|---|---|
| `passed` | Every setup and main step passed; no cleanup step failed |
| `failed` | An expectation was not met (assertion, missing/ambiguous element, blocked or unreachable target) |
| `error` | FlowCheck could not evaluate the test reliably (internal error, browser crash, invalid stored definition, environment disabled) |
| `cancelled` | You stopped the run. Cleanup is not guaranteed — test data may remain |
| `interrupted` | Execution stopped before completion: the runner stopped (`PROCESS_INTERRUPTED`) or the run timeout was reached (`RUN_TIMEOUT`). Interrupted runs are never re-run automatically |

- A `2xx` status is not treated as business success, and a `4xx/5xx` is not a failure by itself: only your assertions decide.
- A visible success message does not prove data was stored. Use an API step (e.g. `GET /orders/{id}`) to check that the API can read it back — this is still not a direct database check.

## Not supported in v1

SaaS/cloud browsers, multiple users/roles, AI test generation, selector self-healing, custom JavaScript steps, direct database access, load/performance testing, security scanning, mobile apps, browsers other than Chromium, visual (pixel) regression, multi-tab/popup/iframe/shadow-DOM targets, CAPTCHA/real payments/SMS, production environments, multipart/file upload, WebSocket assertions, master key rotation, sessionStorage-based auth.

## Current implementation state

Phases 1–4 are implemented. Not available yet: cleanup on cancel, artifact retention, bootstrap token. See [STATUS.md](STATUS.md) for the exact list.

## Known technical limits

- DNS TOCTOU between the SSRF check and the real connection (see [security.md](security.md)).
- Login sessions keep cookies, localStorage and IndexedDB only — not sessionStorage, passkeys/WebAuthn or server-side token refresh. An expired session shows up as a failing step on the first page that needs a login; FlowCheck does not claim the cause.
- Templates have no escape syntax: a literal `{{` cannot be written in a templated field.
- Browser context isolation does not clean server-side data; only explicit cleanup steps do.
- The duplicate-request check for network checks (phase 3) uses a 500 ms window and cannot exclude all later duplicates.
- Recorder: locator uniqueness is checked in the page at the moment of the action; the run is the final check (`AMBIGUOUS_LOCATOR` / `LOCATOR_NOT_FOUND`). A navigation within 3 s after a recorded action is treated as its result; a URL typed into the address bar sooner is not recorded. Events created by page scripts (untrusted), e.g. a custom dropdown that sets a select's value in JavaScript, are not recorded.
