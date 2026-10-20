# FlowCheck

Local web app for manual and automation QA engineers: define a user scenario, state the expected results for both the UI and the HTTP API, run it in Chromium, and see which step failed, why, and the evidence (screenshots, request/response data).

> **Status: phases 1–2 of 5.** Web UI, test engine, queue/runner and demo shop work and are covered by real end-to-end tests. Not yet available: recorder, network checks on UI actions, output variables, secrets, auth profiles. See [docs/STATUS.md](docs/STATUS.md).

FlowCheck reports the results of the checks you configure and what it observed. It does not find all bugs, does not replace QA, and does not claim to know root causes. See [docs/limitations.md](docs/limitations.md).

## Requirements

- Node.js 24 LTS (`.nvmrc`)
- pnpm via Corepack (`corepack enable`)
- Windows, macOS or Linux

## Setup (once)

```sh
corepack enable
pnpm install
pnpm playwright:install     # Chromium for the pinned Playwright version
```

Use `pnpm playwright:install` (= `pnpm exec playwright install chromium`), not `pnpm dlx`: `dlx` downloads the newest Playwright and may install a Chromium build that does not match the pinned version.

## Start

```sh
pnpm start
```

Open **http://127.0.0.1:4310**. This starts the server (API + UI) and the runner (executes tests) in one terminal; `Ctrl+C` stops both. The UI is built automatically on the first start; after pulling UI changes run `pnpm build:web`.

- `pnpm start:with-demo` also starts the demo shop on http://127.0.0.1:4320 (a practice target).
- `pnpm dev` runs the UI with hot reload on http://127.0.0.1:5173.
- Data (SQLite database, screenshots) is stored in `./data` (override with `FLOWCHECK_DATA_DIR`).

## Testing your own website

The UI is available in English and Azerbaijani (language switch in the top-right corner). A **Getting started** guide on the project page walks you through the three steps:

1. **Add website** — only the *Website address* is required (e.g. `https://staging.example.com`). Under *Advanced settings*:
   - *API address*: where API steps go; empty = the website address.
   - *Extra allowed domains*: CDNs or other domains your pages need. Everything else is blocked during runs, and the run page lists what was blocked so you know what to add.
   - *Allow private network*: needed for `localhost`/internal addresses — the form warns you when it detects one.
   - Prefer a staging/test copy of your site: tests send real requests and can create or change data.
2. **New test** — pick a template: *Login*, *Page shows text*, *API check* or *Blank*. Templates contain example values (field names, button text) that you replace with what your site shows.
3. **Edit the steps** — *Add step* opens a picker with three groups: **Do something** (*Open page*, *Click*, *Type text*, *Choose from list*, *Tick/Untick checkbox*, *Press key*), **Check something** (*Check it is shown*, *Check text*, *Check it is not shown*, *Check field value*, *Check it is enabled*, *Check page address*) and **Backend** (*API request*). Each collapsed step shows a one-line summary. For elements, choose how to find them: *Test id* (`data-testid`, most reliable), *Button / link name* (also icon buttons with `aria-label`), *Field label*, *Placeholder*, *Image alt text*, *Title*, *Visible text*, *ID*, *Other attribute* (e.g. `name="email"`, `data-qa`) or *CSS selector* (fragile). Ids that look auto-generated (e.g. `menu-trigger-v-31`) get a warning because they change between page loads. Easiest way: in DevTools right-click the element → *Copy → Copy element*, then use **Suggest from HTML** in the step and pick a suggestion (the HTML is only read, never run; layout classes and DOM paths are never suggested). If the same text appears in several places, tick *Search only inside another element* and choose the container (e.g. the element with id `header`); the container must be unique too. *How do I find this?* under each element explains how to look it up with right-click → *Inspect*. An element must match **exactly one** element on the page; several matches fail the step instead of guessing.
4. *(Optional)* **Check the request an action sends** — on a click (or other action) step, add a request check: FlowCheck watches the requests the browser sends because of that action, e.g. `POST /api/orders`, checks the response (status, JSON values…) and can **keep a value** such as the new order id. Later steps use it as `{{outputs.orderId}}`, e.g. an API step `GET /orders/{{outputs.orderId}}` and a cleanup step `DELETE /orders/{{outputs.orderId}}`. Requests are only observed, never sent again; matching uses address, method and path — never the status, so a 500 is reported as a failed status check, not as "no response".
5. **Save**, then **Run** → choose the website → **Start run**.
6. The run page updates live. A failed step opens automatically with the error code, expected vs. actual, a screenshot, blocked requests, and a short **Things to check** list.

## Results

| Status | Meaning |
|---|---|
| `passed` | All setup and main steps passed |
| `failed` | An expectation was not met — e.g. assertion, missing or ambiguous element, unreachable or blocked target |
| `error` | FlowCheck could not evaluate the test reliably (internal error, browser crash, invalid stored test) |
| `cancelled` | Stopped by you; cleanup is not guaranteed and test data may remain |
| `interrupted` | Stopped before completion: runner stopped or run timeout reached. Never re-run automatically |

HTTP 4xx/5xx is not a failure by itself — a test expecting `403` passes when it gets `403`. After the first failed main step, the remaining main steps are `skipped`; cleanup steps still run.

## Key behaviours

- **Revisions** are immutable; every save creates a new one. A run keeps the revision and an environment snapshot from when it was started.
- **Test data**: each run uses a fresh browser, but that does not clean data on your server. Only explicit cleanup steps do.
- **Service workers** are blocked in test browsers so they cannot bypass request inspection.
- **SSRF protection**: only allowlisted origins; resolved IPs are checked; cloud metadata addresses are always blocked; private/loopback targets need "Allow private network". There is a residual DNS TOCTOU risk — see [docs/security.md](docs/security.md).
- **Secrets**: passwords and tokens go under *Project → Secrets*. They are stored encrypted, never shown again, and replaced by `[REDACTED]` in reports. Use them as `{{secrets.name}}` in "Type text" values and API headers (the "Use a secret" picker inserts it). If the master key (`FLOWCHECK_MASTER_KEY` or `data/master.key`) is lost, secrets cannot be recovered — enter them again.
- **Screenshots** are taken when a page step fails, and after a passed step when *Take a screenshot after this step passes* is ticked (in the step under *Advanced settings*). A screenshot is evidence to look at, not a check: to prove that e.g. a dialog opened, add a *Check it is shown* step for it. Screenshots may contain personal data; they are not redacted.
- **Recorder**: in the test editor press **Record steps** → choose the website and start page → a browser window opens on this computer. Click, type, choose and press Enter/Tab/Escape as usual; the steps appear live in FlowCheck. Press **Stop recording** (in FlowCheck or in the window) and **Add … steps to the test**, then review the element of each step and **Save**. Checks are never recorded — add "Check text"/"Check page address" steps yourself. Typed passwords are never stored: the step uses `{{secrets.password}}`; create that secret. Frames, shadow DOM, new tabs, file uploads and drag and drop are not recorded (you get a warning). While recording, no test runs.
- **Login-protected pages**: on the website card press **Create login session** → a browser window opens on this computer → log in there with a test account → back in FlowCheck press **Save session**. In the test editor choose the session under *Login session*; runs then start already logged in, only on that website. Saved: cookies, localStorage, IndexedDB (encrypted). Not saved: sessionStorage, passkeys/WebAuthn. Runs never update the saved session — when it expires on the site, create it again. While the login browser is open, no test runs.

## REST API

Everything in the UI is available under `/api`. State-changing requests must carry `Origin: http://127.0.0.1:4310` (CSRF protection), and the `Host` must be `127.0.0.1` or `localhost`. Example (bash):

```sh
curl -s -H 'content-type: application/json' -H 'origin: http://127.0.0.1:4310' \
  -X POST http://127.0.0.1:4310/api/projects -d '{"name":"Demo shop"}'
```

## Development

```sh
pnpm check     # Biome lint/format check + typecheck + unit/integration tests
pnpm e2e       # builds the UI, starts demo, server and runner on ports 4420/4410, runs API and UI acceptance tests
```

Architecture: [docs/architecture.md](docs/architecture.md) · Security: [docs/security.md](docs/security.md) · Full specification (Azerbaijani): [docs/PROJECT_RULES.md](docs/PROJECT_RULES.md)

## Troubleshooting

- **`EADDRINUSE 127.0.0.1:4310`** — FlowCheck (or another program) is already running on that port. Stop it, or start with `FLOWCHECK_SERVER_PORT=4311`.
- **Run stays "Queued"** — the runner is not running. Use `pnpm start` (starts both), not only the server.
- **`Executable doesn't exist` from Playwright** — run `pnpm playwright:install`.
- **`SSRF_BLOCKED` for a local site** — enable *Allow private network* on the environment.
- **`ORIGIN_NOT_ALLOWED` or a page that renders without styles** — add the blocked origins listed on the run page to *Extra allowed origins*.
- **`403 HOST_NOT_ALLOWED` / `FORBIDDEN_ORIGIN` from scripts** — use `127.0.0.1:<port>` and send the `Origin` header on POST/PATCH.
