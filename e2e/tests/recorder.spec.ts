import type { RecordingDto } from '@flowcheck/shared';
import { type Browser, chromium, expect, type Page, test } from '@playwright/test';
import { RECORDER_CDP_PORT } from '../playwright.config.ts';
import { api, createProjectWithEnv, createTest, DEMO, definition, SERVER, setDemoMode, startRun, waitForRun } from './helpers.ts';

/**
 * Recorder acceptance tests (PROJECT_RULES §8, §20 criteria 4, 24, 29). The runner opens the
 * recorder browser; the test connects to it over CDP and acts in the page like a tester, so the
 * recorder script sees real, trusted events.
 */

async function waitForRecording(id: string, status: RecordingDto['status']): Promise<RecordingDto> {
  let last: RecordingDto | undefined;
  await expect
    .poll(
      async () => {
        last = (await api<RecordingDto>('GET', `/recordings/${id}`)).body;
        return last.status;
      },
      { timeout: 20_000 },
    )
    .toBe(status);
  return last as RecordingDto;
}

let open: string | null = null;
test.afterEach(async () => {
  // A failed test must not leave the recorder (and the execution lock) busy for the next one.
  if (open) await api('POST', `/recordings/${open}/stop`);
  open = null;
});

async function startRecording(projectId: string, envId: string, startPath: string, language: 'en' | 'az' = 'en') {
  const started = await api<RecordingDto>('POST', `/projects/${projectId}/recordings`, { environmentId: envId, startPath, language });
  expect(started.status, JSON.stringify(started.body)).toBe(202);
  open = started.body.id;
  await waitForRecording(started.body.id, 'recording');
  return attach(started.body.id, startPath, language === 'az' ? 'FlowCheck qeyd edir' : 'FlowCheck is recording');
}

/** Connects to the recorder browser and returns the tester's page once the recorder listens. */
async function attach(id: string, startPath: string, banner = 'FlowCheck is recording') {
  // The browser is still starting when the runner has claimed the recording.
  let connected: Browser | undefined;
  await expect
    .poll(async () => {
      connected = await chromium.connectOverCDP(`http://127.0.0.1:${RECORDER_CDP_PORT}`).catch(() => undefined);
      return connected !== undefined;
    })
    .toBe(true);
  const browser = connected as Browser;
  let page: Page | undefined;
  await expect
    .poll(() => {
      page = browser
        .contexts()
        .flatMap((c) => c.pages())
        .find((p) => p.url().includes(startPath));
      return page !== undefined;
    })
    .toBe(true);
  const tester = page as Page;
  // The overlay is mounted once the start page has loaded; then the recorder listens.
  await expect(tester.getByText(banner)).toBeVisible();
  return { id, browser, page: tester };
}

async function stop(id: string, browser: Browser) {
  expect((await api('POST', `/recordings/${id}/stop`)).status).toBe(202);
  const done = await waitForRecording(id, 'stopped');
  await browser.close().catch(() => undefined);
  return done;
}

const summary = (r: RecordingDto) =>
  r.steps.map((s) => {
    switch (s.type) {
      case 'navigate':
        return `navigate ${s.url}`;
      case 'fill':
        return `fill ${JSON.stringify(s.locator)} = ${s.value}`;
      case 'selectOption':
        return `select ${JSON.stringify(s.locator)} = ${s.option.by}:${s.option.value}`;
      case 'press':
        return `press ${s.key} ${JSON.stringify(s.locator)}`;
      default:
        return 'locator' in s ? `${s.type} ${JSON.stringify(s.locator)}` : s.type;
    }
  });

test.describe('recorder', () => {
  test('records fill, select, check and click (typing coalesced); the draft replays and passes', async () => {
    const { projectId, envId } = await createProjectWithEnv();
    const { id, browser, page } = await startRecording(projectId, envId, '/form');

    await page.getByLabel('Name').fill('A');
    await page.getByLabel('Name').pressSequentially('da');
    // selectOption() dispatches a synthetic (untrusted) change, which the recorder ignores like any
    // page script event; a tester uses the keyboard or the native list, which is trusted.
    await page.getByLabel('Country').focus();
    await page.keyboard.press('ArrowDown');
    await page.getByLabel('I agree to the terms').check();
    await page.getByRole('button', { name: 'Sign up' }).click();
    await page.waitForURL(/\/done/);
    const recording = await stop(id, browser);

    expect(summary(recording)).toEqual([
      'navigate /form',
      'fill {"kind":"role","role":"textbox","name":"Name"} = Ada',
      'select {"kind":"role","role":"combobox","name":"Country"} = label:Azerbaijan',
      'check {"kind":"role","role":"checkbox","name":"I agree to the terms"}',
      'click {"kind":"role","role":"button","name":"Sign up"}',
    ]);
    expect(recording.warnings).toEqual([]);

    // Criterion 4: the recorded steps are saved and re-executed.
    const thanks = {
      id: 'thanks',
      name: 'Thanks',
      type: 'assertText',
      locator: { kind: 'testId', value: 'thanks' },
      expected: 'Thanks, Ada!',
      mode: 'exact',
    };
    const { testCaseId } = await createTest(projectId, definition([...recording.steps, thanks]));
    const run = await waitForRun(await startRun(testCaseId, envId));
    expect(run.status, JSON.stringify(run.steps)).toBe('passed');
  });

  test('never stores a typed password; Enter submits once; replay works with a secret', async () => {
    const { projectId, envId } = await createProjectWithEnv();
    const { id, browser, page } = await startRecording(projectId, envId, '/login');

    await page.getByLabel('Username').pressSequentially('qa');
    await page.getByLabel('Password').pressSequentially('demo-password');
    await page.getByLabel('Password').press('Enter');
    await page.waitForURL(/\/account/);
    const recording = await stop(id, browser);

    expect(JSON.stringify(recording)).not.toContain('demo-password');
    expect(summary(recording)).toEqual([
      'navigate /login',
      'fill {"kind":"role","role":"textbox","name":"Username"} = qa',
      'fill {"kind":"role","role":"textbox","name":"Password"} = {{secrets.password}}',
      'press Enter {"kind":"role","role":"textbox","name":"Password"}',
    ]);
    expect(recording.warnings).toEqual([{ code: 'passwordField', stepId: recording.steps[2]?.id, count: 1 }]);

    expect((await api('POST', `/projects/${projectId}/secrets`, { name: 'password', value: 'demo-password' })).status).toBe(201);
    const signedIn = {
      id: 'who',
      name: 'Signed in',
      type: 'assertText',
      locator: { kind: 'testId', value: 'account-status' },
      expected: 'Signed in as qa',
      mode: 'exact',
    };
    const { testCaseId } = await createTest(projectId, definition([...recording.steps, signedIn]));
    const run = await waitForRun(await startRun(testCaseId, envId));
    expect(run.status, JSON.stringify(run.steps)).toBe('passed');
  });

  test('keeps recording across SPA route changes without extra "Open page" steps', async () => {
    const { projectId, envId } = await createProjectWithEnv();
    const { id, browser, page } = await startRecording(projectId, envId, '/spa');

    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/\/spa\/settings$/);
    await page.getByLabel('Display name').pressSequentially('Ada');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByTestId('saved')).toHaveText('Saved: Ada');
    const recording = await stop(id, browser);

    expect(recording.steps.map((s) => s.type)).toEqual(['navigate', 'click', 'fill', 'click']);
    const saved = {
      id: 'saved',
      name: 'Saved',
      type: 'assertText',
      locator: { kind: 'testId', value: 'saved' },
      expected: 'Saved: Ada',
      mode: 'exact',
    };
    const { testCaseId } = await createTest(projectId, definition([...recording.steps, saved]));
    const run = await waitForRun(await startRun(testCaseId, envId));
    expect(run.status, JSON.stringify(run.steps)).toBe('passed');
  });

  test('checks picked in the toolbar become steps; the picking click never reaches the page', async () => {
    const { projectId, envId } = await createProjectWithEnv();
    const { id, browser, page } = await startRecording(projectId, envId, '/spa');
    const toolbar = page.locator('flowcheck-recorder');

    await page.getByRole('button', { name: 'Create new' }).click();
    const dialog = page.getByRole('dialog', { name: 'New item' });
    await expect(dialog).toBeVisible();
    await toolbar.getByRole('button', { name: 'Check it is shown' }).click();
    await dialog.getByRole('heading', { name: 'New item' }).click();
    await toolbar.getByRole('button', { name: 'Check text' }).click();
    // Picking Close as the element to check must not close the dialog.
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeVisible();
    const recording = await stop(id, browser);

    expect(recording.steps.slice(1)).toEqual([
      expect.objectContaining({ type: 'click', locator: { kind: 'role', role: 'button', name: 'Create new' } }),
      expect.objectContaining({ type: 'assertVisible', locator: { kind: 'role', role: 'heading', name: 'New item' } }),
      expect.objectContaining({
        type: 'assertText',
        locator: { kind: 'role', role: 'button', name: 'Close' },
        expected: 'Close',
        mode: 'exact',
      }),
    ]);
    const { testCaseId } = await createTest(projectId, definition(recording.steps));
    const run = await waitForRun(await startRun(testCaseId, envId));
    expect(run.status, JSON.stringify(run.steps)).toBe('passed');
  });

  test('scopes an ambiguous button to its container instead of guessing', async () => {
    const { projectId, envId } = await createProjectWithEnv();
    const { id, browser, page } = await startRecording(projectId, envId, '/form');
    await page.locator('#top-bar').getByRole('button', { name: 'Search' }).click();
    const recording = await stop(id, browser);
    expect(recording.steps[1]).toMatchObject({
      type: 'click',
      locator: { kind: 'role', role: 'button', name: 'Search', within: { kind: 'id', value: 'top-bar' } },
    });
  });

  test('holds the execution lock: a run waits until the recording ends (criterion 24)', async () => {
    const { projectId, envId } = await createProjectWithEnv();
    const { testCaseId } = await createTest(projectId, definition([{ id: 'open', name: 'Open', type: 'navigate', url: '/' }]));
    const { id, browser } = await startRecording(projectId, envId, '/form');
    const runId = await startRun(testCaseId, envId);
    await new Promise((r) => setTimeout(r, 1500));
    expect((await api('GET', `/runs/${runId}`)).body.status).toBe('queued');
    await stop(id, browser);
    expect((await waitForRun(runId)).status).toBe('passed');
  });

  test('closing the recorder window stops the recording and keeps the draft (criterion 29)', async () => {
    const { projectId, envId } = await createProjectWithEnv();
    const { id, browser, page } = await startRecording(projectId, envId, '/form');
    await page.getByRole('button', { name: 'Account' }).click();
    await page.close();
    const recording = await waitForRecording(id, 'stopped');
    await browser.close().catch(() => undefined);
    expect(recording.steps.map((s) => s.type)).toEqual(['navigate', 'click']);
    expect(recording.warnings).toEqual([{ code: 'browserClosed', count: 1 }]);
  });

  test('the in-page Stop button stops the recording (toolbar in the UI language)', async () => {
    const { projectId, envId } = await createProjectWithEnv();
    const { id, browser, page } = await startRecording(projectId, envId, '/form', 'az');
    await page.getByLabel('Name').fill('Bob');
    await page.locator('flowcheck-recorder').getByRole('button', { name: 'Dayandır' }).click();
    const recording = await waitForRecording(id, 'stopped');
    await browser.close().catch(() => undefined);
    expect(summary(recording)).toEqual(['navigate /form', 'fill {"kind":"role","role":"textbox","name":"Name"} = Bob']);
  });
});

test('UI: steps are recorded from the editor, reviewed and added to the test as a draft', async ({ page }) => {
  const { projectId } = await createProjectWithEnv();
  const { testCaseId } = await createTest(projectId, definition([{ id: 'open', name: 'Open sign-up', type: 'navigate', url: '/form' }]));
  await page.goto(`${SERVER}/tests/${testCaseId}`);

  await page.getByTestId('phase-steps').getByRole('button', { name: 'Record steps' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Start at').fill('/form');
  const created = page.waitForResponse((r) => r.url().endsWith('/recordings') && r.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Open browser and record' }).click();
  const recordingId = ((await (await created).json()) as RecordingDto).id;
  open = recordingId;
  await expect(dialog.getByTestId('recording-status')).toContainText('Recording.', { timeout: 20_000 });

  const { browser, page: tester } = await attach(recordingId, '/form');
  await tester.getByRole('button', { name: 'Account' }).click();
  await expect(dialog.getByText('Click "Account"')).toBeVisible();
  await dialog.getByRole('button', { name: 'Stop recording' }).click();
  await expect(dialog.getByTestId('recording-status')).toContainText('Recording finished', { timeout: 20_000 });
  await browser.close().catch(() => undefined);

  // The test already opens the page, so the recorded "Open page" step is left out by default.
  await dialog.getByRole('button', { name: 'Add 1 step to the test' }).click();
  await expect(page.getByTestId('phase-steps').getByText('Click "Account"')).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Version 2')).toBeVisible();
  const revision = await api('GET', `/test-cases/${testCaseId}`);
  const saved = await api('GET', `/revisions/${revision.body.currentRevisionId}`);
  expect(saved.body.definition.steps.map((s: { type: string }) => s.type)).toEqual(['navigate', 'click']);
});

/** What the editor does with the default selection: request checks on the step, check steps after it. */
function withSuggestions(recording: RecordingDto) {
  const steps = [];
  for (const step of recording.steps) {
    const mine = recording.suggestions.filter((s) => s.stepId === step.id && s.selected);
    const checks = mine.flatMap((s) => (s.kind === 'networkCheck' ? [s.networkCheck] : []));
    steps.push(checks.length > 0 ? { ...step, networkChecks: checks } : step);
    for (const s of mine) if (s.kind === 'step') steps.push(s.step);
  }
  return steps;
}

test('suggests checks from what each action did; accepted as suggested they catch the create-order-500 bug', async () => {
  await setDemoMode('success');
  const { projectId, envId } = await createProjectWithEnv();
  const { id, browser, page } = await startRecording(projectId, envId, '/');
  await page.getByTestId('add-to-cart-p-1').click();
  await page.waitForTimeout(1500);
  await page.goto(`${DEMO}/cart`);
  await page.getByRole('button', { name: 'Place order' }).click();
  await expect(page.getByTestId('order-success')).toBeVisible();
  await page.waitForTimeout(1500);
  const recording = await stop(id, browser);
  // Opening /cart from the address bar is the tester's own navigation: an "Open" step, not a check.
  expect(recording.steps.map((s) => s.type)).toEqual(['navigate', 'click', 'navigate', 'click']);

  const describe = (s: RecordingDto['suggestions'][number]) =>
    s.kind === 'step'
      ? `${s.what} ${s.step.type} ${JSON.stringify('locator' in s.step ? s.step.locator : null)}`
      : `${s.what} ${s.networkCheck.match.method} ${s.networkCheck.match.pathname} ${JSON.stringify(s.networkCheck.assertions)}`;
  expect(recording.suggestions.map(describe)).toEqual([
    'message assertText {"kind":"testId","value":"add-status"}',
    'message assertVisible {"kind":"testId","value":"order-success"}',
    'request POST /api/cart/items [{"kind":"statusEquals","expected":201}]',
    'request POST /api/orders [{"kind":"statusEquals","expected":201},{"kind":"jsonExists","pointer":"/id"}]',
  ]);
  expect(recording.suggestions.every((s) => s.selected)).toBe(true);

  const { testCaseId } = await createTest(projectId, definition(withSuggestions(recording)));
  const passed = await waitForRun(await startRun(testCaseId, envId));
  expect(passed.status, JSON.stringify(passed.steps)).toBe('passed');

  await setDemoMode('create-order-500');
  const failed = await waitForRun(await startRun(testCaseId, envId));
  expect(failed.status).toBe('failed');
  expect(failed.failureSummary?.code).toBe('ASSERTION_FAILED');
  await setDemoMode('success');
});

test('suggests "window opened" for a dialog and the page address after a navigation', async () => {
  const { projectId, envId } = await createProjectWithEnv();
  const { id, browser, page } = await startRecording(projectId, envId, '/spa');
  await page.getByRole('button', { name: 'Create new' }).click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.waitForTimeout(1500);
  const recording = await stop(id, browser);
  expect(recording.suggestions.map((s) => (s.kind === 'step' ? `${s.what}:${s.step.type}` : s.what))).toEqual([
    'dialog:assertVisible',
    'url:assertUrl',
    'heading:assertVisible',
  ]);
  expect(recording.suggestions[0]).toMatchObject({ step: { locator: { kind: 'role', role: 'dialog', name: 'New item' } } });
  expect(recording.suggestions[1]).toMatchObject({ step: { expected: '/spa/settings' } });

  const { testCaseId } = await createTest(projectId, definition(withSuggestions(recording)));
  const run = await waitForRun(await startRun(testCaseId, envId));
  expect(run.status, JSON.stringify(run.steps)).toBe('passed');
});

test('UI: suggested checks are shown ticked under their step and added with the steps', async ({ page }) => {
  const { projectId } = await createProjectWithEnv();
  const { testCaseId } = await createTest(projectId, definition([{ id: 'open', name: 'Open app', type: 'navigate', url: '/spa' }]));
  await page.goto(`${SERVER}/tests/${testCaseId}`);
  await page.getByTestId('phase-steps').getByRole('button', { name: 'Record steps' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Start at').fill('/spa');
  const created = page.waitForResponse((r) => r.url().endsWith('/recordings') && r.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Open browser and record' }).click();
  const recordingId = ((await (await created).json()) as RecordingDto).id;
  open = recordingId;
  await expect(dialog.getByTestId('recording-status')).toContainText('Recording.', { timeout: 20_000 });

  const { browser, page: tester } = await attach(recordingId, '/spa');
  await tester.getByRole('button', { name: 'Create new' }).click();
  const suggestion = dialog.getByLabel(/Window opened: Check "New item" is shown/);
  await expect(suggestion).toBeChecked({ timeout: 10_000 });
  await dialog.getByRole('button', { name: 'Stop recording' }).click();
  await expect(dialog.getByTestId('recording-status')).toContainText('Recording finished', { timeout: 20_000 });
  await browser.close().catch(() => undefined);

  await dialog.getByRole('button', { name: 'Add 2 steps to the test' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Version 2')).toBeVisible();
  const testCase = await api('GET', `/test-cases/${testCaseId}`);
  const saved = await api('GET', `/revisions/${testCase.body.currentRevisionId}`);
  expect(saved.body.definition.steps.map((s: { type: string }) => s.type)).toEqual(['navigate', 'click', 'assertVisible']);
});
