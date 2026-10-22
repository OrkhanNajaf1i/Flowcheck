import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  createEnvironment,
  createProject,
  createRun,
  createTestCase,
  type DatabaseHandle,
  insertArtifact,
  openDatabase,
} from '@flowcheck/db';
import pino from 'pino';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { loadConfig, type ServerConfig } from '../src/config.ts';
import { runArtifactRetention } from '../src/retention.ts';

let dir: string;
let handle: DatabaseHandle;
let config: ServerConfig;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'flowcheck-server-retention-'));
  config = loadConfig({ FLOWCHECK_DATA_DIR: dir, FLOWCHECK_ARTIFACT_RETENTION_DAYS: '30' });
  handle = openDatabase(config.dbFile);
});
afterEach(() => {
  handle.close();
  rmSync(dir, { recursive: true, force: true });
});

it('deletes the rows and files of expired artifacts and keeps fresh ones', () => {
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
  const { testCase, revision } = createTestCase(db, project.id, { name: 'T', description: '' }, { schemaVersion: 1, definition: {} });
  const run = createRun(db, {
    testCaseId: testCase.id,
    revisionId: revision.id,
    environmentId: env.id,
    environmentSnapshot: {} as never,
    inputsSnapshot: {},
  });
  handle.sqlite.prepare("update test_runs set status = 'failed' where id = ?").run(run.id);
  const file = (name: string) => {
    const relativePath = join(project.id, run.id, name);
    mkdirSync(dirname(join(config.artifactsDir, relativePath)), { recursive: true });
    writeFileSync(join(config.artifactsDir, relativePath), 'png');
    return relativePath;
  };
  const now = Date.now();
  const old = { runId: run.id, stepRunId: null, type: 'screenshot', mimeType: 'image/png', size: 3, sensitive: true };
  insertArtifact(db, { ...old, relativePath: file('old.png') }, now - 31 * 86_400_000);
  insertArtifact(db, { ...old, relativePath: file('new.png') }, now);

  expect(runArtifactRetention(db, config, pino({ enabled: false }))).toBe(1);
  expect(existsSync(join(config.artifactsDir, project.id, run.id, 'old.png'))).toBe(false);
  expect(existsSync(join(config.artifactsDir, project.id, run.id, 'new.png'))).toBe(true);
});

it('rejects a retention setting that is not a positive number', () => {
  expect(() => loadConfig({ FLOWCHECK_ARTIFACT_QUOTA_MB: 'lots' })).toThrow(/positive number/);
});
