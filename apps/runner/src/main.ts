import { claimAuthCapture, claimNextRun, failOrphanedAuthCaptures, interruptOrphanedRuns, openDatabase } from '@flowcheck/db';
import pino from 'pino';
import { runAuthCapture } from './auth-capture.ts';
import { loadConfig } from './config.ts';
import { executeRun } from './execute-run.ts';
import { isWorkerAlive, newWorkerId } from './worker-id.ts';

const config = loadConfig();
const log = pino({ name: 'runner' });
const workerId = newWorkerId();
const handle = openDatabase(config.dbFile);
const shutdown = new AbortController();
const alive = (id: string) => isWorkerAlive(id, workerId);

const recovered = interruptOrphanedRuns(handle.db, alive);
if (recovered.length > 0) log.warn({ runIds: recovered }, 'marked runs of a stopped runner as interrupted');
log.info({ workerId, dataDir: config.dataDir }, 'runner started');

let busy: Promise<unknown> | null = null;

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    log.info({ signal }, 'shutting down');
    shutdown.abort();
    await busy;
    handle.close();
    process.exit(0);
  });
}

while (!shutdown.signal.aborted) {
  try {
    interruptOrphanedRuns(handle.db, alive);
    failOrphanedAuthCaptures(handle.db, alive);
    // A login-session capture holds the execution lock, so runs wait until it is finished.
    const capture = claimAuthCapture(handle.db, workerId);
    if (capture) {
      log.info({ captureId: capture.id }, 'opening browser for login session capture');
      busy = runAuthCapture(capture, { db: handle.db, config, log, shutdown: shutdown.signal });
      await busy;
      busy = null;
      continue;
    }
    const run = claimNextRun(handle.db, workerId);
    if (run) {
      log.info({ runId: run.id }, 'claimed run');
      busy = executeRun(run, { db: handle.db, config, log, shutdown: shutdown.signal });
      await busy;
      busy = null;
      continue;
    }
  } catch (error) {
    log.error({ err: error }, 'queue loop error');
  }
  await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
}
