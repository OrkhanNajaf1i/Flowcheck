import type { EnvironmentSnapshot, ErrorCode, FailureSummary, FinalRunStatus, InputValue, StepPhase, StepStatus } from '@flowcheck/shared';
import { and, asc, desc, eq, inArray, isNull, lt, or } from 'drizzle-orm';
import type { FlowDb } from './client.ts';
import { notFound, RepoError } from './errors.ts';
import { newId } from './ids.ts';
import { artifacts, executionLock, stepRuns, testRuns } from './schema.ts';

export type RunRow = typeof testRuns.$inferSelect;
export type StepRunRow = typeof stepRuns.$inferSelect;
export type ArtifactRow = typeof artifacts.$inferSelect;

/** A holder whose heartbeat is older than this is considered dead. */
export const HEARTBEAT_STALE_MS = 30_000;

export function createRun(
  db: FlowDb,
  input: {
    testCaseId: string;
    revisionId: string;
    environmentId: string;
    environmentSnapshot: EnvironmentSnapshot;
    inputsSnapshot: Record<string, InputValue>;
  },
  now = Date.now(),
): RunRow {
  return db
    .insert(testRuns)
    .values({ id: newId(now), ...input, status: 'queued', createdAt: now })
    .returning()
    .get();
}

export function getRun(db: FlowDb, id: string): RunRow {
  const row = db.select().from(testRuns).where(eq(testRuns.id, id)).get();
  if (!row) throw notFound('Run', id);
  return row;
}

export function listRunsForTestCase(db: FlowDb, testCaseId: string, limit = 50): RunRow[] {
  return db
    .select()
    .from(testRuns)
    .where(eq(testRuns.testCaseId, testCaseId))
    .orderBy(desc(testRuns.createdAt), desc(testRuns.id))
    .limit(limit)
    .all();
}

export function getStepRuns(db: FlowDb, runId: string): StepRunRow[] {
  return db.select().from(stepRuns).where(eq(stepRuns.runId, runId)).orderBy(asc(stepRuns.order)).all();
}

export function getArtifacts(db: FlowDb, runId: string): ArtifactRow[] {
  return db.select().from(artifacts).where(eq(artifacts.runId, runId)).orderBy(asc(artifacts.createdAt)).all();
}

export function getArtifact(db: FlowDb, runId: string, artifactId: string): ArtifactRow {
  const row = db
    .select()
    .from(artifacts)
    .where(and(eq(artifacts.id, artifactId), eq(artifacts.runId, runId)))
    .get();
  if (!row) throw notFound('Artifact', artifactId);
  return row;
}

/**
 * Atomically claims the oldest queued run and takes the execution lock, in one IMMEDIATE
 * transaction. Returns null when nothing is queued or the lock is held.
 */
export function claimNextRun(db: FlowDb, workerId: string, now = Date.now()): RunRow | null {
  return db.transaction(
    (tx) => {
      if (tx.select().from(executionLock).get()) return null;
      const next = tx
        .select({ id: testRuns.id })
        .from(testRuns)
        .where(eq(testRuns.status, 'queued'))
        .orderBy(asc(testRuns.createdAt), asc(testRuns.id))
        .limit(1)
        .get();
      if (!next) return null;
      const claimed = tx
        .update(testRuns)
        .set({ status: 'running', workerId, claimedAt: now, startedAt: now, heartbeatAt: now })
        .where(and(eq(testRuns.id, next.id), eq(testRuns.status, 'queued')))
        .returning()
        .get();
      if (!claimed) throw new RepoError('QUEUE_CLAIM_CONFLICT', `Run ${next.id} was claimed concurrently`);
      tx.insert(executionLock).values({ id: 1, holderKind: 'run', holderId: claimed.id, acquiredAt: now, heartbeatAt: now }).run();
      return claimed;
    },
    { behavior: 'immediate' },
  );
}

/** Refreshes liveness and returns the run's cancellation request time, if any. */
export function heartbeatRun(db: FlowDb, runId: string, now = Date.now()): { cancellationRequestedAt: number | null } {
  return db.transaction(
    (tx) => {
      const run = tx
        .update(testRuns)
        .set({ heartbeatAt: now })
        .where(eq(testRuns.id, runId))
        .returning({ cancellationRequestedAt: testRuns.cancellationRequestedAt })
        .get();
      tx.update(executionLock).set({ heartbeatAt: now }).where(eq(executionLock.holderId, runId)).run();
      return { cancellationRequestedAt: run?.cancellationRequestedAt ?? null };
    },
    { behavior: 'immediate' },
  );
}

export function finishRun(
  db: FlowDb,
  runId: string,
  status: FinalRunStatus,
  failureSummary: FailureSummary | null,
  now = Date.now(),
): void {
  db.transaction(
    (tx) => {
      tx.update(testRuns)
        .set({ status, failureSummary, finishedAt: now, heartbeatAt: now })
        .where(and(eq(testRuns.id, runId), eq(testRuns.status, 'running')))
        .run();
      tx.delete(executionLock).where(eq(executionLock.holderId, runId)).run();
    },
    { behavior: 'immediate' },
  );
}

/**
 * Cancel is idempotent: queued -> cancelled immediately; running -> cancellation requested
 * (the runner stops it); finished runs are left untouched.
 */
export function requestCancel(db: FlowDb, runId: string, now = Date.now()): RunRow {
  return db.transaction(
    (tx) => {
      const run = tx.select().from(testRuns).where(eq(testRuns.id, runId)).get();
      if (!run) throw notFound('Run', runId);
      if (run.status === 'queued') {
        return tx
          .update(testRuns)
          .set({ status: 'cancelled', cancellationRequestedAt: now, finishedAt: now })
          .where(eq(testRuns.id, runId))
          .returning()
          .get() as RunRow;
      }
      if (run.status === 'running' && run.cancellationRequestedAt === null) {
        return tx.update(testRuns).set({ cancellationRequestedAt: now }).where(eq(testRuns.id, runId)).returning().get() as RunRow;
      }
      return run;
    },
    { behavior: 'immediate' },
  );
}

/**
 * Marks runs whose worker is gone as interrupted, together with their unfinished steps, and
 * frees their lock. They are never re-executed automatically. Queued runs are left queued and
 * continue in FIFO order.
 *
 * `isWorkerAlive` decides for runs with a fresh heartbeat; stale heartbeats are always dead.
 */
export function interruptOrphanedRuns(db: FlowDb, isWorkerAlive: (workerId: string) => boolean, now = Date.now()): string[] {
  return db.transaction(
    (tx) => {
      const running = tx.select().from(testRuns).where(eq(testRuns.status, 'running')).all();
      const orphaned = running.filter((run) => {
        const stale = run.heartbeatAt === null || now - run.heartbeatAt > HEARTBEAT_STALE_MS;
        return stale || run.workerId === null || !isWorkerAlive(run.workerId);
      });
      if (orphaned.length === 0) return [];
      const ids = orphaned.map((r) => r.id);
      const summary: FailureSummary = {
        code: 'PROCESS_INTERRUPTED',
        message: 'The runner stopped before the run completed; results are incomplete',
      };
      tx.update(testRuns).set({ status: 'interrupted', failureSummary: summary, finishedAt: now }).where(inArray(testRuns.id, ids)).run();
      tx.update(stepRuns)
        .set({ status: 'interrupted', finishedAt: now, errorCode: 'PROCESS_INTERRUPTED', errorMessage: 'Run was interrupted' })
        .where(and(inArray(stepRuns.runId, ids), inArray(stepRuns.status, ['running', 'pending'])))
        .run();
      tx.delete(executionLock)
        .where(and(eq(executionLock.holderKind, 'run'), inArray(executionLock.holderId, ids)))
        .run();
      return ids;
    },
    { behavior: 'immediate' },
  );
}

/** Frees a lock whose holder stopped heartbeating (e.g. a crashed recorder in later phases). */
export function releaseStaleLock(db: FlowDb, now = Date.now()): boolean {
  const result = db
    .delete(executionLock)
    .where(or(lt(executionLock.heartbeatAt, now - HEARTBEAT_STALE_MS), isNull(executionLock.heartbeatAt)))
    .run();
  return result.changes > 0;
}

export interface PlannedStep {
  stepId: string;
  name: string;
  type: string;
  phase: StepPhase;
  order: number;
}

/** Creates all step rows as pending up front so the timeline is visible from the start. */
export function createPendingSteps(db: FlowDb, runId: string, steps: PlannedStep[]): void {
  if (steps.length === 0) return;
  db.insert(stepRuns)
    .values(steps.map((s) => ({ id: newId(), runId, ...s, status: 'pending' as const })))
    .run();
}

export function markStepRunning(db: FlowDb, runId: string, order: number, startedAt: number): void {
  db.update(stepRuns)
    .set({ status: 'running', startedAt })
    .where(and(eq(stepRuns.runId, runId), eq(stepRuns.order, order)))
    .run();
}

export function completeStep(
  db: FlowDb,
  runId: string,
  order: number,
  result: {
    status: StepStatus;
    startedAt: number | null;
    finishedAt: number | null;
    expected: unknown;
    actual: unknown;
    errorCode: ErrorCode | null;
    errorMessage: string | null;
    skipReason: string | null;
  },
): StepRunRow {
  const row = db
    .update(stepRuns)
    .set(result)
    .where(and(eq(stepRuns.runId, runId), eq(stepRuns.order, order)))
    .returning()
    .get();
  if (!row) throw notFound('Step run', `${runId}#${order}`);
  return row;
}

export function insertArtifact(db: FlowDb, input: Omit<ArtifactRow, 'id' | 'createdAt'>, now = Date.now()): ArtifactRow {
  return db
    .insert(artifacts)
    .values({ id: newId(now), ...input, createdAt: now })
    .returning()
    .get();
}
