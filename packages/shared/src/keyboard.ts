/**
 * Keyboard combinations accepted by the `press` step (PROJECT_RULES §6).
 * Format: up to two modifiers and one key joined by "+", e.g. "Enter", "Control+a", "Shift+Tab".
 * Anything else is rejected with UNSUPPORTED_KEYBOARD_COMBINATION.
 */

export const KEYBOARD_MODIFIERS = ['Control', 'Shift', 'Alt', 'Meta'] as const;

const NAMED_KEYS = [
  'Enter',
  'Tab',
  'Escape',
  'Backspace',
  'Delete',
  'Space',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
];

/** Keys offered in the editor; letters and digits are accepted too. */
export const COMMON_KEYS = ['Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'Space', 'ArrowDown', 'ArrowUp', 'Control+a'] as const;

function isBaseKey(key: string): boolean {
  return NAMED_KEYS.includes(key) || /^[a-z0-9]$/.test(key);
}

export type KeyCombinationResult = { ok: true; combination: string } | { ok: false; message: string };

export function parseKeyCombination(input: string): KeyCombinationResult {
  const parts = input.split('+');
  const key = parts.pop() ?? '';
  const modifiers = parts;
  const invalid = (message: string): KeyCombinationResult => ({ ok: false, message });
  if (!isBaseKey(key)) {
    return invalid(`"${key}" is not a supported key. Use a letter, a digit, F1–F12 or one of: ${NAMED_KEYS.slice(0, 14).join(', ')}`);
  }
  if (modifiers.length > 2) return invalid('At most two modifier keys are supported');
  for (const modifier of modifiers) {
    if (!(KEYBOARD_MODIFIERS as readonly string[]).includes(modifier)) {
      return invalid(`"${modifier}" is not a supported modifier. Use ${KEYBOARD_MODIFIERS.join(', ')}`);
    }
  }
  if (new Set(modifiers).size !== modifiers.length) return invalid('A modifier is repeated');
  return { ok: true, combination: [...modifiers, key].join('+') };
}
