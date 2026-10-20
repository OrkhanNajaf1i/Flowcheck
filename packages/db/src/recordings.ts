import type { RecordedEvent } from '@flowcheck/shared';
import { and, asc, count, eq, inArray } from 'drizzle-orm';
import { CAPTURE_CLAIM_TIMEOUT_MS } from './auth.ts';
import { getEnvironment, getTestCase } from './catalog.ts';
import type { FlowDb } from './client.ts';
import { notFound, RepoError } from './errors.ts';
import { newId } from './ids.ts';
import { acquireExecutionLock } from './lock.ts';
import { HEARTBEAT_STALE_MS } from './runs.ts';
import { executionLock, type RecordingStatus, recordingEvents, recordingSessions } from './schema.ts';

export type RecordingRow = typeof recordingSessions.$inferSelect;

export const RECORDING_ACTIVE: RecordingStatus[] = ['starting', 'recording', 'stopping'];
/** Longest time a recorder browser stays open. */
export const RECORDING_MAX_MS = 30 * 60_000;
/** Recorded page events per session; beyond this the recording is stopped with a warning. */
export const RECORDING_MAX_EVENTS = 2_000;

/** Starts a recording and takes the execution lock in one transaction. */
export function createRecording(
  db: FlowDb,
  input: { projectId: string; environmentId: string; startPath: string; testCaseId?: string | undefined },
  now = Date.now(),
): RecordingRow {
  return db.transaction(
    (tx) => {
      const env = getEnvironment(tx as unknown as FlowDb, input.environmentId);
      if (env.projectId !== input.projectId) throw notFound('Environment', input.environmentId);
      if (!env.enabled) throw new RepoError('ENVIRONMENT_DISABLED', `Environment "${env.name}" is disabled`);
      if (input.testCaseId !== undefined && getTestCase(tx as unknown as FlowDb, input.testCaseId).projectId !== input.projectId) {
        throw notFound('Test case', input.testCaseId);
      }
      const id = newId(now);
      acquireExecutionLock(tx as unknown as FlowDb, 'recording', id, now);
      return tx
        .insert(recordingSessions)
        .values({
          id,
          projectId: input.projectId,
          environmentId: input.environmentId,
          testCaseId: input.testCaseId ?? null,
          startPath: input.startPath,
          status: 'starting',
          createdAt: now,
        })
        .returning()
        .get();
    },
    { behavior: 'immediate' },
  );
}

export function getRecording(db: FlowDb, id: string): RecordingRow {
  const row = db.select().from(recordingSessions).where(eq(recordingSessions.id, id)).get();
  if (!row) throw notFound('Recording', id);
  return row;
}

/** Events in recorded order (sequence, never timestamps). */
export function listRecordingEvents(db: FlowDb, sessionId: string): RecordedEvent[] {
  return db
    .select({ payload: recordingEvents.payload })
    .from(recordingEvents)
    .where(eq(recordingEvents.sessionId, sessionId))
    .orderBy(asc(recordingEvents.sequence))
    .all()
    .map((r) => r.payload);
}

export function countRecordingEvents(db: FlowDb, sessionId: string): number {
  return db.select({ n: count() }).from(recordingEvents).where(eq(recordingEvents.sessionId, sessionId)).get()?.n ?? 0;
}

/** Runner side: takes the oldest recording waiting to be started. */
export function claimRecording(db: FlowDb, workerId: string, now = Date.now()): RecordingRow | null {
  return db.transaction(
    (tx) => {
      const next = tx
        .select({ id: recordingSessions.id })
        .from(recordingSessions)
        .where(eq(recordingSessions.status, 'starting'))
        .orderBy(asc(recordingSessions.createdAt))
        .limit(1)
        .get();
      if (!next) return null;
      return (
        tx
          .update(recordingSessions)
          .set({ status: 'recording', workerId, heartbeatAt: now })
          .where(and(eq(recordingSessions.id, next.id), eq(recordingSessions.status, 'starting')))
          .returning()
          .get() ?? null
      );
    },
    { behavior: 'immediate' },
  );
}

export type AppendResult = { duplicate: false; eventId: string; sequence: number } | { duplicate: true; eventId: string };

/**
 * Runner side: stores one event. eventId and sequence (lastSequence + 1) are assigned in the same
 * transaction; an event whose clientEventId was already stored is a duplicate (DUPLICATE_EVENT)
 * and returns the existing eventId instead of creating a second step.
 */
export function appendRecordingEvent(db: FlowDb, sessionId: string, event: RecordedEvent, now = Date.now()): AppendResult {
  return db.transaction(
    (tx) => {
      const session = getRecording(tx as unknown as FlowDb, sessionId);
      if (session.status !== 'recording' && session.status !== 'stopping') {
        throw new RepoError('VALIDATION_ERROR', `Recording is already ${session.status}`);
      }
      const clientEventId = 'clientEventId' in event ? event.clientEventId : null;
      if (clientEventId !== null) {
        const existing = tx
          .select({ eventId: recordingEvents.eventId })
          .from(recordingEvents)
          .where(and(eq(recordingEvents.sessionId, sessionId), eq(recordingEvents.clientEventId, clientEventId)))
          .get();
        if (existing) return { duplicate: true, eventId: existing.eventId };
      }
      const sequence = session.lastSequence + 1;
      const eventId = newId(now);
      tx.insert(recordingEvents).values({ eventId, sessionId, clientEventId, sequence, payload: event, receivedAt: now }).run();
      tx.update(recordingSessions).set({ lastSequence: sequence }).where(eq(recordingSessions.id, sessionId)).run();
      return { duplicate: false, eventId, sequence };
    },
    { behavior: 'immediate' },
  );
}

/** Runner side: keeps the recording and its lock alive; returns the row with any stop request. */
export function heartbeatRecording(db: FlowDb, id: string, now = Date.now()): RecordingRow {
  return db.transaction(
    (tx) => {
      tx.update(recordingSessions).set({ heartbeatAt: now }).where(eq(recordingSessions.id, id)).run();
      tx.update(executionLock).set({ heartbeatAt: now }).where(eq(executionLock.holderId, id)).run();
      return getRecording(tx as unknown as FlowDb, id);
    },
    { behavior: 'immediate' },
  );
}

export function markRecordingStopping(db: FlowDb, id: string): void {
  db.update(recordingSessions)
    .set({ status: 'stopping' })
    .where(and(eq(recordingSessions.id, id), eq(recordingSessions.status, 'recording')))
    .run();
}

/** Final state; always releases the execution lock. Recorded events are kept either way. */
export function finishRecording(db: FlowDb, id: string, status: 'stopped' | 'failed', error: string | null = null, now = Date.now()): void {
  db.transaction(
    (tx) => {
      tx.update(recordingSessions)
        .set({ status, error, finishedAt: now })
        .where(and(eq(recordingSessions.id, id), inArray(recordingSessions.status, RECORDING_ACTIVE)))
        .run();
      tx.delete(executionLock).where(eq(executionLock.holderId, id)).run();
    },
    { behavior: 'immediate' },
  );
}

/** Idempotent stop: a recording that has not started is stopped at once; an open one is asked to stop. */
export function requestRecordingStop(db: FlowDb, id: string, now = Date.now()): RecordingRow {
  const row = getRecording(db, id);
  if (row.status === 'starting') {
    finishRecording(db, id, 'stopped', null, now);
  } else if (row.status === 'recording') {
    db.update(recordingSessions)
      .set({ stopRequestedAt: row.stopRequestedAt ?? now })
      .where(eq(recordingSessions.id, id))
      .run();
  }
  return getRecording(db, id);
}

/**
 * Recordings whose runner is gone (or that no runner picked up in time) are marked failed and
 * release the lock. Their events stay, so the draft is not lost.
 */
export function failOrphanedRecordings(db: FlowDb, isWorkerAlive: (workerId: string) => boolean, now = Date.now()): string[] {
  const active = db.select().from(recordingSessions).where(inArray(recordingSessions.status, RECORDING_ACTIVE)).all();
  const failed: string[] = [];
  for (const row of active) {
    const unclaimed = row.status === 'starting' && now - row.createdAt > CAPTURE_CLAIM_TIMEOUT_MS;
    const dead =
      row.status !== 'starting' &&
      (row.workerId === null || !isWorkerAlive(row.workerId) || row.heartbeatAt === null || now - row.heartbeatAt > HEARTBEAT_STALE_MS);
    if (unclaimed || dead) {
      finishRecording(
        db,
        row.id,
        'failed',
        unclaimed ? 'No runner picked up the recording (is FlowCheck started with "pnpm start"?)' : 'The runner stopped while recording',
        now,
      );
      failed.push(row.id);
    }
  }
  return failed;
}
