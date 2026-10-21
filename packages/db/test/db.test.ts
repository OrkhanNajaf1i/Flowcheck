import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  claimNextRun,
  createEnvironment,
  createPendingSteps,
  createProject,
  createRevision,
  createRun,
  createTestCase,
  type DatabaseHandle,
  deleteProject,
  finishRun,
  getProject,
  getRun,
  getStepRuns,
  getTestCase,
  heartbeatRun,
  interruptOrphanedRuns,
  listTestCases,
  markStepRunning,
  openDatabase,
  requestCancel,
  updateEnvironment,
} from '../src/index.ts';

let dir: string;
let file: string;
let handle: DatabaseHandle;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'flowcheck-db-'));
  file = join(dir, 'test.db');
  handle = openDatabase(file);
});

afterEach(() => {
  handle.close();
  rmSync(dir, { recursive: true, force: true });
});

const definition = { schemaVersion: 1, steps: [] };

function seed(db = handle.db) {
  const project = createProject(db, { name: 'Shop', description: '' });
  const env = createEnvironment(db, project.id, {
    name: 'Local',
    kind: 'local',
    frontendBaseUrl: 'http://127.0.0.1:4320',
    apiBaseUrl: 'http://127.0.0.1:4320/api',
    allowedOrigins: [],
    allowPrivateNetwork: true,
    enabled: true,
  });
  const { testCase, revision } = createTestCase(db, project.id, { name: 'Order', description: '' }, { schemaVersion: 1, definition });
  const snapshot = {
    id: env.id,
    name: env.name,
    kind: env.kind,
    frontendBaseUrl: env.frontendBaseUrl,
    apiBaseUrl: env.apiBaseUrl,
    allowedOrigins: [],
    allowPrivateNetwork: true,
  };
  const enqueue = (now = Date.now()) =>
    createRun(
      db,
      { testCaseId: testCase.id, revisionId: revision.id, environmentId: env.id, environmentSnapshot: snapshot, inputsSnapshot: {} },
      now,
    );
  return { project, env, testCase, revision, enqueue };
}

describe('migrations', () => {
  it('are idempotent when a second process opens the same file', () => {
    const second = openDatabase(file);
    const tables = second.sqlite.prepare("select name from sqlite_master where type='table' order by name").all() as { name: string }[];
    second.close();
    expect(tables.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        'projects',
        'environments',
        'test_cases',
        'test_revisions',
        'test_runs',
        'step_runs',
        'artifacts',
        'execution_lock',
      ]),
    );
  });
});

describe('revisions', () => {
  it('cannot be updated, even with raw SQL', () => {
    const { revision } = seed();
    expect(() => handle.sqlite.prepare("update test_revisions set definition = '{}' where id = ?").run(revision.id)).toThrow(/immutable/);
  });

  it('every save creates a new revision and old runs keep theirs', () => {
    const { testCase, revision, enqueue } = seed();
    const run = enqueue();
    const second = createRevision(handle.db, testCase.id, revision.id, { schemaVersion: 1, definition: { changed: true } });
    expect(second.revisionNumber).toBe(2);
    expect(getTestCase(handle.db, testCase.id).currentRevisionId).toBe(second.id);
    expect(getRun(handle.db, run.id).revisionId).toBe(revision.id);
  });

  it('rejects a save based on a stale revision', () => {
    const { testCase, revision } = seed();
    createRevision(handle.db, testCase.id, revision.id, { schemaVersion: 1, definition });
    expect(() => createRevision(handle.db, testCase.id, revision.id, { schemaVersion: 1, definition })).toThrow(
      expect.objectContaining({ code: 'REVISION_CONFLICT' }),
    );
  });
});

describe('run snapshots', () => {
  it('are not affected by later environment edits and cannot be rewritten', () => {
    const { env, enqueue } = seed();
    const run = enqueue();
    updateEnvironment(handle.db, env.id, { frontendBaseUrl: 'http://127.0.0.1:9999' });
    expect(getRun(handle.db, run.id).environmentSnapshot.frontendBaseUrl).toBe('http://127.0.0.1:4320');
    expect(() => handle.sqlite.prepare("update test_runs set environment_snapshot = '{}' where id = ?").run(run.id)).toThrow(/immutable/);
  });
});

describe('queue', () => {
  it('claims in FIFO order and holds the execution lock', () => {
    const { enqueue } = seed();
    const first = enqueue(1000);
    enqueue(2000);
    const claimed = claimNextRun(handle.db, 'w1');
    expect(claimed?.id).toBe(first.id);
    expect(claimNextRun(handle.db, 'w1')).toBeNull();
  });

  it('never hands the same run to two concurrent workers', async () => {
    const { enqueue } = seed();
    for (let i = 0; i < 20; i++) enqueue(1000 + i);
    const workers = Array.from(
      { length: 4 },
      (_, i) =>
        new Promise<string[]>((resolve, reject) => {
          const worker = new Worker(new URL('./claim-worker.ts', import.meta.url), { workerData: { file, workerId: `w${i}` } });
          worker.once('message', resolve);
          worker.once('error', reject);
        }),
    );
    const claimed = (await Promise.all(workers)).flat();
    expect(claimed).toHaveLength(20);
    expect(new Set(claimed).size).toBe(20);
  }, 30_000);
});

describe('cancellation', () => {
  it('cancels queued runs immediately and is idempotent', () => {
    const { enqueue } = seed();
    const run = enqueue();
    expect(requestCancel(handle.db, run.id).status).toBe('cancelled');
    expect(requestCancel(handle.db, run.id).status).toBe('cancelled');
  });

  it('only requests cancellation for running runs; the runner sees it on heartbeat', () => {
    const { enqueue } = seed();
    const run = enqueue();
    claimNextRun(handle.db, 'w1');
    const after = requestCancel(handle.db, run.id);
    expect(after.status).toBe('running');
    expect(heartbeatRun(handle.db, run.id).cancellationRequestedAt).not.toBeNull();
  });
});

describe('restart recovery', () => {
  it('interrupts runs of dead workers with their unfinished steps, releases the lock, keeps queued runs', () => {
    const { enqueue, testCase } = seed();
    const run = enqueue(1000);
    const queued = enqueue(2000);
    claimNextRun(handle.db, 'dead-worker');
    createPendingSteps(handle.db, run.id, [
      { stepId: 'a', name: 'a', type: 'navigate', phase: 'main', order: 0 },
      { stepId: 'b', name: 'b', type: 'click', phase: 'main', order: 1 },
    ]);
    markStepRunning(handle.db, run.id, 0, Date.now());

    expect(interruptOrphanedRuns(handle.db, () => false)).toEqual([run.id]);
    const after = getRun(handle.db, run.id);
    expect(after.status).toBe('interrupted');
    expect(after.failureSummary?.code).toBe('PROCESS_INTERRUPTED');
    expect(getStepRuns(handle.db, run.id).map((s) => s.status)).toEqual(['interrupted', 'interrupted']);
    expect(getRun(handle.db, queued.id).status).toBe('queued');
    expect(claimNextRun(handle.db, 'new-worker')?.id).toBe(queued.id);
    expect(listTestCases(handle.db, testCase.projectId)[0]?.lastRun?.id).toBe(queued.id);
  });

  it('leaves runs of live workers alone', () => {
    const { enqueue } = seed();
    enqueue();
    claimNextRun(handle.db, 'alive');
    expect(interruptOrphanedRuns(handle.db, () => true)).toEqual([]);
  });
});

describe('project deletion', () => {
  it('removes the project with all dependent rows and leaves other projects intact', () => {
    const { project, enqueue } = seed();
    const other = seed();
    const run = enqueue();
    claimNextRun(handle.db, 'w1');
    finishRun(handle.db, run.id, 'passed', null);
    createPendingSteps(handle.db, run.id, [{ stepId: 'a', name: 'a', type: 'navigate', phase: 'main', order: 0 }]);

    deleteProject(handle.db, project.id);
    const count = (table: string) => (handle.sqlite.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;
    expect(() => getProject(handle.db, project.id)).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    expect(getProject(handle.db, other.project.id).id).toBe(other.project.id);
    expect(count('test_runs')).toBe(0);
    expect(count('step_runs')).toBe(0);
    expect(count('test_cases')).toBe(1);
    expect(count('environments')).toBe(1);
  });

  it('refuses while a run of the project is queued or running', () => {
    const { project, enqueue } = seed();
    enqueue();
    expect(() => deleteProject(handle.db, project.id)).toThrow(expect.objectContaining({ code: 'PROJECT_HAS_ACTIVE_RUNS' }));
    expect(getProject(handle.db, project.id).id).toBe(project.id);
  });
});
