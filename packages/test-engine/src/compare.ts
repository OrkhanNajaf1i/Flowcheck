/**
 * Strict JSON equality with no type coercion:
 * "1" !== 1, null !== missing, false !== "", key order does not matter.
 */
export function strictJsonEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => strictJsonEquals(item, b[index]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every(
      (key) => Object.hasOwn(b, key) && strictJsonEquals((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    );
  }
  // Two different numbers, strings or booleans. NaN cannot occur in parsed JSON.
  return false;
}
