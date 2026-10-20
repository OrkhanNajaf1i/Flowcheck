# apps/runner — queue worker

Single worker process: claims queued runs from SQLite, executes them with Playwright via `@flowcheck/test-engine`, writes step results and artifacts. Also runs login-session captures (`auth-capture.ts`) and recordings (`recorder.ts` + the in-page `recorder-page.js`). Their own DB rows are the command channel (save/cancel/stop timestamps) — the runner never calls the server over HTTP.

## Recorder
- Page events are untrusted: validate with `pageEventSchema`, ignore events from other pages; frames only report `iframe`.
- The page script only reports trusted (`isTrusted`) events and never sends password values.
- Stop: flush pending typing in the page, then finish. Window closed → `stopped` + `browserClosed` notice (draft kept). Runner gone → `failOrphanedRecordings` marks `failed`, events stay.
- `FLOWCHECK_RECORDER_HEADLESS=1` and `FLOWCHECK_RECORDER_DEBUG_PORT` are test-only (e2e drives the recorder browser over CDP).
Spec: PROJECT_RULES §3.5, §13, §16.

## Rules
- Each run: new `chromium.launch` + new context with `serviceWorkers: 'block'`, `acceptDownloads: false`; always closed in `finally`.
- `executeRun` never throws and always finishes the run (`finishRun` also releases the execution lock).
- Before executing: re-parse the stored definition with its own schemaVersion, re-check inputs and that the environment is still enabled. Targets come from the run's snapshot, not the live environment.
- Heartbeat every 2 s (`heartbeatRun`) — also how cancellation requests are noticed.
- Cancel: abort signal first, force-close the context after a 5 s grace period. Run timeout: abort + close immediately → `interrupted` / `RUN_TIMEOUT`. Shutdown (SIGINT/SIGTERM): `interrupted` / `PROCESS_INTERRUPTED`.
- Startup and every loop tick: `interruptOrphanedRuns` with `isWorkerAlive` (pid probe on this host). Never re-execute interrupted runs. Queued runs continue FIFO.
- Screenshots: only for failed UI steps, ≤ 10 MB, stored under `data/artifacts/<projectId>/<runId>/<uuid>.png`, marked `sensitive`.
- Logs via pino; never log secret values or full request bodies.
- `FLOWCHECK_HEADED=1` shows the browser (debugging only).

## Tests
`pnpm --filter @flowcheck/runner test` covers error paths without a browser. Real execution is covered by `e2e/`.
