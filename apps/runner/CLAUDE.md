# apps/runner — queue worker

Single worker process: claims queued runs from SQLite, executes them with Playwright via `@flowcheck/test-engine`, writes step results and artifacts. Later phases: recorder and auth capture (commands via a `runner_commands` table — the runner never calls the server over HTTP).
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
