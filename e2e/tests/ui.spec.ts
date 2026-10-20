import { expect, type Page, test } from '@playwright/test';
import { createProjectWithEnv, createTest, DEMO, definition, SERVER, setDemoMode } from './helpers.ts';

/**
 * Drives the real web UI (served by the FlowCheck server) the way a tester would.
 * The run itself is executed by the real runner against the demo shop. The browser locale is
 * English, so the UI is in English.
 */

async function addStep(page: Page, type: RegExp) {
  await page.getByTestId('phase-steps').getByRole('button', { name: 'Add step' }).click();
  await page.getByRole('dialog').getByRole('button', { name: type }).click();
}

test('a tester follows the getting-started guide, builds a test, runs it and sees it pass', async ({ page }) => {
  await setDemoMode('success');
  await page.goto(SERVER);

  await page
    .getByRole('button', { name: /New project|Create your first project/ })
    .first()
    .click();
  await page.getByRole('dialog').getByLabel('Name').fill(`UI project ${Date.now()}`);
  await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();

  // Step 1 of the guide: add the website.
  await expect(page.getByText('Getting started')).toBeVisible();
  await page.getByRole('button', { name: 'Add website' }).first().click();
  const envDialog = page.getByRole('dialog');
  await envDialog.getByLabel('Website address').fill(DEMO);
  // A local address is detected: the advanced settings open with a warning.
  await expect(envDialog.getByText('This looks like a local or internal address')).toBeVisible();
  await envDialog.getByLabel('API address (optional)').fill(`${DEMO}/api`);
  await envDialog.getByRole('switch', { name: 'Allow private network' }).click();
  await envDialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(`${DEMO}/api`)).toBeVisible();

  // Step 2: create a test from a template.
  await page.getByRole('button', { name: 'New test' }).first().click();
  const testDialog = page.getByRole('dialog');
  await testDialog.getByText('Blank', { exact: true }).click();
  await testDialog.getByLabel('Test name (optional)').fill('Add a mug to the cart');
  await testDialog.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('Version 1')).toBeVisible();

  await addStep(page, /^Click/);
  const click = page.getByTestId('step-steps-1');
  await click.getByLabel('Step name').fill('Add Blue Mug');
  await click.getByLabel('Element', { exact: true }).fill('add-to-cart-p-1');

  await addStep(page, /^Check it is shown/);
  const check = page.getByTestId('step-steps-2');
  await check.getByLabel('Step name').fill('Confirmation is shown');
  await check.getByLabel('Find the element by').selectOption('text');
  await check.getByLabel('Element', { exact: true }).fill('Blue Mug added to cart');
  await expect(check.getByText('· text "Blue Mug added to cart"')).toBeVisible();

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Version 2')).toBeVisible();

  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByText('This test will send real requests')).toBeVisible();
  await page.getByRole('button', { name: 'Start run' }).click();

  await expect(page.getByRole('heading', { name: 'Run result' })).toBeVisible();
  await expect(page.locator('h1 + span', { hasText: 'Passed' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Add Blue Mug')).toBeVisible();
  await expect(page.getByText('Confirmation is shown')).toBeVisible();
});

test('the login template creates editable example steps', async ({ page }) => {
  const { projectId } = await createProjectWithEnv();
  await page.goto(`${SERVER}/projects/${projectId}`);
  await page.getByRole('button', { name: 'New test' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click(); // "Login" is preselected
  await expect(page.getByText('Version 1')).toBeVisible();
  await expect(page.getByTestId('phase-steps').getByText('· open /login')).toBeVisible();
  await expect(page.getByTestId('phase-steps').getByText('· element "Log in"')).toBeVisible();
});

test('a failing run explains what to check and shows a screenshot', async ({ page }) => {
  await setDemoMode('create-order-500');
  const { projectId, envId } = await createProjectWithEnv();
  const { testCaseId } = await createTest(
    projectId,
    definition([
      { id: 'open', name: 'Open shop', type: 'navigate', url: '/' },
      { id: 'add', name: 'Add mug', type: 'click', locator: { kind: 'testId', value: 'add-to-cart-p-1' } },
      { id: 'added', name: 'Added', type: 'assertVisible', locator: { kind: 'text', value: 'Blue Mug added to cart', exact: true } },
      { id: 'cart', name: 'Open cart', type: 'navigate', url: '/cart' },
      { id: 'place', name: 'Place order', type: 'click', locator: { kind: 'testId', value: 'place-order' } },
      {
        id: 'success',
        name: 'Order success message',
        type: 'assertVisible',
        locator: { kind: 'testId', value: 'order-success' },
        timeoutMs: 3000,
      },
    ]),
  );
  expect(envId).toBeTruthy();

  await page.goto(`${SERVER}/tests/${testCaseId}`);
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await page.getByRole('button', { name: 'Start run' }).click();

  await expect(page.locator('h1 + span', { hasText: 'Failed' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('ASSERTION_FAILED').first()).toBeVisible();
  await expect(page.getByText('Things to check')).toBeVisible();
  // The failed step opens automatically and shows its screenshot.
  const screenshot = page.getByRole('img', { name: 'Screenshot: Order success message' });
  await expect(screenshot).toBeVisible();
  expect(await screenshot.evaluate((img: { naturalWidth: number }) => img.naturalWidth)).toBeGreaterThan(0);
});

test('unsaved changes are not lost silently when leaving the editor', async ({ page }) => {
  const { projectId } = await createProjectWithEnv();
  const { testCaseId } = await createTest(projectId, definition([{ id: 'open', name: 'Open', type: 'navigate', url: '/' }]));
  await page.goto(`${SERVER}/tests/${testCaseId}`);
  await page.getByLabel('Test name', { exact: true }).fill('Changed name');
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeDisabled();

  let prompted = false;
  page.once('dialog', async (dialog) => {
    prompted = true;
    await dialog.dismiss(); // stay on the page
  });
  await page.getByRole('link', { name: 'Tests' }).click();
  await expect.poll(() => prompted).toBe(true);
  await expect(page.getByLabel('Test name', { exact: true })).toHaveValue('Changed name');
});

test('validation errors are shown on the field', async ({ page }) => {
  const { projectId } = await createProjectWithEnv();
  const { testCaseId } = await createTest(projectId, definition([{ id: 'open', name: 'Open', type: 'navigate', url: '/' }]));
  await page.goto(`${SERVER}/tests/${testCaseId}`);
  await addStep(page, /^API request/);
  const step = page.getByTestId('step-steps-1');
  await step.getByLabel('Path').fill('//evil.example/x');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(step.getByText('API path must start with a single "/"').first()).toBeVisible();
  await expect(page.getByText('Version 1')).toBeVisible();
});

test('the UI can be switched to Azerbaijani', async ({ page }) => {
  await page.goto(SERVER);
  await page.getByLabel('Language').selectOption('az');
  await expect(page.getByRole('heading', { name: 'Layihələr' })).toBeVisible();
  await page.getByLabel('Dil').selectOption('en');
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
});

test('a project can be deleted only after typing its name', async ({ page }) => {
  const { projectId } = await createProjectWithEnv();
  const project = (await (await fetch(`${SERVER}/api/projects/${projectId}`)).json()) as { name: string };
  await page.goto(`${SERVER}/projects/${projectId}`);
  await page.getByRole('button', { name: 'Delete project' }).click();
  const dialog = page.getByRole('dialog');
  const confirm = dialog.getByRole('button', { name: 'Delete permanently' });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel(/Type the project name/).fill('wrong name');
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel(/Type the project name/).fill(project.name);
  await confirm.click();
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  expect((await fetch(`${SERVER}/api/projects/${projectId}`)).status).toBe(404);
});

test('new step types can be added in the editor and pass against the demo form', async ({ page }) => {
  const { projectId } = await createProjectWithEnv();
  const { testCaseId } = await createTest(projectId, definition([{ id: 'open', name: 'Open form', type: 'navigate', url: '/form' }]));
  await page.goto(`${SERVER}/tests/${testCaseId}`);

  const byLabel = async (index: number, labelText: string) => {
    const step = page.getByTestId(`step-steps-${index}`);
    await step.getByLabel('Find the element by').selectOption('label');
    await step.getByLabel('Element', { exact: true }).fill(labelText);
    return step;
  };

  await addStep(page, /^Choose from list/);
  const select = await byLabel(1, 'Country');
  await select.getByLabel('Option', { exact: true }).fill('Azerbaijan');

  await addStep(page, /^Tick checkbox/);
  await byLabel(2, 'I agree to the terms');

  await addStep(page, /^Check it is enabled/);
  const enabled = page.getByTestId('step-steps-3');
  await enabled.getByLabel('Find the element by').selectOption('role');
  await enabled.getByLabel('Exact name (text on it)').fill('Sign up');

  await addStep(page, /^Press key/);
  await byLabel(4, 'Name');

  await addStep(page, /^Check page address/);
  await page.getByTestId('step-steps-5').getByLabel('Expected address').fill('/done');

  await addStep(page, /^Check text/);
  const text = page.getByTestId('step-steps-6');
  await text.getByLabel('Find the element by').selectOption('testId');
  await text.getByLabel('Element', { exact: true }).fill('summary');
  await text.getByLabel('Expected text').fill('Country: az');

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Version 2')).toBeVisible();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await page.getByRole('button', { name: 'Start run' }).click();
  await expect(page.locator('h1 + span', { hasText: 'Passed' })).toBeVisible({ timeout: 30_000 });
});
