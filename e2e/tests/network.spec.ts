import { expect, test } from '@playwright/test';
import { createProjectWithEnv, definition, runTest, setDemoMode, stepStatuses } from './helpers.ts';

const id = (value: string) => ({ kind: 'testId', value });

/**
 * The acceptance scenario from PROJECT_RULES §4/§20: buy a mug, check the POST /api/orders that
 * the click sends, take the order id from it, read the order back through the API, delete it in
 * cleanup — across all demo bug modes.
 */
function orderTest() {
  return definition(
    [
      { id: 'open', name: 'Open shop', type: 'navigate', url: '/' },
      { id: 'add', name: 'Add mug', type: 'click', locator: id('add-to-cart-p-1') },
      { id: 'added', name: 'Added', type: 'assertVisible', locator: { kind: 'text', value: 'Blue Mug added to cart', exact: true } },
      { id: 'cart', name: 'Open cart', type: 'navigate', url: '/cart' },
      {
        id: 'place',
        name: 'Place order',
        type: 'click',
        locator: id('place-order'),
        networkChecks: [
          {
            id: 'create',
            name: 'Order is created',
            match: { origin: 'api', method: 'POST', pathname: '/api/orders' },
            assertions: [
              { kind: 'statusEquals', expected: 201 },
              { kind: 'jsonExists', pointer: '/id' },
            ],
            outputs: [{ name: 'orderId', from: 'json', pointer: '/id' }],
          },
        ],
      },
      { id: 'message', name: 'Success message', type: 'assertVisible', locator: id('order-success'), timeoutMs: 3000 },
      {
        id: 'read',
        name: 'Order can be read through the API',
        type: 'apiRequest',
        method: 'GET',
        path: '/orders/{{outputs.orderId}}',
        assertions: [
          { kind: 'statusEquals', expected: 200 },
          { kind: 'jsonEquals', pointer: '/id', expected: '{{outputs.orderId}}' },
        ],
      },
      { id: 'empty', name: 'Cart is empty', type: 'assertVisible', locator: id('cart-empty'), timeoutMs: 3000 },
    ],
    {
      cleanupSteps: [
        {
          id: 'delete',
          name: 'Delete the test order',
          type: 'apiRequest',
          method: 'DELETE',
          path: '/orders/{{outputs.orderId}}',
          assertions: [{ kind: 'statusEquals', expected: 204 }],
        },
      ],
    },
  );
}

test.describe('network checks and outputs', () => {
  test('success: the request is observed, the id flows into later steps and cleanup', async () => {
    await setDemoMode('success');
    const { projectId, envId } = await createProjectWithEnv();
    const run = await runTest(projectId, envId, orderTest());
    expect(run.status, JSON.stringify(run.steps.filter((s) => s.status !== 'passed'))).toBe('passed');
    const place = run.steps.find((s) => s.stepId === 'place');
    const check = (place?.actual as { networkChecks: { response: { status: number }; outputs: { orderId: string } }[] } | undefined)
      ?.networkChecks[0];
    expect(check?.response.status).toBe(201);
    expect(check?.outputs.orderId).toMatch(/^[0-9a-f-]{36}$/);
    expect(run.steps.find((s) => s.stepId === 'delete')?.status).toBe('passed');
  });

  test('create-order-500: the matching request is reported with status 500, not as "no response"', async () => {
    await setDemoMode('create-order-500');
    const { projectId, envId } = await createProjectWithEnv();
    const run = await runTest(projectId, envId, orderTest());
    expect(run.status).toBe('failed');
    const place = run.steps.find((s) => s.stepId === 'place');
    expect(place?.errorCode).toBe('ASSERTION_FAILED');
    expect(place?.errorMessage).toContain('status 500, expected 201');
    expect(stepStatuses(run).slice(5)).toEqual(['message:skipped', 'read:skipped', 'empty:skipped', 'delete:skipped']);
    // No output was published from the failed step, so cleanup is skipped with a visible reason.
    expect(run.steps.find((s) => s.stepId === 'delete')?.skipReason).toContain('{{outputs.orderId}}');
  });

  test('ui-success-but-no-order: the success message passes but reading the order fails', async () => {
    await setDemoMode('ui-success-but-no-order');
    const { projectId, envId } = await createProjectWithEnv();
    const run = await runTest(projectId, envId, orderTest());
    expect(run.status).toBe('failed');
    expect(run.steps.find((s) => s.stepId === 'place')?.status).toBe('passed');
    expect(run.steps.find((s) => s.stepId === 'message')?.status).toBe('passed');
    const read = run.steps.find((s) => s.stepId === 'read');
    expect(read?.errorCode).toBe('ASSERTION_FAILED');
    expect(read?.errorMessage).toContain('status 404');
  });

  test('cart-not-cleared: the order exists but the cart check fails; cleanup still deletes the order', async () => {
    await setDemoMode('cart-not-cleared');
    const { projectId, envId } = await createProjectWithEnv();
    const run = await runTest(projectId, envId, orderTest());
    expect(run.status).toBe('failed');
    expect(run.steps.find((s) => s.stepId === 'read')?.status).toBe('passed');
    expect(run.steps.find((s) => s.stepId === 'empty')?.status).toBe('failed');
    expect(run.steps.find((s) => s.stepId === 'delete')?.status).toBe('passed');
    expect(run.failureSummary?.stepId).toBe('empty');
  });

  test('a click that sends no matching request fails with NETWORK_TIMEOUT and lists what was sent', async () => {
    const { projectId, envId } = await createProjectWithEnv();
    const run = await runTest(
      projectId,
      envId,
      definition([
        { id: 'open', name: 'Open form', type: 'navigate', url: '/form' },
        {
          id: 'click',
          name: 'Account button',
          type: 'click',
          locator: { kind: 'id', value: 'account-btn' },
          networkChecks: [
            {
              id: 'none',
              name: 'Never sent',
              match: { origin: 'api', method: 'POST', pathname: '/api/orders' },
              timeoutMs: 1500,
              assertions: [],
            },
          ],
        },
      ]),
    );
    const step = run.steps.find((s) => s.stepId === 'click');
    expect(step?.errorCode).toBe('NETWORK_TIMEOUT');
    expect(step?.errorMessage).toContain('no POST request to');
  });

  test('two identical requests in the observation window are AMBIGUOUS_NETWORK_MATCH', async () => {
    const { projectId, envId } = await createProjectWithEnv();
    const run = await runTest(
      projectId,
      envId,
      definition([
        { id: 'open', name: 'Open form', type: 'navigate', url: '/form' },
        {
          id: 'twice',
          name: 'Refresh twice',
          type: 'click',
          locator: id('refresh-twice'),
          networkChecks: [
            {
              id: 'products',
              name: 'Products',
              match: { origin: 'api', method: 'GET', pathname: '/api/products' },
              assertions: [{ kind: 'statusEquals', expected: 200 }],
            },
          ],
        },
      ]),
    );
    expect(run.steps.find((s) => s.stepId === 'twice')?.errorCode).toBe('AMBIGUOUS_NETWORK_MATCH');
  });
});
