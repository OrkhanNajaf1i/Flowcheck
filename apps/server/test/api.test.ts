import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type DatabaseHandle, openDatabase } from '@flowcheck/db';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';

let dir: string;
let handle: DatabaseHandle;
let app: FastifyInstance;

const HOST = '127.0.0.1:4310';
const ORIGIN = 'http://127.0.0.1:4310';

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'flowcheck-server-'));
  const config = loadConfig({ FLOWCHECK_DATA_DIR: dir });
  handle = openDatabase(config.dbFile);
  app = await buildServer(handle.db, config);
});

afterEach(async () => {
  await app.close();
  handle.close();
  rmSync(dir, { recursive: true, force: true });
});

function call(method: InjectOptions['method'], url: string, payload?: unknown, headers: Record<string, string> = {}) {
  return app.inject({
    method,
    url,
    headers: { host: HOST, ...(method === 'GET' ? {} : { origin: ORIGIN }), ...headers },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}

const definition = {
  schemaVersion: 1,
  metadata: { tags: [] },
  inputs: [{ name: 'email', type: 'string', required: true }],
  setupSteps: [],
  steps: [{ id: 'open', name: 'Open', type: 'navigate', url: '/' }],
  cleanupSteps: [],
};

async function seed() {
  const project = (await call('POST', '/api/projects', { name: 'Shop' })).json();
  const env = (
    await call('POST', `/api/projects/${project.id}/environments`, {
      name: 'Local',
      kind: 'local',
      frontendBaseUrl: 'http://127.0.0.1:4320',
      apiBaseUrl: 'http://127.0.0.1:4320/api',
      allowPrivateNetwork: true,
    })
  ).json();
  const created = (await call('POST', `/api/projects/${project.id}/test-cases`, { name: 'Order', definition })).json();
  return { project, env, testCase: created.testCase, revision: created.revision };
}

describe('local security', () => {
  it('rejects unknown Host headers (DNS rebinding)', async () => {
    const res = await call('GET', '/api/projects', undefined, { host: 'evil.example:4310' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('HOST_NOT_ALLOWED');
  });

  it('rejects state-changing requests from foreign or missing origins', async () => {
    const foreign = await call('POST', '/api/projects', { name: 'x' }, { origin: 'http://evil.example' });
    expect(foreign.json().error.code).toBe('FORBIDDEN_ORIGIN');
    const missing = await app.inject({ method: 'POST', url: '/api/projects', headers: { host: HOST }, payload: { name: 'x' } });
    expect(missing.json().error.code).toBe('FORBIDDEN_ORIGIN');
  });

  it('never sends CORS headers', async () => {
    const res = await call('GET', '/api/projects', undefined, { origin: 'http://evil.example' });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('errors', () => {
  it('use the standard format with field-level issues', async () => {
    const res = await call('POST', '/api/projects', { name: '' });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details.issues[0].path).toEqual(['name']);
  });

  it('reports invalid definitions with paths', async () => {
    const { project } = await seed();
    const res = await call('POST', `/api/projects/${project.id}/test-cases`, {
      name: 'Bad',
      definition: { ...definition, steps: [{ id: 'x', name: 'x', type: 'evaluate', code: 'alert(1)' }] },
    });
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(res.json().error.details.issues[0].path[0]).toBe('definition');
  });

  it('reports unknown schema versions explicitly', async () => {
    const { project } = await seed();
    const res = await call('POST', `/api/projects/${project.id}/test-cases`, {
      name: 'Future',
      definition: { ...definition, schemaVersion: 99 },
    });
    expect(res.json().error.code).toBe('UNSUPPORTED_SCHEMA_VERSION');
  });

  it('returns NOT_FOUND for unknown resources and routes', async () => {
    expect((await call('GET', '/api/projects/nope')).json().error.code).toBe('NOT_FOUND');
    expect((await call('GET', '/api/nothing')).json().error.code).toBe('NOT_FOUND');
  });
});

describe('runs', () => {
  it('require declared inputs with exact types', async () => {
    const { env, testCase } = await seed();
    const missing = await call('POST', `/api/test-cases/${testCase.id}/runs`, { environmentId: env.id });
    expect(missing.json().error.code).toBe('VALIDATION_ERROR');
    expect(missing.json().error.details.issues[0].path).toEqual(['inputs', 'email']);
    const wrongType = await call('POST', `/api/test-cases/${testCase.id}/runs`, { environmentId: env.id, inputs: { email: 1 } });
    expect(wrongType.statusCode).toBe(400);
  });

  it('are created as queued with 202 and keep their snapshot', async () => {
    const { env, testCase, revision } = await seed();
    const res = await call('POST', `/api/test-cases/${testCase.id}/runs`, { environmentId: env.id, inputs: { email: 'qa@example.test' } });
    expect(res.statusCode).toBe(202);
    const { runId } = res.json();

    await call('PATCH', `/api/environments/${env.id}`, { frontendBaseUrl: 'http://127.0.0.1:9999' });
    await call('POST', `/api/test-cases/${testCase.id}/revisions`, { baseRevisionId: revision.id, definition });

    const run = (await call('GET', `/api/runs/${runId}`)).json();
    expect(run.status).toBe('queued');
    expect(run.environment.frontendBaseUrl).toBe('http://127.0.0.1:4320');
    expect(run.revisionId).toBe(revision.id);
    expect(run.revisionNumber).toBe(1);
  });

  it('refuse disabled environments', async () => {
    const { env, testCase } = await seed();
    await call('PATCH', `/api/environments/${env.id}`, { enabled: false });
    const res = await call('POST', `/api/test-cases/${testCase.id}/runs`, { environmentId: env.id, inputs: { email: 'a@b.c' } });
    expect(res.json().error.code).toBe('ENVIRONMENT_DISABLED');
  });

  it('cancel is idempotent', async () => {
    const { env, testCase } = await seed();
    const { runId } = (
      await call('POST', `/api/test-cases/${testCase.id}/runs`, { environmentId: env.id, inputs: { email: 'a@b.c' } })
    ).json();
    expect((await call('POST', `/api/runs/${runId}/cancel`)).json().status).toBe('cancelled');
    expect((await call('POST', `/api/runs/${runId}/cancel`)).json().status).toBe('cancelled');
  });

  it('archiving keeps run history', async () => {
    const { env, testCase } = await seed();
    const { runId } = (
      await call('POST', `/api/test-cases/${testCase.id}/runs`, { environmentId: env.id, inputs: { email: 'a@b.c' } })
    ).json();
    await call('POST', `/api/test-cases/${testCase.id}/archive`);
    expect((await call('GET', `/api/runs/${runId}`)).statusCode).toBe(200);
    expect((await call('GET', `/api/test-cases/${testCase.id}/runs`)).json()).toHaveLength(1);
  });

  it('stale revision saves conflict', async () => {
    const { testCase, revision } = await seed();
    await call('POST', `/api/test-cases/${testCase.id}/revisions`, { baseRevisionId: revision.id, definition });
    const res = await call('POST', `/api/test-cases/${testCase.id}/revisions`, { baseRevisionId: revision.id, definition });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('REVISION_CONFLICT');
  });
});

describe('project deletion', () => {
  it('deletes the project and its artifact files, and is refused while a run is active', async () => {
    const { project, env, testCase } = await seed();
    const { runId } = (
      await call('POST', `/api/test-cases/${testCase.id}/runs`, { environmentId: env.id, inputs: { email: 'a@b.c' } })
    ).json();

    const busy = await call('DELETE', `/api/projects/${project.id}`);
    expect(busy.statusCode).toBe(409);
    expect(busy.json().error.code).toBe('PROJECT_HAS_ACTIVE_RUNS');

    await call('POST', `/api/runs/${runId}/cancel`);
    const artifactDir = join(dir, 'artifacts', project.id);
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(join(artifactDir, 'shot.png'), 'x');

    const res = await call('DELETE', `/api/projects/${project.id}`);
    expect(res.statusCode).toBe(204);
    expect((await call('GET', `/api/projects/${project.id}`)).statusCode).toBe(404);
    expect((await call('GET', `/api/runs/${runId}`)).statusCode).toBe(404);
    expect(existsSync(artifactDir)).toBe(false);
  });

  it('requires the FlowCheck origin like every other state change', async () => {
    const { project } = await seed();
    const res = await call('DELETE', `/api/projects/${project.id}`, undefined, { origin: 'http://evil.example' });
    expect(res.json().error.code).toBe('FORBIDDEN_ORIGIN');
  });
});
