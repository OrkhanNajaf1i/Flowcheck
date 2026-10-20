import type { EnvironmentSnapshot, NetworkCheck } from '@flowcheck/shared';
import type { Page, Request, Response } from 'playwright';
import { StepError, StepFailure } from './errors.ts';
import { extractOutputs } from './outputs.ts';
import { redactHeaders, redactJson, redactText, toPersistedBody } from './redact.ts';
import { evaluateResponseAssertions } from './response-assertions.ts';
import type { TargetPolicy } from './url-policy.ts';
import { type Primitive, resolveString, type VariableScope } from './variables.ts';

/**
 * Network checks bound to a UI action (PROJECT_RULES §10).
 *
 * 1. The request listener is attached BEFORE the action, so a fast response is never missed and
 *    requests that started before the action are never attributed to it.
 * 2. Requests are matched by origin, method, exact pathname and selected query parameters —
 *    never by status, so a 500 is "the matching request failed its status check", not "no response".
 * 3. After the response, a 500 ms window looks for duplicates → AMBIGUOUS_NETWORK_MATCH. This
 *    does not exclude every later duplicate.
 * 4. Requests are only observed; nothing is ever re-sent.
 */

export const DEFAULT_NETWORK_CHECK_TIMEOUT_MS = 10_000;
export const DUPLICATE_WINDOW_MS = 500;
const POLL_MS = 25;
const MAX_UNMATCHED_SHOWN = 15;

export interface ResolvedMatcher {
  origin: string;
  method: string;
  pathname: string;
  query: Record<string, string>;
}

export function resolveNetworkOrigin(
  origin: NetworkCheck['match']['origin'],
  env: Pick<EnvironmentSnapshot, 'apiBaseUrl' | 'frontendBaseUrl'>,
): string {
  if (origin === 'api') return new URL(env.apiBaseUrl).origin;
  if (origin === 'frontend') return new URL(env.frontendBaseUrl).origin;
  return new URL(origin).origin;
}

/** Pure matcher: origin, method and pathname must be equal; listed query parameters must be present with that value. */
export function requestMatches(url: string, method: string, matcher: ResolvedMatcher): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.origin !== matcher.origin || method.toUpperCase() !== matcher.method || parsed.pathname !== matcher.pathname) return false;
  return Object.entries(matcher.query).every(([key, value]) => parsed.searchParams.getAll(key).includes(value));
}

interface Watch {
  check: NetworkCheck;
  matcher: ResolvedMatcher;
  matches: { request: Request; at: number }[];
}

export interface NetworkCheckResult {
  id: string;
  name: string;
  expected: unknown;
  actual: unknown;
  outputs: Record<string, Primitive>;
}

/** Starts observing; call before the action. `collect()` evaluates; `stop()` must always run. */
export function startNetworkWatch(
  page: Page,
  checks: readonly NetworkCheck[],
  ctx: { environment: EnvironmentSnapshot; policy: TargetPolicy; scope: VariableScope },
) {
  const startedAt = Date.now();
  const watches: Watch[] = checks.map((check) => {
    const origin = resolveNetworkOrigin(check.match.origin, ctx.environment);
    if (!ctx.policy.allowedOrigins.includes(origin)) {
      throw new StepError(
        'ORIGIN_NOT_ALLOWED',
        `Network check "${check.name}": origin ${origin} is not in the allowed origins of this environment`,
      );
    }
    const query: Record<string, string> = {};
    for (const [key, value] of Object.entries(check.match.query ?? {})) query[key] = resolveString(value, ctx.scope, `query ${key}`);
    return {
      check,
      matcher: { origin, method: check.match.method, pathname: resolveString(check.match.pathname, ctx.scope, 'path'), query },
      matches: [],
    };
  });
  const seen: { method: string; url: string }[] = [];
  const onRequest = (request: Request) => {
    const at = Date.now();
    if (seen.length < 200) seen.push({ method: request.method(), url: request.url() });
    for (const watch of watches) {
      if (requestMatches(request.url(), request.method(), watch.matcher)) watch.matches.push({ request, at });
    }
  };
  page.on('request', onRequest);

  return {
    stop: () => page.off('request', onRequest),
    /** Evaluates every check after the action finished; throws StepFailure on the first failing one. */
    async collect(): Promise<NetworkCheckResult[]> {
      const results: NetworkCheckResult[] = [];
      for (const watch of watches) {
        results.push(await evaluate(watch, startedAt, seen, ctx.scope, results));
      }
      return results;
    },
  };
}

async function evaluate(
  watch: Watch,
  startedAt: number,
  seen: { method: string; url: string }[],
  scope: VariableScope,
  previous: NetworkCheckResult[],
): Promise<NetworkCheckResult> {
  const { check, matcher } = watch;
  const secrets = scope.secretValues();
  const deadline = startedAt + (check.timeoutMs ?? DEFAULT_NETWORK_CHECK_TIMEOUT_MS);
  const expected = { match: matcher, assertions: check.assertions, outputs: check.outputs ?? [] };
  const fail = (error: StepError, actual: unknown): never => {
    throw new StepFailure(error, {
      expected: { networkChecks: [...previous.map((r) => r.expected), expected] },
      actual: { networkChecks: [...previous.map((r) => r.actual), { id: check.id, name: check.name, ...((actual as object) ?? {}) }] },
    });
  };

  while (watch.matches.length === 0 && Date.now() < deadline) await sleep(POLL_MS);
  const first = watch.matches[0];
  if (!first) {
    const observed = seen.slice(0, MAX_UNMATCHED_SHOWN).map((r) => `${r.method} ${redactText(r.url, secrets)}`);
    return fail(
      new StepError(
        'NETWORK_TIMEOUT',
        `Network check "${check.name}": no ${matcher.method} request to ${matcher.origin}${matcher.pathname} was sent after the action`,
      ),
      { request: null, observedRequests: observed },
    );
  }

  const request = first.request;
  const requestEvidence = async () => ({
    method: request.method(),
    url: redactText(request.url(), secrets),
    headers: redactHeaders(await request.allHeaders().catch(() => ({})), secrets),
    body: redactText(request.postData() ?? '', secrets).slice(0, 4096) || null,
  });

  const response = await waitForResponse(request, deadline);
  if (response === 'timeout') {
    return fail(new StepError('NETWORK_TIMEOUT', `Network check "${check.name}": the request was sent but no response arrived in time`), {
      request: await requestEvidence(),
      response: null,
    });
  }
  if (response === null) {
    const failure = request.failure()?.errorText ?? 'request failed';
    return fail(new StepError('NETWORK_ERROR', `Network check "${check.name}": the request failed without an HTTP response (${failure})`), {
      request: await requestEvidence(),
      response: null,
    });
  }

  // Look for duplicates of the same request shortly after the response.
  await sleep(DUPLICATE_WINDOW_MS);
  const responseHeaders = await response.allHeaders();
  const body = await response.body().catch(() => Buffer.alloc(0));
  const observed = { status: response.status(), headers: responseHeaders, body };
  const actualBase = {
    request: await requestEvidence(),
    response: {
      status: response.status(),
      headers: redactHeaders(responseHeaders, secrets),
      body: toPersistedBody(body, responseHeaders['content-type'], secrets),
    },
    matchingRequests: watch.matches.length,
  };
  if (watch.matches.length > 1) {
    return fail(
      new StepError(
        'AMBIGUOUS_NETWORK_MATCH',
        `Network check "${check.name}": ${watch.matches.length} matching requests were sent; expected exactly one`,
      ),
      actualBase,
    );
  }

  const assertions = evaluateResponseAssertions(check.assertions, observed, scope);
  const assertionEvidence = assertions.map((r) => redactJson({ ...r, assertion: r.assertion.kind }, secrets));
  const formatError = assertions.find((r) => r.errorCode !== undefined);
  if (formatError?.errorCode) {
    return fail(new StepError(formatError.errorCode, `Network check "${check.name}": ${formatError.message}`), {
      ...actualBase,
      assertions: assertionEvidence,
    });
  }
  const failed = assertions.filter((r) => !r.passed);
  if (failed.length > 0) {
    return fail(new StepError('ASSERTION_FAILED', `Network check "${check.name}": ${failed.map((r) => r.message).join('; ')}`), {
      ...actualBase,
      assertions: assertionEvidence,
    });
  }

  let outputs: Record<string, Primitive> = {};
  try {
    outputs = extractOutputs(check.outputs ?? [], observed);
  } catch (error) {
    if (error instanceof StepError) return fail(error, { ...actualBase, assertions: assertionEvidence });
    throw error;
  }
  return {
    id: check.id,
    name: check.name,
    expected,
    actual: { id: check.id, name: check.name, ...actualBase, assertions: assertionEvidence, outputs: redactJson(outputs, secrets) },
    outputs,
  };
}

async function waitForResponse(request: Request, deadline: number): Promise<Response | null | 'timeout'> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), Math.max(1, deadline - Date.now()));
  });
  try {
    return await Promise.race([request.response(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
