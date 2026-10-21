import { parentPort, workerData } from 'node:worker_threads';
import { claimNextRun, finishRun, openDatabase } from '../src/index.ts';

// Competes for queued runs; finishes each one immediately so the lock frees up.
const { file, workerId } = workerData as { file: string; workerId: string };
const handle = openDatabase(file);
const claimed: string[] = [];
let idleRounds = 0;
while (idleRounds < 50) {
  const run = claimNextRun(handle.db, workerId);
  if (run) {
    claimed.push(run.id);
    finishRun(handle.db, run.id, 'passed', null);
    idleRounds = 0;
  } else {
    idleRounds += 1;
    await new Promise((r) => setTimeout(r, 2));
  }
}
handle.close();
parentPort?.postMessage(claimed);
