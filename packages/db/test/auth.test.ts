import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  claimAuthCapture,
  claimNextRun,
  createAuthCapture,
  createEnvironment,
  createProject,
  createRun,
  createTestCase,
  type DatabaseHandle,
  deleteProject,
  failOrphanedAuthCaptures,
  finishAuthCapture,
  getAuthCapture,
  listAuthProfiles,
  loadMasterKey,
  openDatabase,
  requestAuthCaptureCancel,
  requestAuthCaptureSave,
  revealAuthProfile,
  saveAuthProfile,
} from '../src/index.ts';

let dir: string;
let handle: DatabaseHandle;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'flowcheck-auth-'));
  handle = openDatabase(join(dir, 'test.db'));
});
afterEach(() => {
  handle.close();
  rmSync(dir, { recursive: true, force: true });
});

function seed() {
  const { db } = handle;
  const project = createProject(db, { name: 'P', description: '' });
  const env = createEnvironment(db, project.id, {
    name: 'E',
    kind: 'local',
    frontendBaseUrl: 'http://127.0.0.1:4320',
    apiBaseUrl: 'http://127.0.0.1:4320/api',
    allowedOrigins: [],
    allowPrivateNetwork: true,
    enabled: true,
  });
  return { project, env };
}
const lockCount = () => (handle.sqlite.prepare('select count(*) as n from execution_lock').get() as { n: number }).n;

describe('auth capture sessions', () => {
  it('hold the execution lock: runs wait and a second capture is refused', () => {
    const { project, env } = seed();
    const capture = createAuthCapture(handle.db, { projectId: project.id, environmentId: env.id, profileName: 'qa', startPath: '/' });
    expect(lockCount()).toBe(1);
    expect(() => createAuthCapture(handle.db, { projectId: project.id, environmentId: env.id, profileName: 'x', startPath: '/' })).toThrow(
      expect.objectContaining({ code: 'EXECUTION_LOCK_BUSY' }),
    );
    const { testCase, revision } = createTestCase(
      handle.db,
      project.id,
      { name: 'T', description: '' },
      { schemaVersion: 1, definition: {} },
    );
    createRun(handle.db, {
      testCaseId: testCase.id,
      revisionId: revision.id,
      environmentId: env.id,
      environmentSnapshot: {} as never,
      inputsSnapshot: {},
    });
    expect(claimNextRun(handle.db, 'w')).toBeNull();

    expect(claimAuthCapture(handle.db, 'w')?.status).toBe('waiting_for_login');
    finishAuthCapture(handle.db, capture.id, 'saved');
    expect(lockCount()).toBe(0);
    expect(claimNextRun(handle.db, 'w')).not.toBeNull();
  });

  it('accept "save" only while waiting for the login; cancel is idempotent', () => {
    const { project, env } = seed();
    const capture = createAuthCapture(handle.db, { projectId: project.id, environmentId: env.id, profileName: 'qa', startPath: '/' });
    expect(() => requestAuthCaptureSave(handle.db, capture.id)).toThrow(/not opened yet/);
    claimAuthCapture(handle.db, 'w');
    expect(requestAuthCaptureSave(handle.db, capture.id).saveRequestedAt).not.toBeNull();
    expect(requestAuthCaptureCancel(handle.db, capture.id).cancelRequestedAt).not.toBeNull();
    finishAuthCapture(handle.db, capture.id, 'cancelled');
    expect(requestAuthCaptureCancel(handle.db, capture.id).status).toBe('cancelled');

    const second = createAuthCapture(handle.db, { projectId: project.id, environmentId: env.id, profileName: 'qa', startPath: '/' });
    expect(requestAuthCaptureCancel(handle.db, second.id).status).toBe('cancelled');
    expect(lockCount()).toBe(0);
  });

  it('are failed and unlocked when no runner picks them up or the runner died', () => {
    const { project, env } = seed();
    const t0 = Date.now();
    const unclaimed = createAuthCapture(handle.db, { projectId: project.id, environmentId: env.id, profileName: 'a', startPath: '/' }, t0);
    expect(failOrphanedAuthCaptures(handle.db, () => true, t0 + 61_000)).toEqual([unclaimed.id]);
    expect(getAuthCapture(handle.db, unclaimed.id).status).toBe('failed');
    expect(lockCount()).toBe(0);

    const open = createAuthCapture(handle.db, { projectId: project.id, environmentId: env.id, profileName: 'b', startPath: '/' });
    claimAuthCapture(handle.db, 'dead-worker');
    expect(failOrphanedAuthCaptures(handle.db, () => false)).toEqual([open.id]);
    expect(lockCount()).toBe(0);
  });
});

describe('auth profiles', () => {
  it('are stored encrypted, replaced by name and removed with the project', () => {
    const { project, env } = seed();
    const key = loadMasterKey(dir, {});
    const state = { cookies: [{ name: 'session', value: 'top-secret-cookie' }], origins: [] };
    const saved = saveAuthProfile(handle.db, key, { projectId: project.id, environmentId: env.id, name: 'qa', storageState: state });
    const raw = handle.sqlite.prepare('select encrypted_storage_state as s from auth_profiles').get() as { s: string };
    expect(raw.s).not.toContain('top-secret-cookie');
    expect(JSON.stringify(listAuthProfiles(handle.db, project.id))).not.toContain('top-secret-cookie');
    expect(revealAuthProfile(handle.db, key, saved.id).storageState).toEqual(state);

    const again = saveAuthProfile(handle.db, key, {
      projectId: project.id,
      environmentId: env.id,
      name: 'qa',
      storageState: { cookies: [], origins: [] },
    });
    expect(again.id).toBe(saved.id);
    expect(listAuthProfiles(handle.db, project.id)).toHaveLength(1);

    deleteProject(handle.db, project.id);
    expect((handle.sqlite.prepare('select count(*) as n from auth_profiles').get() as { n: number }).n).toBe(0);
  });
});
