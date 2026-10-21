import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createEnvironment,
  createProject,
  createRun,
  createTestCase,
  type DatabaseHandle,
  getArtifacts,
  insertArtifact,
  openDatabase,
  pruneArtifacts,
} from '../src/index.ts';

let dir: string;
let handle: DatabaseHandle;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'flowcheck-retention-'));
  handle = openDatabase(join(dir, 'test.db'));
});
afterEach(() => {
  handle.close();
  rmSync(dir, { recursive: true, force: true });
});

const DAY = 86_400_000;
const MB = 1024 * 1024;
const policy = { maxAgeMs: 30 * DAY, projectQuotaBytes: 500 * MB };

function seedRun(status: string) {
  const { db } = handle;
  const project = createProject(db, { name: `P${Math.random()}`, description: '' });
  const env = createEnvironment(db, project.id, {
    name: 'E',
    kind: 'local',
    frontendBaseUrl: 'http://127.0.0.1:4320',
    apiBaseUrl: 'http://127.0.0.1:4320/api',
    allowedOrigins: [],
    allowPrivateNetwork: true,
    enabled: true,
  });
  const { testCase, revision } = createTestCase(db, project.id, { name: 'T', description: '' }, { schemaVersion: 1, definition: {} });
  const run = createRun(db, {
    testCaseId: testCase.id,
    revisionId: revision.id,
    environmentId: env.id,
    environmentSnapshot: {} as never,
    inputsSnapshot: {},
  });
  handle.sqlite.prepare('update test_runs set status = ? where id = ?').run(status, run.id);
  return run.id;
}
const shot = (runId: string, size: number, createdAt: number) =>
  insertArtifact(
    handle.db,
    {
      runId,
      stepRunId: null,
      type: 'screenshot',
      relativePath: `p/${runId}/${createdAt}.png`,
      mimeType: 'image/png',
      size,
      sensitive: true,
    },
    createdAt,
  );

describe('pruneArtifacts', () => {
  it('removes artifacts older than the retention period, never those of an active run', () => {
    const now = Date.now();
    const finished = seedRun('failed');
    const running = seedRun('running');
    const old = shot(finished, 1000, now - 31 * DAY);
    const fresh = shot(finished, 1000, now - 1 * DAY);
    const oldButActive = shot(running, 1000, now - 31 * DAY);

    const pruned = pruneArtifacts(handle.db, policy, now);
    expect(pruned).toEqual([{ id: old.id, relativePath: old.relativePath, size: 1000, reason: 'age' }]);
    expect(getArtifacts(handle.db, finished).map((a) => a.id)).toEqual([fresh.id]);
    expect(getArtifacts(handle.db, running).map((a) => a.id)).toEqual([oldButActive.id]);
  });

  it('keeps each project under its quota by removing its oldest finished artifacts first', () => {
    const now = Date.now();
    const runId = seedRun('passed');
    const a = shot(runId, 200 * MB, now - 3 * DAY);
    const b = shot(runId, 200 * MB, now - 2 * DAY);
    const c = shot(runId, 200 * MB, now - 1 * DAY);
    const otherProject = shot(seedRun('passed'), 400 * MB, now - 5 * DAY);

    const pruned = pruneArtifacts(handle.db, policy, now);
    expect(pruned.map((p) => [p.id, p.reason])).toEqual([[a.id, 'quota']]);
    expect(getArtifacts(handle.db, runId).map((x) => x.id)).toEqual([b.id, c.id]);
    expect(pruneArtifacts(handle.db, policy, now)).toEqual([]);
    expect(otherProject).toBeDefined();
  });
});
