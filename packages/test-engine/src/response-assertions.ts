import type { ErrorCode, ResponseAssertion } from '@flowcheck/shared';
import { strictJsonEquals } from './compare.ts';
import { getByPointer, jsonTypeOf } from './json-pointer.ts';
import { PARSE_BODY_LIMIT_BYTES } from './redact.ts';
import { resolveJson, resolveString, type VariableScope } from './variables.ts';

export interface ObservedResponse {
  status: number;
  /** Lower-cased header names. Multiple values joined with ", ". */
  headers: Record<string, string>;
  body: Buffer;
}

export interface AssertionResult {
  assertion: ResponseAssertion;
  passed: boolean;
  /** Set when the assertion could not be evaluated (e.g. INVALID_RESPONSE_FORMAT). */
  errorCode?: ErrorCode;
  expected: unknown;
  actual: unknown;
  message: string;
}

type JsonBody = { ok: true; value: unknown } | { ok: false; code: ErrorCode; message: string };

const JSON_CONTENT_TYPE = /^application\/(json|[\w.+-]*\+json)\s*(;|$)/i;

function parseJsonBody(response: ObservedResponse): JsonBody {
  const contentType = response.headers['content-type'];
  if (contentType === undefined || !JSON_CONTENT_TYPE.test(contentType)) {
    return {
      ok: false,
      code: 'INVALID_RESPONSE_FORMAT',
      message: `Response is not JSON (Content-Type: ${contentType ?? 'none'})`,
    };
  }
  if (response.body.length > PARSE_BODY_LIMIT_BYTES) {
    return {
      ok: false,
      code: 'RESPONSE_TOO_LARGE',
      message: `Response body is ${response.body.length} bytes; JSON assertions support up to ${PARSE_BODY_LIMIT_BYTES}`,
    };
  }
  try {
    return { ok: true, value: JSON.parse(response.body.toString('utf8')) };
  } catch (error) {
    return { ok: false, code: 'INVALID_RESPONSE_FORMAT', message: `Response body is not valid JSON: ${(error as Error).message}` };
  }
}

/** Evaluates every assertion (no short-circuit) so the report shows all mismatches. */
export function evaluateResponseAssertions(
  assertions: readonly ResponseAssertion[],
  response: ObservedResponse,
  scope: VariableScope,
): AssertionResult[] {
  let json: JsonBody | undefined;
  const getJson = () => {
    json ??= parseJsonBody(response);
    return json;
  };

  return assertions.map((assertion) => evaluateOne(assertion, response, scope, getJson));
}

function evaluateOne(
  assertion: ResponseAssertion,
  response: ObservedResponse,
  scope: VariableScope,
  getJson: () => JsonBody,
): AssertionResult {
  switch (assertion.kind) {
    case 'statusEquals': {
      const passed = response.status === assertion.expected;
      return {
        assertion,
        passed,
        expected: assertion.expected,
        actual: response.status,
        message: `status ${response.status}, expected ${assertion.expected}`,
      };
    }
    case 'statusIn': {
      const passed = assertion.expected.includes(response.status);
      return {
        assertion,
        passed,
        expected: assertion.expected,
        actual: response.status,
        message: `status ${response.status}, expected one of ${assertion.expected.join(', ')}`,
      };
    }
    case 'headerEquals':
    case 'headerContains': {
      const expected = resolveString(assertion.expected, scope, `header ${assertion.name}`);
      const actual = response.headers[assertion.name.toLowerCase()];
      const passed = actual !== undefined && (assertion.kind === 'headerEquals' ? actual === expected : actual.includes(expected));
      const verb = assertion.kind === 'headerEquals' ? 'equal' : 'contain';
      return {
        assertion,
        passed,
        expected,
        actual: actual ?? null,
        message:
          actual === undefined ? `header ${assertion.name} is missing` : `header ${assertion.name} should ${verb} the expected value`,
      };
    }
    case 'textContains': {
      const expected = resolveString(assertion.expected, scope, 'text');
      const passed = response.body.toString('utf8').includes(expected);
      return {
        assertion,
        passed,
        expected,
        actual: null,
        message: passed ? 'body contains text' : 'body does not contain the expected text',
      };
    }
    case 'jsonExists':
    case 'jsonEquals':
    case 'jsonType':
    case 'jsonArrayLength': {
      const body = getJson();
      if (!body.ok) {
        return { assertion, passed: false, errorCode: body.code, expected: null, actual: null, message: body.message };
      }
      const lookup = getByPointer(body.value, assertion.pointer);
      const at = `at "${assertion.pointer}"`;
      if (assertion.kind === 'jsonExists') {
        return {
          assertion,
          passed: lookup.found,
          expected: 'exists',
          actual: lookup.found ? lookup.value : 'missing',
          message: lookup.found ? `value exists ${at}` : `no value ${at}: ${lookup.reason}`,
        };
      }
      if (!lookup.found) {
        return { assertion, passed: false, expected: assertion.expected, actual: 'missing', message: `no value ${at}: ${lookup.reason}` };
      }
      if (assertion.kind === 'jsonEquals') {
        const expected = resolveJson(assertion.expected, scope);
        const passed = strictJsonEquals(lookup.value, expected);
        return {
          assertion,
          passed,
          expected,
          actual: lookup.value,
          message: passed ? `value ${at} matches` : `value ${at} differs (strict comparison, no type coercion)`,
        };
      }
      if (assertion.kind === 'jsonType') {
        const actualType = jsonTypeOf(lookup.value);
        return {
          assertion,
          passed: actualType === assertion.expected,
          expected: assertion.expected,
          actual: actualType,
          message: `type ${at} is ${actualType}`,
        };
      }
      if (!Array.isArray(lookup.value)) {
        return {
          assertion,
          passed: false,
          expected: assertion.expected,
          actual: jsonTypeOf(lookup.value),
          message: `value ${at} is not an array`,
        };
      }
      const length = lookup.value.length;
      return {
        assertion,
        passed: length === assertion.expected,
        expected: assertion.expected,
        actual: length,
        message: `array ${at} has ${length} items`,
      };
    }
  }
}
