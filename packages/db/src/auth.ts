import { and, asc, eq, inArray } from 'drizzle-orm';
import { getEnvironment } from './catalog.ts';
import type { FlowDb } from './client.ts';
import { notFound, RepoError } from './errors.ts';
import { newId } from './ids.ts';
import { HEARTBEAT_STALE_MS } from './runs.ts';
import { type AuthCaptureStatus, authCaptureSessions, authProfiles, executionLock } from './schema.ts';
import { decryptSecret, encryptSecret, type MasterKey } from './secret-box.ts';

export type AuthProfileRow = Omit<typeof authProfiles.$inferSelect, 'encryptedStorageState'>;
export type AuthCaptureRow = typeof authCaptureSessions.$inferSelect;

const ACTIVE: AuthCaptureStatus[] = ['starting', 'waiting_for_login', 'saving'];
/** A capture nobody picked up (runner not running) is given up after this. */
export const CAPTURE_CLAIM_TIMEOUT_MS = 60_000;
/** Longest time a capture may stay open waiting for the tester. */
export const CAPTURE_MAX_MS = 15 * 60_000;

const profileOwner = (environmentId: string, name: string) => `auth:${environmentId}:${name}`;
const withoutState = ({ encryptedStorageState: _omit, ...rest }: typeof authProfiles.$inferSelect): AuthProfileRow => rest;

// ---- Profiles ----

export function listAuthProfiles(db: FlowDb, projectId: string): AuthProfileRow[] {
  return db
    .select()
    .from(authProfiles)
    .where(eq(authProfiles.projectId, projectId))
    .orderBy(asc(authProfiles.name))
    .all()
    .map(withoutState);
}

export function getAuthProfile(db: FlowDb, id: string): AuthProfileRow {
  const row = db.select().from(authProfiles).where(eq(authProfiles.id, id)).get();
  if (!row) throw notFound('Login session', id);
  return withoutState(row);
}

export function deleteAuthProfile(db: FlowDb, id: string): void {
  if (db.delete(authProfiles).where(eq(authProfiles.id, id)).run().changes === 0) throw notFound('Login session', id);
}

/** Stores (or replaces, by environment + name) a captured storage state, encrypted. */
export function saveAuthProfile(
  db: FlowDb,
  master: MasterKey,
  input: { projectId: string; environmentId: string; name: string; storageState: unknown },
  now = Date.now(),
): AuthProfileRow {
  const sealed = encryptSecret(master, profileOwner(input.environmentId, input.name), JSON.stringify(input.storageState));
  const existing = db
    .select({ id: authProfiles.id })
    .from(authProfiles)
    .where(and(eq(authProfiles.environmentId, input.environmentId), eq(authProfiles.name, input.name)))
    .get();
  if (existing) {
    const row = db
      .update(authProfiles)
      .set({ encryptedStorageState: sealed, updatedAt: now })
      .where(eq(authProfiles.id, existing.id))
      .returning()
      .get() as typeof authProfiles.$inferSelect;
    return withoutState(row);
  }
  return withoutState(
    db
      .insert(authProfiles)
      .values({
        id: newId(now),
        projectId: input.projectId,
        environmentId: input.environmentId,
        name: input.name,
        encryptedStorageState: sealed,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get(),
  );
}

/** Decrypted storage state for a run. Never returned by the API. */
export function revealAuthProfile(db: FlowDb, master: MasterKey, id: string): { profile: AuthProfileRow; storageState: unknown } {
  const row = db.select().from(authProfiles).where(eq(authProfiles.id, id)).get();
  if (!row) throw notFound('Login session', id);
  const json = decryptSecret(master, profileOwner(row.environmentId, row.name), row.encryptedStorageState);
  return { profile: withoutState(row), storageState: JSON.parse(json) };
}

// ---- Capture sessions ----

/** Starts a capture and takes the execution lock in one transaction (runs, recorder and captures share it). */
export function createAuthCapture(
  db: FlowDb,
  input: { projectId: string; environmentId: string; profileName: string; startPath: string },
  now = Date.now(),
): AuthCaptureRow {
  return db.transaction(
    (tx) => {
      const env = getEnvironment(tx as unknown as FlowDb, input.environmentId);
      if (env.projectId !== input.projectId) throw notFound('Environment', input.environmentId);
      if (!env.enabled) throw new RepoError('ENVIRONMENT_DISABLED', `Environment "${env.name}" is disabled`);
      const lock = tx.select().from(executionLock).get();
      if (lock) {
        throw new RepoError(
          'EXECUTION_LOCK_BUSY',
          `FlowCheck is busy (${lock.holderKind === 'run' ? 'a test is running' : 'another login session is being created'}). Try again when it has finished.`,
          {
            holderKind: lock.holderKind,
          },
        );
      }
      const row = tx
        .insert(authCaptureSessions)
        .values({ id: newId(now), ...input, status: 'starting', createdAt: now })
        .returning()
        .get();
      tx.insert(executionLock).values({ id: 1, holderKind: 'auth_capture', holderId: row.id, acquiredAt: now, heartbeatAt: now }).run();
      return row;
    },
    { behavior: 'immediate' },
  );
}

export function getAuthCapture(db: FlowDb, id: string): AuthCaptureRow {
  const row = db.select().from(authCaptureSessions).where(eq(authCaptureSessions.id, id)).get();
  if (!row) throw notFound('Login session capture', id);
  return row;
}

/** Runner side: takes the oldest capture that is waiting to be started. */
export function claimAuthCapture(db: FlowDb, workerId: string, now = Date.now()): AuthCaptureRow | null {
  return db.transaction(
    (tx) => {
      const next = tx
        .select({ id: authCaptureSessions.id })
        .from(authCaptureSessions)
        .where(eq(authCaptureSessions.status, 'starting'))
        .orderBy(asc(authCaptureSessions.createdAt))
        .limit(1)
        .get();
      if (!next) return null;
      return (
        tx
          .update(authCaptureSessions)
          .set({ status: 'waiting_for_login', workerId, heartbeatAt: now })
          .where(and(eq(authCaptureSessions.id, next.id), eq(authCaptureSessions.status, 'starting')))
          .returning()
          .get() ?? null
      );
    },
    { behavior: 'immediate' },
  );
}

/** Runner side: keeps the capture and its lock alive and reports what the tester asked for. */
export function heartbeatAuthCapture(db: FlowDb, id: string, now = Date.now()): AuthCaptureRow {
  return db.transaction(
    (tx) => {
      tx.update(authCaptureSessions).set({ heartbeatAt: now }).where(eq(authCaptureSessions.id, id)).run();
      tx.update(executionLock).set({ heartbeatAt: now }).where(eq(executionLock.holderId, id)).run();
      return getAuthCapture(tx as unknown as FlowDb, id);
    },
    { behavior: 'immediate' },
  );
}

export function markAuthCaptureSaving(db: FlowDb, id: string): void {
  db.update(authCaptureSessions).set({ status: 'saving' }).where(eq(authCaptureSessions.id, id)).run();
}

/** Final state; always releases the execution lock. */
export function finishAuthCapture(
  db: FlowDb,
  id: string,
  status: 'saved' | 'failed' | 'cancelled',
  extra: { error?: string; authProfileId?: string } = {},
  now = Date.now(),
): void {
  db.transaction(
    (tx) => {
      tx.update(authCaptureSessions)
        .set({ status, finishedAt: now, error: extra.error ?? null, authProfileId: extra.authProfileId ?? null })
        .where(and(eq(authCaptureSessions.id, id), inArray(authCaptureSessions.status, ACTIVE)))
        .run();
      tx.delete(executionLock).where(eq(executionLock.holderId, id)).run();
    },
    { behavior: 'immediate' },
  );
}

/** Tester side: "Save session" is accepted only while the browser waits for the login. */
export function requestAuthCaptureSave(db: FlowDb, id: string, now = Date.now()): AuthCaptureRow {
  const row = getAuthCapture(db, id);
  if (row.status === 'saving' || row.status === 'saved') return row;
  if (row.status !== 'waiting_for_login') {
    throw new RepoError(
      'VALIDATION_ERROR',
      row.status === 'starting' ? 'The browser has not opened yet' : `This capture is already ${row.status}`,
    );
  }
  db.update(authCaptureSessions)
    .set({ saveRequestedAt: row.saveRequestedAt ?? now })
    .where(eq(authCaptureSessions.id, id))
    .run();
  return getAuthCapture(db, id);
}

/** Idempotent cancel: a capture that has not started is cancelled at once; an open one is asked to close. */
export function requestAuthCaptureCancel(db: FlowDb, id: string, now = Date.now()): AuthCaptureRow {
  const row = getAuthCapture(db, id);
  if (row.status === 'starting') {
    finishAuthCapture(db, id, 'cancelled', {}, now);
  } else if (row.status === 'waiting_for_login' || row.status === 'saving') {
    db.update(authCaptureSessions)
      .set({ cancelRequestedAt: row.cancelRequestedAt ?? now })
      .where(eq(authCaptureSessions.id, id))
      .run();
  }
  return getAuthCapture(db, id);
}

/**
 * Captures whose runner is gone (or that no runner picked up in time) are marked failed and
 * their lock is released, so runs are never blocked forever.
 */
export function failOrphanedAuthCaptures(db: FlowDb, isWorkerAlive: (workerId: string) => boolean, now = Date.now()): string[] {
  const active = db.select().from(authCaptureSessions).where(inArray(authCaptureSessions.status, ACTIVE)).all();
  const failed: string[] = [];
  for (const row of active) {
    const unclaimed = row.status === 'starting' && now - row.createdAt > CAPTURE_CLAIM_TIMEOUT_MS;
    const dead =
      row.status !== 'starting' &&
      (row.workerId === null || !isWorkerAlive(row.workerId) || row.heartbeatAt === null || now - row.heartbeatAt > HEARTBEAT_STALE_MS);
    if (unclaimed || dead) {
      finishAuthCapture(
        db,
        row.id,
        'failed',
        {
          error: unclaimed
            ? 'No runner picked up the capture (is FlowCheck started with "pnpm start"?)'
            : 'The runner stopped while the browser was open',
        },
        now,
      );
      failed.push(row.id);
    }
  }
  return failed;
}
