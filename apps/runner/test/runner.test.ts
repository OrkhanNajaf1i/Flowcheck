import { mkdtempSync, rmSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  claimNextRun,
  createEnvironment,
  createProject,
  createRun,
  createTestCase,
  type DatabaseHandle,
  getRun,
  openDatabase,
  updateEnvironment,
} from '@flowcheck/db';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { executeRun } from '../src/execute-run.ts';
import { isWorkerAlive } from '../src/worker-id.ts';

let dir: string;
let handle: DatabaseHandle;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'flowcheck-runner-'));
  handle = openDatabase(join(dir, 'flowcheck.db'));
});

afterEach(() => {
  handle.close();
  rmSync(dir, { recursive: true, force: true });
});

const validDefinition = {
  schemaVersion: 1,
  metadata: { tags: [] },
  inputs: [],
  setupSteps: [],
  steps: [{ id: 'open', name: 'Open', type: 'navigate', url: '/' }],
  cleanupSteps: [],
};

/** Inserts a run directly so the runner can be tested with definitions the API would refuse. */
function queueRun(definition: unknown, schemaVersion = 1) {
  const { db } = handle;
  const project = createProject(db, { name: 'P', description: '' });
  const env = createEnvironment(db, project.id, {
    name: 'E',
    kind: 'local',
    frontendBaseUrl: 'http://127.0.0.1:1',
    apiBaseUrl: 'http://127.0.0.1:1',
    allowedOrigins: [],
    allowPrivateNetwork: true,
    enabled: true,
  });
  const { testCase, revision } = createTestCase(db, project.id, { name: 'T', description: '' }, { schemaVersion, definition });
  createRun(db, {
    testCaseId: testCase.id,
    revisionId: revision.id,
    environmentId: env.id,
    environmentSnapshot: {
      id: env.id,
      name: 'E',
      kind: 'local',
      frontendBaseUrl: env.frontendBaseUrl,
      apiBaseUrl: env.apiBaseUrl,
      allowedOrigins: [],
      allowPrivateNetwork: true,
    },
    inputsSnapshot: {},
  });
  const run = claimNextRun(db, 'test-worker');
  if (!run) throw new Error('claim failed');
  return { run, env };
}

const deps = () => ({
  db: handle.db,
  config: loadConfig({ FLOWCHECK_DATA_DIR: dir }),
  log: pino({ level: 'silent' }),
  shutdown: new AbortController().signal,
});

describe('executeRun', () => {
  it('ends a run with an unknown schemaVersion as error, without migrating it', async () => {
    const { run } = queueRun({ ...validDefinition, schemaVersion: 7 }, 7);
    expect(await executeRun(run, deps())).toBe('error');
    expect(getRun(handle.db, run.id).failureSummary?.code).toBe('UNSUPPORTED_SCHEMA_VERSION');
  });

  it('refuses to start when the environment was disabled after queueing', async () => {
    const { run, env } = queueRun(validDefinition);
    updateEnvironment(handle.db, env.id, { enabled: false });
    expect(await executeRun(run, deps())).toBe('error');
    expect(getRun(handle.db, run.id).failureSummary?.code).toBe('ENVIRONMENT_DISABLED');
  });

  it('releases the execution lock when it finishes', async () => {
    const { run } = queueRun({ ...validDefinition, schemaVersion: 7 }, 7);
    await executeRun(run, deps());
    expect(handle.sqlite.prepare('select count(*) as n from execution_lock').get()).toEqual({ n: 0 });
  });
});

describe('isWorkerAlive', () => {
  const self = `${hostname()}:${process.pid}:aaaa`;
  const missing = () => {
    throw Object.assign(new Error('no such process'), { code: 'ESRCH' });
  };

  it('treats itself as alive and an earlier incarnation with the same pid as dead', () => {
    expect(isWorkerAlive(self, self)).toBe(true);
    expect(isWorkerAlive(`${hostname()}:${process.pid}:bbbb`, self)).toBe(false);
  });

  it('probes other local processes', () => {
    expect(isWorkerAlive(`${hostname()}:999999:x`, self, missing)).toBe(false);
    expect(isWorkerAlive(`${hostname()}:4242:x`, self, () => undefined)).toBe(true);
  });

  it('assumes workers on other hosts are alive', () => {
    expect(isWorkerAlive('other-host:1:x', self, missing)).toBe(true);
  });
});
