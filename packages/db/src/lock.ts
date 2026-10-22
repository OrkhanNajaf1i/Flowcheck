import type { FlowDb } from './client.ts';
import { RepoError } from './errors.ts';
import { executionLock } from './schema.ts';

type HolderKind = (typeof executionLock.$inferSelect)['holderKind'];

const BUSY: Record<HolderKind, string> = {
  run: 'a test is running',
  recording: 'a recording is in progress',
  auth_capture: 'a login session is being created',
};

/**
 * Takes the single execution lock for a recording or capture (runs take it in claimNextRun).
 * Must be called inside an IMMEDIATE transaction together with the holder's own insert.
 */
export function acquireExecutionLock(tx: FlowDb, holderKind: HolderKind, holderId: string, now: number): void {
  const lock = tx.select().from(executionLock).get();
  if (lock) {
    throw new RepoError('EXECUTION_LOCK_BUSY', `FlowCheck is busy (${BUSY[lock.holderKind]}). Try again when it has finished.`, {
      holderKind: lock.holderKind,
    });
  }
  tx.insert(executionLock).values({ id: 1, holderKind, holderId, acquiredAt: now, heartbeatAt: now }).run();
}
