/**
 * RFC 6901 JSON Pointer. Not JSONPath.
 * "" is the whole document, "/0" an array element, "/id" a property.
 * Only own properties are read, so "/__proto__" never walks the prototype chain.
 */

export type PointerLookup = { found: true; value: unknown } | { found: false; reason: string };

export function parsePointer(pointer: string): string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) throw new Error(`Invalid JSON Pointer "${pointer}": must be "" or start with "/"`);
  return pointer
    .slice(1)
    .split('/')
    .map((segment) => {
      if (/~[^01]|~$/.test(segment)) throw new Error(`Invalid JSON Pointer escape in "${pointer}"`);
      // Order matters: "~01" must become "~1", not "/".
      return segment.replaceAll('~1', '/').replaceAll('~0', '~');
    });
}

const ARRAY_INDEX = /^(0|[1-9][0-9]*)$/;

export function getByPointer(document: unknown, pointer: string): PointerLookup {
  let current: unknown = document;
  for (const token of parsePointer(pointer)) {
    if (Array.isArray(current)) {
      if (!ARRAY_INDEX.test(token)) return { found: false, reason: `"${token}" is not a valid array index` };
      const index = Number(token);
      if (index >= current.length) return { found: false, reason: `index ${index} is out of bounds` };
      current = current[index];
    } else if (typeof current === 'object' && current !== null) {
      if (!Object.hasOwn(current, token)) return { found: false, reason: `property "${token}" does not exist` };
      current = (current as Record<string, unknown>)[token];
    } else {
      return { found: false, reason: `cannot descend into ${jsonTypeOf(current)} with "${token}"` };
    }
  }
  return { found: true, value: current };
}

export function jsonTypeOf(value: unknown): 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array' | 'undefined' {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean' || type === 'object') return type;
  return 'undefined';
}
