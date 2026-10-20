import { type ApiRequestStep, type EnvironmentSnapshot, MUTATING_HTTP_METHODS, type Step } from '@flowcheck/shared';
import { type APIRequestContext, type APIResponse, type BrowserContext, errors, type Page, request } from 'playwright';
import { StepError, type StepExecution, StepFailure } from './errors.ts';
import { resolveSingle } from './locator.ts';
import { redactHeaders, redactJson, redactText, toPersistedBody } from './redact.ts';
import { type AssertionResult, evaluateResponseAssertions } from './response-assertions.ts';
import type { BlockedRequest } from './target-guard.ts';
import { assertEnabled, assertHidden, assertText, assertUrl, assertValue, press, selectOption, setChecked } from './ui-steps.ts';
import { assertTargetAllowed, buildApiUrl, buildNavigateUrl, type TargetPolicy } from './url-policy.ts';
import { resolveJson, resolveString, type VariableScope } from './variables.ts';

export interface StepContext {
  page: Page;
  context: BrowserContext;
  environment: EnvironmentSnapshot;
  policy: TargetPolicy;
  scope: VariableScope;
  blocked: BlockedRequest[];
  /** Absolute epoch ms by which the step must finish. */
  deadline: number;
}

export { type StepExecution, StepFailure };

/** Every step that works on the page; a screenshot is taken when one of them fails. */
export const UI_STEP_TYPES: ReadonlySet<Step['type']> = new Set([
  'navigate',
  'click',
  'fill',
  'assertVisible',
  'assertText',
  'assertHidden',
  'assertValue',
  'assertEnabled',
  'assertUrl',
  'selectOption',
  'check',
  'uncheck',
  'press',
]);

function remaining(ctx: StepContext): number {
  return Math.max(1, ctx.deadline - Date.now());
}

export async function executeStep(step: Step, ctx: StepContext): Promise<StepExecution> {
  switch (step.type) {
    case 'navigate':
      return navigate(step.url, ctx);
    case 'click': {
      const target = await resolveSingle(ctx.page, step.locator, ctx.deadline);
      await runAction(() => target.click({ timeout: remaining(ctx) }), 'click');
      return { expected: { locator: step.locator }, actual: { clicked: true, url: ctx.page.url() } };
    }
    case 'fill': {
      const value = resolveString(step.value, ctx.scope, 'fill value');
      const target = await resolveSingle(ctx.page, step.locator, ctx.deadline);
      await runAction(() => target.fill(value, { timeout: remaining(ctx) }), 'fill');
      return {
        expected: { locator: step.locator, value: redactText(value, ctx.scope.secretValues()) },
        actual: { filled: true },
      };
    }
    case 'assertVisible': {
      const target = await resolveSingle(ctx.page, step.locator, ctx.deadline);
      try {
        await target.waitFor({ state: 'visible', timeout: remaining(ctx) });
      } catch (error) {
        if (error instanceof errors.TimeoutError) {
          throw new StepError('ASSERTION_FAILED', 'Element exists but did not become visible before the timeout');
        }
        throw error;
      }
      return { expected: { locator: step.locator, visible: true }, actual: { visible: true } };
    }
    case 'assertText':
      return assertText(step, ctx);
    case 'assertHidden':
      return assertHidden(step.locator, ctx);
    case 'assertValue':
      return assertValue(step.locator, step.expected, ctx);
    case 'assertEnabled':
      return assertEnabled(step.locator, ctx);
    case 'assertUrl':
      return assertUrl(step, ctx);
    case 'selectOption':
      return selectOption(step, ctx);
    case 'check':
      return setChecked(step.locator, true, ctx);
    case 'uncheck':
      return setChecked(step.locator, false, ctx);
    case 'press':
      return press(step, ctx);
    case 'apiRequest':
      return apiRequest(step, ctx);
  }
}

/** What a step checks or targets, for reports of steps that failed before producing evidence. */
export function expectedOf(step: Step): unknown {
  switch (step.type) {
    case 'navigate':
      return { url: step.url };
    case 'click':
    case 'fill':
      return { locator: step.locator, matches: 1 };
    case 'assertVisible':
      return { locator: step.locator, matches: 1, visible: true };
    case 'assertText':
      return { locator: step.locator, mode: step.mode, text: step.expected };
    case 'assertHidden':
      return { locator: step.locator, visibleMatches: 0 };
    case 'assertValue':
      return { locator: step.locator, value: step.expected };
    case 'assertEnabled':
      return { locator: step.locator, enabled: true };
    case 'assertUrl':
      return { url: step.expected, match: step.match, query: step.query };
    case 'selectOption':
      return { locator: step.locator, option: step.option };
    case 'check':
    case 'uncheck':
      return { locator: step.locator, checked: step.type === 'check' };
    case 'press':
      return { key: step.key, locator: step.locator ?? 'page' };
    case 'apiRequest':
      return { method: step.method, path: step.path, assertions: step.assertions };
  }
}

async function runAction(action: () => Promise<void>, verb: string): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (error instanceof errors.TimeoutError) {
      throw new StepError(
        'ACTION_FAILED',
        `Could not ${verb} the element before the timeout (not visible, disabled or covered): ${firstLine(error)}`,
      );
    }
    throw error;
  }
}

async function navigate(target: string, ctx: StepContext): Promise<StepExecution> {
  const url = buildNavigateUrl(ctx.environment.frontendBaseUrl, resolveString(target, ctx.scope, 'URL'));
  await assertTargetAllowed(url, ctx.policy);
  const blockedBefore = ctx.blocked.length;
  const expected = { url: url.href };
  try {
    const response = await ctx.page.goto(url.href, { timeout: remaining(ctx), waitUntil: 'load' });
    return { expected, actual: { url: ctx.page.url(), status: response?.status() ?? null } };
  } catch (error) {
    // A navigation stopped by the target guard (e.g. redirect to a foreign origin) is reported as such.
    const blocked = ctx.blocked.slice(blockedBefore)[0];
    if (blocked) throw new StepError(blocked.code, `Navigation blocked: ${blocked.reason} (${blocked.url})`);
    if (error instanceof errors.TimeoutError) {
      throw new StepError('NETWORK_TIMEOUT', `Page did not finish loading before the timeout: ${url.href}`);
    }
    if (error instanceof Error && /net::ERR_/.test(error.message)) {
      throw new StepError('NETWORK_ERROR', `Navigation failed: ${firstLine(error)}`);
    }
    throw error;
  }
}

async function apiRequest(step: ApiRequestStep, ctx: StepContext): Promise<StepExecution> {
  const secrets = ctx.scope.secretValues();
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(step.query ?? {})) query[key] = resolveString(value, ctx.scope, `query ${key}`);
  const url = buildApiUrl(ctx.environment.apiBaseUrl, resolveString(step.path, ctx.scope, 'path'), query);
  await assertTargetAllowed(url, ctx.policy);

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(step.headers ?? {})) headers[key] = resolveString(value, ctx.scope, `header ${key}`);
  let body: string | undefined;
  if (step.body !== undefined) {
    body = JSON.stringify(resolveJson(step.body, ctx.scope));
    if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) headers['content-type'] = 'application/json';
  }

  const requestEvidence = {
    method: step.method,
    url: url.href,
    headers: redactHeaders(headers, secrets),
    body: body === undefined ? null : redactText(body, secrets),
  };
  const expected = { assertions: step.assertions };

  const auth = step.auth ?? { kind: 'browserCookies' };
  let client: APIRequestContext;
  let dispose = false;
  if (auth.kind === 'browserCookies') {
    client = ctx.context.request;
  } else {
    client = await request.newContext();
    dispose = true;
  }

  const startedAt = Date.now();
  let response: APIResponse;
  try {
    response = await client.fetch(url.href, {
      method: step.method,
      headers,
      ...(body === undefined ? {} : { data: body }),
      timeout: remaining(ctx),
      // Redirects are returned as responses: following them could leave the allowlist.
      maxRedirects: 0,
      failOnStatusCode: false,
    });
  } catch (error) {
    const isTimeout = error instanceof errors.TimeoutError || /timed? ?out/i.test(String(error));
    throw new StepFailure(new StepError(isTimeout ? 'NETWORK_TIMEOUT' : 'NETWORK_ERROR', `No HTTP response: ${firstLine(error)}`), {
      expected,
      actual: { request: requestEvidence, response: null, durationMs: Date.now() - startedAt },
    });
  } finally {
    if (dispose) await client.dispose().catch(() => undefined);
  }

  const responseHeaders: Record<string, string> = {};
  for (const { name, value } of response.headersArray()) {
    const key = name.toLowerCase();
    responseHeaders[key] = responseHeaders[key] === undefined ? value : `${responseHeaders[key]}, ${value}`;
  }
  const responseBody = await response.body();
  const results = evaluateResponseAssertions(
    step.assertions,
    { status: response.status(), headers: responseHeaders, body: responseBody },
    ctx.scope,
  );

  const actual = {
    request: requestEvidence,
    response: {
      status: response.status(),
      headers: redactHeaders(responseHeaders, secrets),
      body: toPersistedBody(responseBody, responseHeaders['content-type'], secrets),
    },
    assertions: results.map((r) => redactJson({ ...r, assertion: r.assertion.kind }, secrets)),
    durationMs: Date.now() - startedAt,
    warnings: hasStatusAssertion(step) ? [] : ['No expected status configured: the HTTP status was not checked.'],
    retried: false,
    mutating: (MUTATING_HTTP_METHODS as readonly string[]).includes(step.method),
  };

  const failure = firstFailure(results);
  if (failure) throw new StepFailure(failure, { expected, actual });
  return { expected, actual };
}

function hasStatusAssertion(step: ApiRequestStep): boolean {
  return step.assertions.some((a) => a.kind === 'statusEquals' || a.kind === 'statusIn');
}

function firstFailure(results: AssertionResult[]): StepError | null {
  const formatError = results.find((r) => r.errorCode !== undefined);
  if (formatError?.errorCode) return new StepError(formatError.errorCode, formatError.message);
  const failed = results.filter((r) => !r.passed);
  if (failed.length === 0) return null;
  return new StepError('ASSERTION_FAILED', failed.map((r) => r.message).join('; '), { failedAssertions: failed.length });
}

export function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split('\n')[0] ?? message;
}
