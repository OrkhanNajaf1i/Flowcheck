import type { AuthCaptureDto } from '@flowcheck/shared';
import { expect, test } from '@playwright/test';
import { api, createProjectWithEnv, createTest, DEMO, definition, startRun, waitForRun } from './helpers.ts';

async function waitForCapture(id: string, status: AuthCaptureDto['status']): Promise<AuthCaptureDto> {
  let last: AuthCaptureDto | undefined;
  await expect
    .poll(
      async () => {
        last = (await api<AuthCaptureDto>('GET', `/auth-captures/${id}`)).body;
        return last.status;
      },
      { timeout: 20_000 },
    )
    .toBe(status);
  return last as AuthCaptureDto;
}

const accountTest = (authProfileId?: string) =>
  definition(
    [
      { id: 'open', name: 'Open account', type: 'navigate', url: '/account' },
      {
        id: 'who',
        name: 'Signed in',
        type: 'assertText',
        locator: { kind: 'testId', value: 'account-status' },
        expected: 'Signed in as qa',
        mode: 'exact',
        timeoutMs: 3000,
      },
    ],
    authProfileId ? { authProfileId } : {},
  );

test.describe('login sessions (auth profiles)', () => {
  test('a captured session is loaded into runs; runs without it are signed out', async () => {
    const { projectId, envId } = await createProjectWithEnv();
    const started = await api<AuthCaptureDto>('POST', `/projects/${projectId}/auth-captures`, {
      environmentId: envId,
      name: 'qa user',
      startPath: '/auto-login/qa',
    });
    expect(started.status).toBe(202);
    await waitForCapture(started.body.id, 'waiting_for_login');
    expect((await api('POST', `/auth-captures/${started.body.id}/save`)).status).toBe(202);
    const saved = await waitForCapture(started.body.id, 'saved');

    const profiles = await api<{ id: string; name: string; environmentId: string }[]>('GET', `/projects/${projectId}/auth-profiles`);
    expect(profiles.body).toEqual([expect.objectContaining({ id: saved.authProfileId, name: 'qa user', environmentId: envId })]);
    expect(JSON.stringify(profiles.body)).not.toContain('demo_auth');

    const signedIn = await createTest(projectId, accountTest(saved.authProfileId ?? undefined));
    const run = await waitForRun(await startRun(signedIn.testCaseId, envId));
    expect(run.status, JSON.stringify(run.steps)).toBe('passed');

    const signedOut = await createTest(projectId, accountTest());
    const run2 = await waitForRun(await startRun(signedOut.testCaseId, envId));
    expect(run2.status).toBe('failed');
    expect(run2.steps[1]?.actual).toEqual({ text: 'Please sign in' });
  });

  test('a session is never used for another website', async () => {
    const { projectId, envId } = await createProjectWithEnv();
    const other = await api('POST', `/projects/${projectId}/environments`, {
      name: 'Other',
      kind: 'local',
      frontendBaseUrl: DEMO,
      apiBaseUrl: `${DEMO}/api`,
      allowPrivateNetwork: true,
    });
    const started = await api<AuthCaptureDto>('POST', `/projects/${projectId}/auth-captures`, {
      environmentId: envId,
      name: 'qa',
      startPath: '/auto-login/qa',
    });
    await waitForCapture(started.body.id, 'waiting_for_login');
    await api('POST', `/auth-captures/${started.body.id}/save`);
    const saved = await waitForCapture(started.body.id, 'saved');
    const { testCaseId } = await createTest(projectId, accountTest(saved.authProfileId ?? undefined));
    const res = await api('POST', `/test-cases/${testCaseId}/runs`, { environmentId: other.body.id });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('AUTH_PROFILE_ENVIRONMENT_MISMATCH');
  });

  test('a capture holds the execution lock until it is cancelled', async () => {
    const { projectId, envId } = await createProjectWithEnv();
    const first = await api<AuthCaptureDto>('POST', `/projects/${projectId}/auth-captures`, {
      environmentId: envId,
      name: 'a',
      startPath: '/login',
    });
    await waitForCapture(first.body.id, 'waiting_for_login');
    const second = await api('POST', `/projects/${projectId}/auth-captures`, { environmentId: envId, name: 'b', startPath: '/login' });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('EXECUTION_LOCK_BUSY');

    // A run queued meanwhile waits and then runs after the capture is cancelled.
    const { testCaseId } = await createTest(projectId, definition([{ id: 'open', name: 'Open', type: 'navigate', url: '/' }]));
    const runId = await startRun(testCaseId, envId);
    await new Promise((r) => setTimeout(r, 1500));
    expect((await api('GET', `/runs/${runId}`)).body.status).toBe('queued');

    expect((await api<AuthCaptureDto>('POST', `/auth-captures/${first.body.id}/cancel`)).status).toBe(202);
    await waitForCapture(first.body.id, 'cancelled');
    expect((await waitForRun(runId)).status).toBe('passed');
  });
});
