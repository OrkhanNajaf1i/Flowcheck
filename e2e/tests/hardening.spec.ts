import { type ChildProcess, spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { RunDto } from '@flowcheck/shared';
import { expect, test } from '@playwright/test';
import { createProjectWithEnv, DEMO, definition, runTest } from './helpers.ts';

/** Acceptance criteria 23, 26 and 31 (PROJECT_RULES §20). */

const hits = async () => ((await (await fetch(`${DEMO}/__demo/hits`)).json()) as { hits: number }).hits;

test('a page with a service worker: the worker is blocked and the request check sees the real response (31)', async () => {
  const { projectId, envId } = await createProjectWithEnv();
  const run = await runTest(
    projectId,
    envId,
    definition([
      { id: 'open', name: 'Open', type: 'navigate', url: '/sw' },
      {
        id: 'add',
        name: 'Add mug',
        type: 'click',
        locator: { kind: 'testId', value: 'add-mug' },
        networkChecks: [
          {
            id: 'cart',
            name: 'Cart request',
            match: { origin: 'frontend', method: 'POST', pathname: '/api/cart/items' },
            // The service worker would answer 200 {fromServiceWorker: true}; the server answers 201 with items.
            assertions: [
              { kind: 'statusEquals', expected: 201 },
              { kind: 'jsonExists', pointer: '/items' },
            ],
          },
        ],
      },
      {
        id: 'result',
        name: 'Result',
        type: 'assertText',
        locator: { kind: 'testId', value: 'result' },
        expected: 'Status 201',
        mode: 'exact',
      },
    ]),
  );
  expect(run.status, JSON.stringify(run.steps)).toBe('passed');
});

test('redirects never lead to an origin outside the allowlist, for API and browser steps (26)', async () => {
  await fetch(`${DEMO}/__demo/reset`, { method: 'POST' });
  const { projectId, envId } = await createProjectWithEnv();

  const api = await runTest(
    projectId,
    envId,
    definition([
      {
        id: 'api',
        name: 'API redirect',
        type: 'apiRequest',
        method: 'GET',
        path: '/redirect-away',
        assertions: [{ kind: 'statusEquals', expected: 302 }],
      },
    ]),
  );
  // The redirect is reported, not followed.
  expect(api.status, JSON.stringify(api.steps)).toBe('passed');

  for (const start of ['/redirect-away', '/redirect-twice']) {
    const browser = await runTest(projectId, envId, definition([{ id: 'open', name: 'Open', type: 'navigate', url: start }]));
    expect(browser.status, start).toBe('failed');
    expect(browser.steps[0]?.errorCode, start).toBe('ORIGIN_NOT_ALLOWED');
  }
  // Redirects inside the allowed origins still work.
  const home = await runTest(
    projectId,
    envId,
    definition([
      { id: 'open', name: 'Open', type: 'navigate', url: '/redirect-home' },
      { id: 'url', name: 'Landed', type: 'assertUrl', expected: '/form', match: 'pathname', query: 'ignore' },
    ]),
  );
  expect(home.status, JSON.stringify(home.steps)).toBe('passed');

  expect(await hits()).toBe(0);
  // The target is reachable, so 0 hits means the redirects were blocked, not that it was down.
  await fetch(`${DEMO.replace('127.0.0.1', 'localhost')}/__demo/hit`);
  expect(await hits()).toBe(1);
});

test.describe('a killed runner process (23)', () => {
  const PORT = 4450;
  const TOKEN = 'restart-test-access-token-0123456789abcd';
  const cookie = `flowcheck_session_${PORT}=${createHmac('sha256', TOKEN).update('flowcheck-session').digest('base64url')}`;
  const base = `http://127.0.0.1:${PORT}/api`;
  const procs: ChildProcess[] = [];
  let dataDir = '';

  function start(app: 'server' | 'runner', ready: RegExp): Promise<ChildProcess> {
    const child = spawn(process.execPath, [resolve(import.meta.dirname, `../../apps/${app}/src/main.ts`)], {
      env: {
        ...process.env,
        FLOWCHECK_DATA_DIR: dataDir,
        FLOWCHECK_SERVER_PORT: String(PORT),
        FLOWCHECK_ACCESS_TOKEN: TOKEN,
        FLOWCHECK_SERVE_WEB: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    procs.push(child);
    return new Promise((done, fail) => {
      let output = '';
      const onData = (chunk: Buffer) => {
        output += chunk.toString();
        if (ready.test(output)) done(child);
      };
      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);
      child.on('exit', (code) => fail(new Error(`${app} exited with ${code}: ${output}`)));
    });
  }
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        cookie,
        ...(method === 'GET' ? {} : { origin: `http://127.0.0.1:${PORT}` }),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    expect(res.ok, `${method} ${path}: ${res.status}`).toBe(true);
    return (await res.json()) as T;
  }

  test.beforeAll(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'flowcheck-restart-'));
  });
  test.afterAll(async () => {
    // Wait for the processes to exit: Windows keeps their files (SQLite, logs) locked until then.
    await Promise.all(
      procs
        .filter((child) => child.exitCode === null && child.signalCode === null)
        .map((child) => {
          const exited = new Promise((r) => child.once('exit', r));
          child.kill();
          return exited;
        }),
    );
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  });

  test('marks its running run interrupted after a restart and never re-runs it', async () => {
    await start('server', /Server listening/);
    const runner = await start('runner', /runner started/);

    const project = await call<{ id: string }>('POST', '/projects', { name: 'Restart' });
    const env = await call<{ id: string }>('POST', `/projects/${project.id}/environments`, {
      name: 'Demo',
      kind: 'local',
      frontendBaseUrl: DEMO,
      apiBaseUrl: `${DEMO}/api`,
      allowPrivateNetwork: true,
    });
    const created = await call<{ testCase: { id: string } }>('POST', `/projects/${project.id}/test-cases`, {
      name: 'Slow',
      definition: definition([
        { id: 'open', name: 'Open', type: 'navigate', url: '/form' },
        // Waits long enough for the runner to be killed while the run is running.
        { id: 'wait', name: 'Wait', type: 'assertVisible', locator: { kind: 'testId', value: 'never-there' }, timeoutMs: 60_000 },
      ]),
    });
    const { runId } = await call<{ runId: string }>('POST', `/test-cases/${created.testCase.id}/runs`, {
      environmentId: env.id,
      inputs: {},
    });
    await expect.poll(async () => (await call<RunDto>('GET', `/runs/${runId}`)).status, { timeout: 20_000 }).toBe('running');

    // A hard kill: no shutdown handler runs, the run stays "running" in the database.
    runner.kill('SIGKILL');
    await new Promise((r) => runner.once('exit', r));
    expect((await call<RunDto>('GET', `/runs/${runId}`)).status).toBe('running');

    await start('runner', /runner started/);
    const run = await call<RunDto>('GET', `/runs/${runId}`);
    expect(run.status).toBe('interrupted');
    expect(run.failureSummary?.code).toBe('PROCESS_INTERRUPTED');
    // Interrupted runs are never executed again.
    await new Promise((r) => setTimeout(r, 2000));
    expect((await call<RunDto>('GET', `/runs/${runId}`)).status).toBe('interrupted');
  });
});
