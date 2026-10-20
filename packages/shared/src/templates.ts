/**
 * Template grammar for `{{namespace.name}}` references (PROJECT_RULES §11).
 * Pure parsing only — resolution against runtime values lives in test-engine.
 * There is no expression language and no escape syntax in v1: a literal "{{" cannot be written.
 */

export const VARIABLE_NAMESPACES = ['inputs', 'run', 'outputs', 'secrets'] as const;
export type VariableNamespace = (typeof VARIABLE_NAMESPACES)[number];

export const RUN_VARIABLE_NAMES = ['id', 'startedAt', 'suffix'] as const;

export const VARIABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** Names that could reach Object.prototype if a resolver ever used plain objects. */
const FORBIDDEN_NAMES: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

export function isValidVariableName(name: string): boolean {
  return VARIABLE_NAME_PATTERN.test(name) && !FORBIDDEN_NAMES.has(name);
}

export interface TemplateText {
  kind: 'text';
  text: string;
}
export interface TemplateRef {
  kind: 'ref';
  namespace: VariableNamespace;
  name: string;
  raw: string;
}
export type TemplatePart = TemplateText | TemplateRef;

export type ParseTemplateResult = { ok: true; parts: TemplatePart[] } | { ok: false; message: string };

function isNamespace(value: string): value is VariableNamespace {
  return (VARIABLE_NAMESPACES as readonly string[]).includes(value);
}

export function parseTemplate(input: string): ParseTemplateResult {
  const parts: TemplatePart[] = [];
  let cursor = 0;
  while (cursor < input.length) {
    const open = input.indexOf('{{', cursor);
    if (open === -1) {
      parts.push({ kind: 'text', text: input.slice(cursor) });
      break;
    }
    if (open > cursor) parts.push({ kind: 'text', text: input.slice(cursor, open) });
    const close = input.indexOf('}}', open + 2);
    if (close === -1) return { ok: false, message: `Unclosed "{{" at position ${open}` };
    const raw = input.slice(open, close + 2);
    const inner = input.slice(open + 2, close).trim();
    const dot = inner.indexOf('.');
    if (dot === -1) return { ok: false, message: `Reference ${raw} must look like {{namespace.name}}` };
    const namespace = inner.slice(0, dot);
    const name = inner.slice(dot + 1);
    if (!isNamespace(namespace)) {
      return {
        ok: false,
        message: `Unknown namespace "${namespace}" in ${raw}; allowed: ${VARIABLE_NAMESPACES.join(', ')}`,
      };
    }
    if (!isValidVariableName(name)) return { ok: false, message: `Invalid variable name in ${raw}` };
    if (namespace === 'run' && !(RUN_VARIABLE_NAMES as readonly string[]).includes(name)) {
      return {
        ok: false,
        message: `Unknown run variable in ${raw}; allowed: ${RUN_VARIABLE_NAMES.join(', ')}`,
      };
    }
    parts.push({ kind: 'ref', namespace, name, raw });
    cursor = close + 2;
  }
  return { ok: true, parts };
}

/** All references in a template string; returns [] for strings that fail to parse. */
export function templateRefs(input: string): TemplateRef[] {
  const result = parseTemplate(input);
  return result.ok ? result.parts.filter((p): p is TemplateRef => p.kind === 'ref') : [];
}
