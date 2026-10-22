import { expect, test } from '@playwright/test';
import { api, createProjectWithEnv, createTest, definition, startRun, waitForRun } from './helpers.ts';

const SECRET = 'Orxan-Secret-Value-42';

test('a secret is used in the browser and in API headers but never appears in the run report (criterion 17)', async () => {
  const { projectId, envId } = await createProjectWithEnv();
  expect((await api('POST', `/projects/${projectId}/secrets`, { name: 'demoName', value: SECRET })).status).toBe(201);

  const { testCaseId } = await createTest(
    projectId,
    definition([
      { id: 'open', name: 'Open form', type: 'navigate', url: '/form' },
      {
        id: 'name',
        name: 'Type the secret',
        type: 'fill',
        locator: { kind: 'label', value: 'Name', exact: true },
        value: '{{secrets.demoName}}',
      },
      { id: 'terms', name: 'Accept', type: 'check', locator: { kind: 'label', value: 'I agree to the terms', exact: true } },
      {
        id: 'country',
        name: 'Country',
        type: 'selectOption',
        locator: { kind: 'label', value: 'Country', exact: true },
        option: { by: 'value', value: 'az' },
      },
      // The page puts the typed value into the URL: the step evidence must still not contain it.
      { id: 'submit', name: 'Submit', type: 'press', locator: { kind: 'label', value: 'Name', exact: true }, key: 'Enter' },
      { id: 'done', name: 'Done page', type: 'assertUrl', expected: '/done', match: 'pathname', query: 'ignore' },
      {
        id: 'api',
        name: 'API with a secret header',
        type: 'apiRequest',
        method: 'GET',
        path: '/products',
        headers: { 'X-Demo-Token': '{{secrets.demoName}}' },
        assertions: [{ kind: 'statusEquals', expected: 200 }],
      },
    ]),
  );
  const run = await waitForRun(await startRun(testCaseId, envId));
  expect(run.status, JSON.stringify(run.steps.filter((s) => s.status !== 'passed'))).toBe('passed');

  const report = JSON.stringify(run);
  expect(report).not.toContain(SECRET);
  expect(report).not.toContain(encodeURIComponent(SECRET));
  expect(report).toContain('[REDACTED]');
  const secretsList = await api('GET', `/projects/${projectId}/secrets`);
  expect(JSON.stringify(secretsList.body)).not.toContain(SECRET);
});

test('a test that needs a missing secret does not start', async () => {
  const { projectId, envId } = await createProjectWithEnv();
  const { testCaseId } = await createTest(
    projectId,
    definition([
      { id: 'pw', name: 'Password', type: 'fill', locator: { kind: 'label', value: 'Name', exact: true }, value: '{{secrets.nope}}' },
    ]),
  );
  const res = await api('POST', `/test-cases/${testCaseId}/runs`, { environmentId: envId });
  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe('SECRET_NOT_FOUND');
});
