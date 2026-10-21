import {
  type AssertTextStep,
  type AssertUrlStep,
  describeLocator,
  type Locator,
  type PressStep,
  parseKeyCombination,
  type SelectOptionStep,
} from '@flowcheck/shared';
import { errors, type Page, type Locator as PwLocator } from 'playwright';
import { StepError, StepFailure } from './errors.ts';
import { resolveSingle, toPlaywrightLocator } from './locator.ts';
import { redactText } from './redact.ts';
import { resolveString, type VariableScope } from './variables.ts';

/**
 * Browser steps beyond navigate/click/fill/assertVisible (PROJECT_RULES §6).
 * Assertions retry until the step deadline, like Playwright's web-first assertions, and report
 * the last observed value when they give up.
 */

export interface UiStepContext {
  page: Page;
  scope: VariableScope;
  deadline: number;
}

export interface UiStepResult {
  expected: unknown;
  actual: unknown;
}

const POLL_MS = 100;
/** A single read of an already-found element never gets less than this, even at the deadline. */
const MIN_READ_MS = 500;
const remaining = (deadline: number) => Math.max(1, deadline - Date.now());
const readTimeout = (deadline: number) => Math.max(MIN_READ_MS, deadline - Date.now());
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Re-reads `observe` until `ok` holds or the deadline passes; returns the last observation.
 * A read that times out after the deadline ends the wait with the last value seen, so a slow
 * final read is reported as an unmet expectation, not as an internal error.
 */
async function pollUntil<T>(
  deadline: number,
  observe: () => Promise<T>,
  ok: (value: T) => boolean,
): Promise<{ value: T; passed: boolean }> {
  let last: { value: T } | undefined;
  for (;;) {
    try {
      const value = await observe();
      last = { value };
      if (ok(value)) return { value, passed: true };
    } catch (error) {
      if (!(error instanceof errors.TimeoutError) || Date.now() < deadline) throw error;
    }
    if (Date.now() >= deadline) {
      if (last) return { value: last.value, passed: false };
      throw new StepError('LOCATOR_NOT_FOUND', 'The element disappeared before it could be checked');
    }
    await sleep(POLL_MS);
  }
}

export function normalizeText(text: string, normalizeWhitespace: boolean): string {
  return normalizeWhitespace ? text.replace(/\s+/g, ' ').trim() : text;
}

export function textMatches(actual: string, expected: string, mode: 'exact' | 'contains'): boolean {
  return mode === 'exact' ? actual === expected : actual.includes(expected);
}

/**
 * Compares the current page URL with an expectation. Hash is ignored; with query "include" the
 * query parameters must be equal as a set of key/value pairs (order does not matter).
 */
export function urlMatches(actualHref: string, expected: string, match: 'pathname' | 'fullUrl', query: 'ignore' | 'include'): boolean {
  const actual = new URL(actualHref);
  const want = new URL(expected, actual.origin);
  if (match === 'fullUrl' && want.origin !== actual.origin) return false;
  if (want.pathname !== actual.pathname) return false;
  if (query === 'ignore') return true;
  const pairs = (u: URL) => [...u.searchParams.entries()].map(([k, v]) => `${k}=${v}`).sort();
  return JSON.stringify(pairs(want)) === JSON.stringify(pairs(actual));
}

async function runAction(action: () => Promise<unknown>, verb: string): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (error instanceof errors.TimeoutError) {
      const firstLine = error.message.split('\n')[0] ?? error.message;
      throw new StepError('ACTION_FAILED', `Could not ${verb} before the timeout (not visible, disabled or covered): ${firstLine}`);
    }
    throw error;
  }
}

export async function assertText(step: AssertTextStep, ctx: UiStepContext): Promise<UiStepResult> {
  const normalize = step.normalizeWhitespace ?? true;
  const expected = normalizeText(resolveString(step.expected, ctx.scope, 'expected text'), normalize);
  const target = await resolveSingle(ctx.page, step.locator, ctx.deadline);
  const { value, passed } = await pollUntil(
    ctx.deadline,
    async () => normalizeText(await target.innerText({ timeout: readTimeout(ctx.deadline) }), normalize),
    (text) => textMatches(text, expected, step.mode),
  );
  const secrets = ctx.scope.secretValues();
  const evidence = {
    expected: { locator: step.locator, mode: step.mode, text: redactText(expected, secrets), normalizeWhitespace: normalize },
    // An empty string is reported as such: the element exists but has no text.
    actual: { text: redactText(value, secrets) },
  };
  if (!passed) {
    const how = step.mode === 'exact' ? 'is not exactly' : 'does not contain';
    throw new StepFailure(new StepError('ASSERTION_FAILED', `Text of ${describeLocator(step.locator)} ${how} the expected text`), evidence);
  }
  return evidence;
}

export async function assertHidden(locator: Locator, ctx: UiStepContext): Promise<UiStepResult> {
  const target = toPlaywrightLocator(ctx.page, locator);
  // Every match is inspected: the step passes only if none of them is visible.
  const { value, passed } = await pollUntil(
    ctx.deadline,
    async () => {
      const count = await target.count();
      let visible = 0;
      for (let i = 0; i < count; i++) if (await target.nth(i).isVisible()) visible++;
      return { matches: count, visible };
    },
    (state) => state.visible === 0,
  );
  const evidence = { expected: { locator, visibleMatches: 0 }, actual: value };
  if (!passed) {
    throw new StepFailure(
      new StepError('ASSERTION_FAILED', `${value.visible} of ${value.matches} element(s) matching ${describeLocator(locator)} are visible`),
      evidence,
    );
  }
  return evidence;
}

export async function assertValue(locator: Locator, expectedTemplate: string, ctx: UiStepContext): Promise<UiStepResult> {
  const expected = resolveString(expectedTemplate, ctx.scope, 'expected value');
  const target = await resolveSingle(ctx.page, locator, ctx.deadline);
  let value: string;
  let passed: boolean;
  try {
    ({ value, passed } = await pollUntil(
      ctx.deadline,
      () => target.inputValue({ timeout: readTimeout(ctx.deadline) }),
      (v) => v === expected,
    ));
  } catch (error) {
    if (error instanceof Error && /not an <input>|Not an input/i.test(error.message)) {
      throw new StepError('ACTION_FAILED', `${describeLocator(locator)} is not an input, textarea or select, so it has no value`);
    }
    throw error;
  }
  const secrets = ctx.scope.secretValues();
  const evidence = { expected: { locator, value: redactText(expected, secrets) }, actual: { value: redactText(value, secrets) } };
  if (!passed)
    throw new StepFailure(
      new StepError('ASSERTION_FAILED', `Value of ${describeLocator(locator)} differs from the expected value`),
      evidence,
    );
  return evidence;
}

export async function assertEnabled(locator: Locator, ctx: UiStepContext): Promise<UiStepResult> {
  const target = await resolveSingle(ctx.page, locator, ctx.deadline);
  const { value, passed } = await pollUntil(
    ctx.deadline,
    () => target.isEnabled({ timeout: readTimeout(ctx.deadline) }),
    (enabled) => enabled,
  );
  const evidence = { expected: { locator, enabled: true }, actual: { enabled: value } };
  if (!passed) throw new StepFailure(new StepError('ASSERTION_FAILED', `${describeLocator(locator)} is disabled`), evidence);
  return evidence;
}

export async function assertUrl(step: AssertUrlStep, ctx: UiStepContext): Promise<UiStepResult> {
  const expected = resolveString(step.expected, ctx.scope, 'expected URL');
  const { value, passed } = await pollUntil(
    ctx.deadline,
    async () => ctx.page.url(),
    (href) => urlMatches(href, expected, step.match, step.query),
  );
  const evidence = { expected: { url: expected, match: step.match, query: step.query }, actual: { url: value } };
  if (!passed) throw new StepFailure(new StepError('ASSERTION_FAILED', `Page URL ${value} does not match ${expected}`), evidence);
  return evidence;
}

export async function selectOption(step: SelectOptionStep, ctx: UiStepContext): Promise<UiStepResult> {
  const value = resolveString(step.option.value, ctx.scope, 'option');
  const target = await resolveSingle(ctx.page, step.locator, ctx.deadline);
  let selected: string[] = [];
  await runAction(async () => {
    selected = await target.selectOption(step.option.by === 'label' ? { label: value } : { value }, { timeout: remaining(ctx.deadline) });
  }, `select option ${step.option.by} "${value}"`);
  return { expected: { locator: step.locator, option: { by: step.option.by, value } }, actual: { selectedValues: selected } };
}

export async function setChecked(locator: Locator, checked: boolean, ctx: UiStepContext): Promise<UiStepResult> {
  const target: PwLocator = await resolveSingle(ctx.page, locator, ctx.deadline);
  await runAction(
    () => (checked ? target.check({ timeout: remaining(ctx.deadline) }) : target.uncheck({ timeout: remaining(ctx.deadline) })),
    checked ? 'check the element' : 'uncheck the element',
  );
  return { expected: { locator, checked }, actual: { checked: await target.isChecked() } };
}

export async function press(step: PressStep, ctx: UiStepContext): Promise<UiStepResult> {
  const parsed = parseKeyCombination(step.key);
  if (!parsed.ok) throw new StepError('UNSUPPORTED_KEYBOARD_COMBINATION', parsed.message, {}, 'error');
  if (step.locator) {
    const target = await resolveSingle(ctx.page, step.locator, ctx.deadline);
    await runAction(() => target.press(parsed.combination, { timeout: remaining(ctx.deadline) }), `press ${parsed.combination}`);
  } else {
    await ctx.page.keyboard.press(parsed.combination);
  }
  return { expected: { key: parsed.combination, locator: step.locator ?? 'page' }, actual: { pressed: true, url: ctx.page.url() } };
}
