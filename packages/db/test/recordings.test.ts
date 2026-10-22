import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RecordedEvent } from '@flowcheck/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendRecordingEvent,
  claimRecording,
  createAuthCapture,
  createEnvironment,
  createProject,
  createRecording,
  type DatabaseHandle,
  deleteProject,
  failOrphanedRecordings,
  finishRecording,
  getRecording,
  listRecordingEvents,
  openDatabase,
  requestRecordingStop,
} from '../src/index.ts';

let dir: string;
let handle: DatabaseHandle;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'flowcheck-rec-'));
  handle = openDatabase(join(dir, 'test.db'));
});
afterEach(() => {
  handle.close();
  rmSync(dir, { recursive: true, force: true });
});

function seed() {
  const project = createProject(handle.db, { name: 'P', description: '' });
  const env = createEnvironment(handle.db, project.id, {
    name: 'E',
    kind: 'local',
    frontendBaseUrl: 'http://127.0.0.1:4320',
    apiBaseUrl: 'http://127.0.0.1:4320/api',
    allowedOrigins: [],
    allowPrivateNetwork: true,
    enabled: true,
  });
  const recording = createRecording(handle.db, { projectId: project.id, environmentId: env.id, startPath: '/form' });
  return { project, env, recording };
}
const lockCount = () => (handle.sqlite.prepare('select count(*) as n from execution_lock').get() as { n: number }).n;
const click = (clientEventId: string): RecordedEvent => ({
  kind: 'click',
  clientEventId,
  locator: { kind: 'role', role: 'button', name: 'Save' },
  fragile: false,
});
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('recordings', () => {
  it('share the execution lock with captures and runs', () => {
    const { project, env, recording } = seed();
    expect(lockCount()).toBe(1);
    expect(() => createAuthCapture(handle.db, { projectId: project.id, environmentId: env.id, profileName: 'x', startPath: '/' })).toThrow(
      expect.objectContaining({ code: 'EXECUTION_LOCK_BUSY', message: expect.stringContaining('recording') }),
    );
    claimRecording(handle.db, 'w');
    finishRecording(handle.db, recording.id, 'stopped');
    expect(lockCount()).toBe(0);
  });

  it('assign sequence in receipt order and reject a re-sent event as a duplicate', () => {
    const { recording } = seed();
    expect(() => appendRecordingEvent(handle.db, recording.id, click(uuid(1)))).toThrow(/starting/);
    claimRecording(handle.db, 'w');
    const first = appendRecordingEvent(handle.db, recording.id, click(uuid(1)));
    const nav = appendRecordingEvent(handle.db, recording.id, { kind: 'navigate', url: '/done' });
    const again = appendRecordingEvent(handle.db, recording.id, click(uuid(1)));
    expect(first).toMatchObject({ duplicate: false, sequence: 1 });
    expect(nav).toMatchObject({ duplicate: false, sequence: 2 });
    expect(again).toEqual({ duplicate: true, eventId: first.eventId });
    expect(listRecordingEvents(handle.db, recording.id).map((e) => e.kind)).toEqual(['click', 'navigate']);
    expect(getRecording(handle.db, recording.id).lastSequence).toBe(2);
  });

  it('stop is idempotent; a stopped recording keeps its events and accepts no more', () => {
    const { recording } = seed();
    claimRecording(handle.db, 'w');
    appendRecordingEvent(handle.db, recording.id, click(uuid(1)));
    expect(requestRecordingStop(handle.db, recording.id).stopRequestedAt).not.toBeNull();
    finishRecording(handle.db, recording.id, 'stopped');
    expect(requestRecordingStop(handle.db, recording.id).status).toBe('stopped');
    expect(() => appendRecordingEvent(handle.db, recording.id, click(uuid(2)))).toThrow(/stopped/);
    expect(listRecordingEvents(handle.db, recording.id)).toHaveLength(1);
  });

  it('a recording nobody started is stopped at once; orphans fail and unlock but keep events', () => {
    const { project, env, recording } = seed();
    expect(requestRecordingStop(handle.db, recording.id).status).toBe('stopped');
    expect(lockCount()).toBe(0);

    const open = createRecording(handle.db, { projectId: project.id, environmentId: env.id, startPath: '/' });
    claimRecording(handle.db, 'dead');
    appendRecordingEvent(handle.db, open.id, click(uuid(9)));
    expect(failOrphanedRecordings(handle.db, () => false)).toEqual([open.id]);
    expect(getRecording(handle.db, open.id)).toMatchObject({ status: 'failed', error: 'The runner stopped while recording' });
    expect(listRecordingEvents(handle.db, open.id)).toHaveLength(1);
    expect(lockCount()).toBe(0);
  });

  it('block project deletion while active and are deleted with the project', () => {
    const { project, recording } = seed();
    expect(() => deleteProject(handle.db, project.id)).toThrow(expect.objectContaining({ code: 'PROJECT_HAS_ACTIVE_RUNS' }));
    claimRecording(handle.db, 'w');
    appendRecordingEvent(handle.db, recording.id, click(uuid(1)));
    finishRecording(handle.db, recording.id, 'stopped');
    deleteProject(handle.db, project.id);
    expect((handle.sqlite.prepare('select count(*) as n from recording_events').get() as { n: number }).n).toBe(0);
  });
});
