import type { RunDto } from '@flowcheck/shared';
import { expect } from '@playwright/test';
import { SESSION_COOKIE } from '../playwright.config.ts';

export const SERVER = 'http://127.0.0.1:4410';
export const DEMO = 'http://127.0.0.1:4420';
/** Cookie header of the signed-in test browser. */
export const AUTH = { cookie: `${SESSION_COOKIE.name}=${SESSION_COOKIE.value}` };

/** Calls the FlowCheck API like the UI does (same-origin Origin header). */
export async function api<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(`${SERVER}/api${path}`, {
    method,
    headers: {
      ...AUTH,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(method === 'GET' ? {} : { origin: SERVER }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

export async function setDemoMode(mode: 'success' | 'create-order-500' | 'ui-success-but-no-order' | 'cart-not-cleared') {
  const res = await fetch(`${DEMO}/__demo/reset`, { method: 'POST' });
  expect(res.ok).toBe(true);
  const set = await fetch(`${DEMO}/__demo/mode`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  expect(set.ok).toBe(true);
}

export async function createProjectWithEnv(overrides: Record<string, unknown> = {}) {
  const project = await api('POST', '/projects', { name: `E2E ${Date.now()}` });
  expect(project.status).toBe(201);
  const env = await api('POST', `/projects/${project.body.id}/environments`, {
    name: 'Local demo',
    kind: 'local',
    frontendBaseUrl: DEMO,
    apiBaseUrl: `${DEMO}/api`,
    allowPrivateNetwork: true,
    ...overrides,
  });
  expect(env.status, JSON.stringify(env.body)).toBe(201);
  return { projectId: project.body.id as string, envId: env.body.id as string };
}

export function definition(steps: unknown[], extra: Record<string, unknown> = {}) {
  return { schemaVersion: 1, metadata: { tags: [] }, inputs: [], setupSteps: [], steps, cleanupSteps: [], ...extra };
}

export async function createTest(projectId: string, def: unknown) {
  const res = await api('POST', `/projects/${projectId}/test-cases`, { name: `Test ${Date.now()}`, definition: def });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { testCaseId: res.body.testCase.id as string, revisionId: res.body.revision.id as string };
}

export async function startRun(testCaseId: string, envId: string, inputs: Record<string, unknown> = {}) {
  const res = await api('POST', `/test-cases/${testCaseId}/runs`, { environmentId: envId, inputs });
  expect(res.status, JSON.stringify(res.body)).toBe(202);
  return res.body.runId as string;
}

const FINAL = new Set(['passed', 'failed', 'error', 'cancelled', 'interrupted']);

export async function waitForRun(runId: string, timeoutMs = 60_000): Promise<RunDto> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { body } = await api<RunDto>('GET', `/runs/${runId}`);
    if (FINAL.has(body.status)) return body;
    if (Date.now() > deadline) throw new Error(`Run ${runId} still ${body.status} after ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

export async function runTest(projectId: string, envId: string, def: unknown, inputs: Record<string, unknown> = {}) {
  const { testCaseId } = await createTest(projectId, def);
  return waitForRun(await startRun(testCaseId, envId, inputs));
}

export function stepStatuses(run: RunDto) {
  return run.steps.map((s) => `${s.stepId}:${s.status}`);
}
