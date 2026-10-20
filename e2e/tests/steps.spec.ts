import { expect, test } from '@playwright/test';
import { createProjectWithEnv, definition, runTest, stepStatuses } from './helpers.ts';

const id = (value: string) => ({ kind: 'testId', value });
const label = (value: string) => ({ kind: 'label', value, exact: true });

test.describe('all step types against the demo sign-up form', () => {
  test('a full form flow passes with every new step type', async () => {
    const { projectId, envId } = await createProjectWithEnv();
    const run = await runTest(
      projectId,
      envId,
      definition([
        { id: 'open', name: 'Open form', type: 'navigate', url: '/form' },
        { id: 'prefilled', name: 'Name is prefilled', type: 'assertValue', locator: label('Name'), expected: 'Guest' },
        { id: 'noError', name: 'No error yet', type: 'assertHidden', locator: id('form-error') },
        { id: 'name', name: 'Type name', type: 'fill', locator: label('Name'), value: 'Orkhan' },
        {
          id: 'country',
          name: 'Choose country',
          type: 'selectOption',
          locator: label('Country'),
          option: { by: 'label', value: 'Azerbaijan' },
        },
        { id: 'terms', name: 'Accept terms', type: 'check', locator: label('I agree to the terms') },
        { id: 'enabled', name: 'Submit is enabled', type: 'assertEnabled', locator: { kind: 'role', role: 'button', name: 'Sign up' } },
        { id: 'enter', name: 'Press Enter', type: 'press', locator: label('Name'), key: 'Enter' },
        { id: 'path', name: 'On done page', type: 'assertUrl', expected: '/done', match: 'pathname', query: 'ignore' },
        {
          id: 'query',
          name: 'Query sent',
          type: 'assertUrl',
          expected: '/done?name=Orkhan&country=az',
          match: 'pathname',
          query: 'include',
        },
        { id: 'thanks', name: 'Thanks text', type: 'assertText', locator: id('thanks'), expected: 'Thanks, Orkhan!', mode: 'exact' },
        { id: 'summary', name: 'Summary', type: 'assertText', locator: id('summary'), expected: 'Country: az', mode: 'contains' },
      ]),
    );
    expect(run.status, JSON.stringify(run.steps.filter((s) => s.status !== 'passed'))).toBe('passed');
  });

  test('assertEnabled fails after uncheck, with the observed state', async () => {
    const { projectId, envId } = await createProjectWithEnv();
    const run = await runTest(
      projectId,
      envId,
      definition([
        { id: 'open', name: 'Open form', type: 'navigate', url: '/form' },
        { id: 'check', name: 'Accept', type: 'check', locator: label('I agree to the terms') },
        { id: 'uncheck', name: 'Withdraw', type: 'uncheck', locator: label('I agree to the terms') },
        { id: 'enabled', name: 'Submit is enabled', type: 'assertEnabled', locator: id('nope'), timeoutMs: 1000 },
      ]),
    );
    // A missing element is reported as not found, not as "disabled".
    expect(run.steps.find((s) => s.stepId === 'enabled')?.errorCode).toBe('LOCATOR_NOT_FOUND');

    const run2 = await runTest(
      projectId,
      envId,
      definition([
        { id: 'open', name: 'Open form', type: 'navigate', url: '/form' },
        { id: 'check', name: 'Accept', type: 'check', locator: label('I agree to the terms') },
        { id: 'uncheck', name: 'Withdraw', type: 'uncheck', locator: label('I agree to the terms') },
        {
          id: 'enabled',
          name: 'Submit is enabled',
          type: 'assertEnabled',
          locator: { kind: 'role', role: 'button', name: 'Sign up' },
          timeoutMs: 1500,
        },
      ]),
    );
    expect(run2.status, JSON.stringify(run2.steps.map((s) => [s.stepId, s.status, s.errorCode, s.errorMessage]))).toBe('failed');
    const step = run2.steps.find((s) => s.stepId === 'enabled');
    expect(step?.errorCode).toBe('ASSERTION_FAILED');
    expect(step?.actual).toEqual({ enabled: false });
  });

  test('assertText reports exact mismatch with the actual text; assertUrl reports the actual URL', async () => {
    const { projectId, envId } = await createProjectWithEnv();
    const run = await runTest(
      projectId,
      envId,
      definition([
        { id: 'open', name: 'Open done', type: 'navigate', url: '/done?name=Ali&country=tr' },
        { id: 'text', name: 'Exact text', type: 'assertText', locator: id('thanks'), expected: 'Thanks', mode: 'exact', timeoutMs: 1500 },
      ]),
    );
    const text = run.steps.find((s) => s.stepId === 'text');
    expect(text?.errorCode).toBe('ASSERTION_FAILED');
    expect(text?.actual).toEqual({ text: 'Thanks, Ali!' });

    const run2 = await runTest(
      projectId,
      envId,
      definition([
        { id: 'open', name: 'Open form', type: 'navigate', url: '/form' },
        { id: 'url', name: 'Wrong page', type: 'assertUrl', expected: '/done', match: 'pathname', query: 'ignore', timeoutMs: 1500 },
      ]),
    );
    const url = run2.steps.find((s) => s.stepId === 'url');
    expect(url?.errorCode).toBe('ASSERTION_FAILED');
    expect((url?.actual as { url: string } | undefined)?.url).toContain('/form');
  });

  test('assertHidden checks every match instead of the first one', async () => {
    const { projectId, envId } = await createProjectWithEnv();
    const run = await runTest(
      projectId,
      envId,
      definition([
        { id: 'open', name: 'Open shop', type: 'navigate', url: '/' },
        { id: 'loaded', name: 'Products loaded', type: 'assertVisible', locator: id('add-to-cart-p-3') },
        { id: 'none', name: 'Nothing matches', type: 'assertHidden', locator: id('does-not-exist') },
        {
          id: 'buttons',
          name: 'Buttons hidden?',
          type: 'assertHidden',
          locator: { kind: 'role', role: 'button', name: 'Add to cart' },
          timeoutMs: 1000,
        },
      ]),
    );
    expect(stepStatuses(run)).toEqual(['open:passed', 'loaded:passed', 'none:passed', 'buttons:failed']);
    expect(run.steps.find((s) => s.stepId === 'buttons')?.actual).toEqual({ matches: 3, visible: 3 });
  });

  test('selectOption fails clearly for a missing option', async () => {
    const { projectId, envId } = await createProjectWithEnv();
    const run = await runTest(
      projectId,
      envId,
      definition([
        { id: 'open', name: 'Open form', type: 'navigate', url: '/form' },
        {
          id: 'select',
          name: 'Unknown country',
          type: 'selectOption',
          locator: label('Country'),
          option: { by: 'label', value: 'Atlantis' },
          timeoutMs: 1500,
        },
      ]),
    );
    expect(run.status).toBe('failed');
    expect(run.steps.find((s) => s.stepId === 'select')?.errorCode).toBe('ACTION_FAILED');
  });
});
