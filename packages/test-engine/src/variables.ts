import { parseTemplate, type VariableNamespace } from '@flowcheck/shared';
import { StepError } from './errors.ts';

export type Primitive = string | number | boolean | null;

/**
 * Runtime variable scope. Backed by Maps so names can never touch Object.prototype.
 * Outputs are added only after a step has passed.
 */
export class VariableScope {
  readonly #values: Record<VariableNamespace, Map<string, Primitive>> = {
    inputs: new Map(),
    run: new Map(),
    outputs: new Map(),
    secrets: new Map(),
  };

  set(namespace: VariableNamespace, name: string, value: Primitive): void {
    this.#values[namespace].set(name, value);
  }

  has(namespace: VariableNamespace, name: string): boolean {
    return this.#values[namespace].has(name);
  }

  get(namespace: VariableNamespace, name: string): Primitive {
    const map = this.#values[namespace];
    if (!map.has(name)) {
      throw new StepError('MISSING_VARIABLE', `Variable {{${namespace}.${name}}} is not defined`, {
        variable: `${namespace}.${name}`,
      });
    }
    return map.get(name) as Primitive;
  }

  /** Values that must be redacted from any persisted output. */
  secretValues(): string[] {
    return [...this.#values.secrets.values()].filter((v): v is string => typeof v === 'string');
  }
}

/**
 * Resolves a template string.
 * - A field that is exactly one reference keeps the primitive type ("{{inputs.count}}" -> 3).
 * - Interpolation inside other text always yields a string.
 * - A missing variable throws MISSING_VARIABLE; it never becomes "".
 */
export function resolveTemplate(template: string, scope: VariableScope): Primitive {
  const parsed = parseTemplate(template);
  if (!parsed.ok) throw new StepError('VALIDATION_ERROR', parsed.message);
  const [only] = parsed.parts;
  if (parsed.parts.length === 1 && only?.kind === 'ref') return scope.get(only.namespace, only.name);
  return parsed.parts.map((part) => (part.kind === 'text' ? part.text : String(scope.get(part.namespace, part.name)))).join('');
}

/** Resolves a template and requires the result to be a string (URLs, header values, fill values). */
export function resolveString(template: string, scope: VariableScope, field: string): string {
  const value = resolveTemplate(template, scope);
  if (typeof value !== 'string') {
    // Single-reference fields keep their type; for string-only fields, convert explicitly and visibly.
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    throw new StepError('VALIDATION_ERROR', `${field} resolved to ${value === null ? 'null' : typeof value}, expected text`);
  }
  return value;
}

/** Resolves string leaves of a JSON value. Object keys are never templated. */
export function resolveJson(value: unknown, scope: VariableScope): unknown {
  if (typeof value === 'string') return resolveTemplate(value, scope);
  if (Array.isArray(value)) return value.map((item) => resolveJson(item, scope));
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = Object.create(null);
    for (const [key, item] of Object.entries(value)) out[key] = resolveJson(item, scope);
    return out;
  }
  return value;
}
