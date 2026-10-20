import { expect, test } from '@playwright/test';
import { createProjectWithEnv, definition, runTest, SERVER, stepStatuses } from './helpers.ts';

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

test('extra locator kinds find elements by id, attribute, alt text, title and aria-label', async () => {
  const { projectId, envId } = await createProjectWithEnv();
  const run = await runTest(
    projectId,
    envId,
    definition([
      { id: 'open', name: 'Open form', type: 'navigate', url: '/form' },
      { id: 'byId', name: 'By id', type: 'assertVisible', locator: { kind: 'id', value: 'account-btn' } },
      { id: 'byAria', name: 'Icon button by name (aria-label)', type: 'click', locator: { kind: 'role', role: 'button', name: 'Account' } },
      { id: 'byTitle', name: 'By title', type: 'assertVisible', locator: { kind: 'title', value: 'Your account', exact: true } },
      { id: 'byAlt', name: 'By alt text', type: 'assertVisible', locator: { kind: 'altText', value: 'Shop logo', exact: true } },
      {
        id: 'byAttr',
        name: 'By name attribute',
        type: 'fill',
        locator: { kind: 'attribute', name: 'name', value: 'email' },
        value: 'qa@example.test',
      },
      {
        id: 'value',
        name: 'Value typed',
        type: 'assertValue',
        locator: { kind: 'attribute', name: 'name', value: 'email' },
        expected: 'qa@example.test',
      },
      // A value with quotes is matched literally and simply finds nothing.
      { id: 'quotes', name: 'Quoted value', type: 'assertHidden', locator: { kind: 'attribute', name: 'name', value: 'x"] , body [a="' } },
    ]),
  );
  expect(run.status, JSON.stringify(run.steps.filter((s) => s.status !== 'passed'))).toBe('passed');
});

test('a scoped locator tells apart elements with the same text', async () => {
  const { projectId, envId } = await createProjectWithEnv();
  const search = { kind: 'text', value: 'Search', exact: true };
  const run = await runTest(
    projectId,
    envId,
    definition([
      { id: 'open', name: 'Open form', type: 'navigate', url: '/form' },
      { id: 'top', name: 'Search in top bar', type: 'click', locator: { ...search, within: { kind: 'id', value: 'top-bar' } } },
      {
        id: 'footer',
        name: 'Search in footer',
        type: 'assertVisible',
        locator: { ...search, within: { kind: 'id', value: 'footer-tools' } },
      },
      { id: 'unscoped', name: 'Search anywhere', type: 'click', locator: search },
    ]),
  );
  expect(stepStatuses(run)).toEqual(['open:passed', 'top:passed', 'footer:passed', 'unscoped:failed']);
  expect(run.steps.find((s) => s.stepId === 'unscoped')?.errorMessage).toContain('matches 2 elements');

  // The container itself must be unique, and a missing container is reported as such.
  const run2 = await runTest(
    projectId,
    envId,
    definition([
      { id: 'open', name: 'Open form', type: 'navigate', url: '/form' },
      {
        id: 'twoSections',
        name: 'Ambiguous container',
        type: 'click',
        locator: { ...search, within: { kind: 'css', value: 'section' } },
        timeoutMs: 1000,
      },
    ]),
  );
  const step = run2.steps.find((s) => s.stepId === 'twoSections');
  expect(step?.errorCode).toBe('AMBIGUOUS_LOCATOR');
  expect(step?.errorMessage).toContain('the container must match exactly one');

  const run3 = await runTest(
    projectId,
    envId,
    definition([
      { id: 'open', name: 'Open form', type: 'navigate', url: '/form' },
      {
        id: 'noContainer',
        name: 'Missing container',
        type: 'click',
        locator: { ...search, within: { kind: 'id', value: 'nope' } },
        timeoutMs: 1000,
      },
    ]),
  );
  expect(run3.steps.find((s) => s.stepId === 'noContainer')?.errorMessage).toContain('No container matches');
});

test('a passed step keeps a screenshot only when the step asks for one', async () => {
  const { projectId, envId } = await createProjectWithEnv();
  const run = await runTest(
    projectId,
    envId,
    definition([
      { id: 'open', name: 'Open', type: 'navigate', url: '/form' },
      { id: 'account', name: 'Account', type: 'click', locator: { kind: 'role', role: 'button', name: 'Account' }, screenshot: true },
    ]),
  );
  expect(run.status).toBe('passed');
  expect(run.steps[0]?.artifacts).toEqual([]);
  const [shot] = run.steps[1]?.artifacts ?? [];
  expect(shot).toMatchObject({ type: 'screenshot', mimeType: 'image/png', sensitive: true });
  const res = await fetch(`${SERVER}/api/runs/${run.id}/artifacts/${shot?.id}`);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('image/png');
});
