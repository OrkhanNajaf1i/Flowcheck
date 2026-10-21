import { expect, test } from '@playwright/test';
import {
  AUTH,
  api,
  createProjectWithEnv,
  createTest,
  definition,
  runTest,
  SERVER,
  setDemoMode,
  startRun,
  stepStatuses,
  waitForRun,
} from './helpers.ts';

const testId = (value: string) => ({ kind: 'testId', value });

/** Buy one product through the real UI and assert the visible outcome. */
const orderFlow = [
  { id: 'open', name: 'Open shop', type: 'navigate', url: '/' },
  { id: 'add', name: 'Add Blue Mug', type: 'click', locator: testId('add-to-cart-p-1') },
  { id: 'added', name: 'Add confirmation', type: 'assertVisible', locator: { kind: 'text', value: 'Blue Mug added to cart', exact: true } },
  { id: 'cart', name: 'Open cart', type: 'navigate', url: '/cart' },
  { id: 'place', name: 'Place order', type: 'click', locator: { kind: 'role', role: 'button', name: 'Place order' } },
  { id: 'success', name: 'Success message', type: 'assertVisible', locator: testId('order-success'), timeoutMs: 3000 },
  { id: 'empty', name: 'Cart is empty', type: 'assertVisible', locator: testId('cart-empty'), timeoutMs: 3000 },
];

test.describe('phase 1 vertical slice', () => {
  test('manual definition passes against the demo in success mode', async () => {
    await setDemoMode('success');
    const { projectId, envId } = await createProjectWithEnv();
    const run = await runTest(
      projectId,
      envId,
      definition([
        ...orderFlow,
        {
          id: 'products',
          name: 'Products API',
          type: 'apiRequest',
          method: 'GET',
          path: '/products',
          assertions: [
            { kind: 'statusEquals', expected: 200 },
            { kind: 'jsonArrayLength', pointer: '', expected: 3 },
            { kind: 'jsonEquals', pointer: '/0/id', expected: 'p-1' },
          ],
        },
      ]),
    );
    expect(run.status, JSON.stringify(run.failureSummary)).toBe('passed');
    expect(run.steps.every((s) => s.status === 'passed')).toBe(true);
    expect(run.failureSummary).toBeNull();
  });

  test('create-order-500: UI assertion fails, later steps are skipped, screenshot is kept', async () => {
    await setDemoMode('create-order-500');
    const { projectId, envId } = await createProjectWithEnv();
    const run = await runTest(projectId, envId, definition(orderFlow));
    expect(run.status).toBe('failed');
    expect(stepStatuses(run)).toEqual([
      'open:passed',
      'add:passed',
      'added:passed',
      'cart:passed',
      'place:passed',
      'success:failed',
      'empty:skipped',
    ]);
    const failed = run.steps.find((s) => s.stepId === 'success');
    expect(failed?.errorCode).toBe('ASSERTION_FAILED');
    expect(run.failureSummary).toMatchObject({ code: 'ASSERTION_FAILED', stepId: 'success' });
    expect(run.steps.find((s) => s.stepId === 'empty')?.skipReason).toContain('Previous main step');

    const screenshot = failed?.artifacts.find((a) => a.type === 'screenshot');
    expect(screenshot).toBeDefined();
    const download = await fetch(`${SERVER}/api/runs/${run.id}/artifacts/${screenshot?.id}`, { headers: AUTH });
    expect(download.status).toBe(200);
    expect(download.headers.get('content-type')).toBe('image/png');
    expect(download.headers.get('content-security-policy')).toContain('sandbox');
    // The same artifact is not reachable through another run.
    const other = await fetch(`${SERVER}/api/runs/00000000-0000-0000-0000-000000000000/artifacts/${screenshot?.id}`, { headers: AUTH });
    expect(other.status).toBe(404);
  });

  test('create-order-500: API status assertion fails with the observed status, not "no response"', async () => {
    await setDemoMode('create-order-500');
    const { projectId, envId } = await createProjectWithEnv();
    const run = await runTest(
      projectId,
      envId,
      definition([
        { id: 'open', name: 'Open shop (sets session cookie)', type: 'navigate', url: '/' },
        {
          id: 'add',
          name: 'Add item',
          type: 'apiRequest',
          method: 'POST',
          path: '/cart/items',
          body: { productId: 'p-1', quantity: 1 },
          assertions: [{ kind: 'statusEquals', expected: 201 }],
        },
        {
          id: 'order',
          name: 'Create order',
          type: 'apiRequest',
          method: 'POST',
          path: '/orders',
          assertions: [
            { kind: 'statusEquals', expected: 201 },
            { kind: 'jsonExists', pointer: '/id' },
          ],
        },
      ]),
    );
    expect(run.status).toBe('failed');
    const order = run.steps.find((s) => s.stepId === 'order');
    expect(order?.errorCode).toBe('ASSERTION_FAILED');
    expect((order?.actual as { response: { status: number } } | undefined)?.response.status).toBe(500);
    expect(order?.errorMessage).toContain('status 500, expected 201');
  });

  test('a 403 response passes when 403 is expected', async () => {
    const { projectId, envId } = await createProjectWithEnv();
    const run = await runTest(
      projectId,
      envId,
      definition([
        {
          id: 'admin',
          name: 'Admin is forbidden',
          type: 'apiRequest',
          method: 'GET',
          path: '/admin-only',
          assertions: [{ kind: 'statusEquals', expected: 403 }],
        },
      ]),
    );
    expect(run.status).toBe('passed');
  });

  test('an ambiguous locator fails instead of silently using the first match', async () => {
    await setDemoMode('success');
    const { projectId, envId } = await createProjectWithEnv();
    const run = await runTest(
      projectId,
      envId,
      definition([
        { id: 'open', name: 'Open shop', type: 'navigate', url: '/' },
        { id: 'products', name: 'Products loaded', type: 'assertVisible', locator: testId('add-to-cart-p-3') },
        { id: 'add', name: 'Add (ambiguous)', type: 'click', locator: { kind: 'role', role: 'button', name: 'Add to cart' } },
      ]),
    );
    expect(run.status).toBe('failed');
    const add = run.steps.find((s) => s.stepId === 'add');
    expect(add?.errorCode).toBe('AMBIGUOUS_LOCATOR');
    expect(add?.errorMessage).toContain('matches 3 elements');
  });

  test('navigation outside the allowed origins is blocked', async () => {
    const { projectId, envId } = await createProjectWithEnv();
    const run = await runTest(
      projectId,
      envId,
      definition([{ id: 'out', name: 'Leave allowlist', type: 'navigate', url: 'https://example.com/' }]),
    );
    expect(run.status).toBe('failed');
    expect(run.steps[0]?.errorCode).toBe('ORIGIN_NOT_ALLOWED');
  });

  test('the cloud metadata address is blocked even with private network allowed', async () => {
    const { projectId, envId } = await createProjectWithEnv({ apiBaseUrl: 'http://169.254.169.254/latest' });
    const run = await runTest(
      projectId,
      envId,
      definition([
        {
          id: 'meta',
          name: 'Metadata',
          type: 'apiRequest',
          method: 'GET',
          path: '/meta-data',
          assertions: [{ kind: 'statusEquals', expected: 200 }],
        },
      ]),
    );
    expect(run.status).toBe('failed');
    expect(run.steps[0]?.errorCode).toBe('SSRF_BLOCKED');
  });

  test('a run that exceeds its run timeout is interrupted', async () => {
    const { projectId, envId } = await createProjectWithEnv();
    const run = await runTest(
      projectId,
      envId,
      definition(
        [
          { id: 'open', name: 'Open shop', type: 'navigate', url: '/' },
          { id: 'wait', name: 'Never appears', type: 'assertVisible', locator: testId('does-not-exist'), timeoutMs: 60_000 },
        ],
        { runTimeoutMs: 10_000 },
      ),
    );
    expect(run.status).toBe('interrupted');
    expect(run.failureSummary?.code).toBe('RUN_TIMEOUT');
    expect(run.steps.find((s) => s.stepId === 'wait')?.status).toBe('interrupted');
  });

  test('a running run can be cancelled', async () => {
    const { projectId, envId } = await createProjectWithEnv();
    const { testCaseId } = await createTest(
      projectId,
      definition([
        { id: 'open', name: 'Open shop', type: 'navigate', url: '/' },
        { id: 'wait', name: 'Never appears', type: 'assertVisible', locator: testId('does-not-exist'), timeoutMs: 60_000 },
      ]),
    );
    const runId = await startRun(testCaseId, envId);
    await expect.poll(async () => (await api('GET', `/runs/${runId}`)).body.status, { timeout: 15_000 }).toBe('running');
    await expect
      .poll(async () => (await api('GET', `/runs/${runId}`)).body.steps.some((s: { status: string }) => s.status === 'running'))
      .toBe(true);
    expect((await api('POST', `/runs/${runId}/cancel`)).status).toBe(202);
    const run = await waitForRun(runId, 20_000);
    expect(run.status).toBe('cancelled');
    expect(run.steps.find((s) => s.stepId === 'wait')?.status).toBe('cancelled');
  });

  test('missing variables and undeclared inputs are rejected before running', async () => {
    const { projectId } = await createProjectWithEnv();
    const res = await api('POST', `/projects/${projectId}/test-cases`, {
      name: 'Bad ref',
      definition: definition([{ id: 'open', name: 'Open', type: 'navigate', url: '/{{inputs.missing}}' }]),
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.error.details)).toContain('undeclared input');
  });
});
