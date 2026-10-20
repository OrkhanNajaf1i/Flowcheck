import type { OutputMapping } from '@flowcheck/shared';
import { StepError } from './errors.ts';
import { getByPointer, jsonTypeOf } from './json-pointer.ts';
import { type ObservedResponse, parseJsonBody } from './response-assertions.ts';
import type { Primitive } from './variables.ts';

/**
 * Reads output values from a response that already passed its assertions.
 * Only primitives can be stored; a missing value or an object/array fails the step instead of
 * being stored as "" or stringified.
 */
export function extractOutputs(mappings: readonly OutputMapping[], response: ObservedResponse): Record<string, Primitive> {
  const values: Record<string, Primitive> = {};
  for (const mapping of mappings) {
    if (mapping.from === 'header') {
      const value = response.headers[mapping.header.toLowerCase()];
      if (value === undefined) {
        throw new StepError('ASSERTION_FAILED', `Output "${mapping.name}": header ${mapping.header} is missing`);
      }
      values[mapping.name] = value;
      continue;
    }
    const body = parseJsonBody(response);
    if (!body.ok) throw new StepError(body.code, `Output "${mapping.name}": ${body.message}`);
    const lookup = getByPointer(body.value, mapping.pointer);
    if (!lookup.found) {
      throw new StepError('ASSERTION_FAILED', `Output "${mapping.name}": no value at "${mapping.pointer}" (${lookup.reason})`);
    }
    const type = jsonTypeOf(lookup.value);
    if (type === 'object' || type === 'array') {
      throw new StepError(
        'ASSERTION_FAILED',
        `Output "${mapping.name}": value at "${mapping.pointer}" is ${type === 'array' ? 'an array' : 'an object'}; only text, numbers, booleans and null can be stored`,
      );
    }
    values[mapping.name] = lookup.value as Primitive;
  }
  return values;
}
