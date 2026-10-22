import { ARIA_ROLES, type BaseLocator, looksGeneratedId } from '@flowcheck/shared';

/**
 * Suggests locators for an element from its HTML (DevTools → Copy → Copy element).
 * The HTML is parsed with DOMParser as an inert document: scripts never run and nothing is
 * inserted into the page. Suggestions are ordered from most to least stable; layout classes
 * and DOM paths are never suggested because they break when the page changes.
 *
 * Only the element itself is known here, so whether a suggestion is unique on the real page is
 * checked when the test runs (AMBIGUOUS_LOCATOR / LOCATOR_NOT_FOUND).
 */

export type SuggestionQuality = 'best' | 'good' | 'fragile';
export type SuggestionReason =
  | 'testId'
  | 'dataAttribute'
  | 'role'
  | 'fieldAriaLabel'
  | 'placeholder'
  | 'name'
  | 'alt'
  | 'title'
  | 'text'
  | 'id'
  | 'generatedId';

export interface LocatorSuggestion {
  locator: BaseLocator;
  quality: SuggestionQuality;
  reason: SuggestionReason;
}

export type SuggestResult = { ok: true; tag: string; suggestions: LocatorSuggestion[] } | { ok: false; error: 'empty' | 'tooLarge' };

export const MAX_HTML_LENGTH = 200_000;
const MAX_NAME_LENGTH = 80;
const TEST_ID_ATTRIBUTES = ['data-test', 'data-qa', 'data-cy', 'data-test-id'];
const FIELD_TAGS = new Set(['input', 'textarea', 'select']);
const TEXT_INPUT_TYPES = new Set(['', 'text', 'email', 'password', 'search', 'tel', 'url', 'number']);

const collapse = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();
const usable = (text: string) => text.length > 0 && text.length <= MAX_NAME_LENGTH;
const isAriaRole = (role: string): role is (typeof ARIA_ROLES)[number] => (ARIA_ROLES as readonly string[]).includes(role);

/** The ARIA role a browser gives the element (explicit role wins), if we support it. */
export function implicitRole(el: Element): (typeof ARIA_ROLES)[number] | null {
  const explicit = el.getAttribute('role')?.trim().split(/\s+/)[0] ?? '';
  if (explicit) return isAriaRole(explicit) ? explicit : null;
  const tag = el.tagName.toLowerCase();
  const type = (el.getAttribute('type') ?? '').toLowerCase();
  switch (tag) {
    case 'button':
      return 'button';
    case 'a':
      return el.hasAttribute('href') ? 'link' : null;
    case 'select':
      return el.hasAttribute('multiple') ? 'listbox' : 'combobox';
    case 'textarea':
      return 'textbox';
    case 'img':
      return el.getAttribute('alt') ? 'img' : null;
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return 'heading';
    case 'input':
      if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'search') return 'searchbox';
      if (TEXT_INPUT_TYPES.has(type)) return 'textbox';
      return null;
    default:
      return null;
  }
}

/** Accessible name as far as it can be known from the element alone. */
function accessibleName(el: Element, role: string): string {
  const ariaLabel = collapse(el.getAttribute('aria-label'));
  if (ariaLabel) return ariaLabel;
  const tag = el.tagName.toLowerCase();
  if (tag === 'img') return collapse(el.getAttribute('alt'));
  if (tag === 'input' && role === 'button')
    return collapse(el.getAttribute('value') ?? (el.getAttribute('type') === 'submit' ? 'Submit' : ''));
  // Names from content apply to buttons, links and headings; fields are named by their label.
  if (['button', 'link', 'heading', 'tab', 'menuitem', 'option', 'checkbox', 'radio', 'switch'].includes(role) && !FIELD_TAGS.has(tag)) {
    return collapse(el.textContent);
  }
  return '';
}

export function suggestLocatorsFromElement(el: Element): LocatorSuggestion[] {
  const out: LocatorSuggestion[] = [];
  const add = (suggestion: LocatorSuggestion) => {
    const key = JSON.stringify(suggestion.locator);
    if (!out.some((s) => JSON.stringify(s.locator) === key)) out.push(suggestion);
  };
  const tag = el.tagName.toLowerCase();
  const attr = (name: string) => collapse(el.getAttribute(name));

  const testId = attr('data-testid');
  if (testId) add({ locator: { kind: 'testId', value: testId }, quality: 'best', reason: 'testId' });
  for (const name of TEST_ID_ATTRIBUTES) {
    const value = attr(name);
    if (value) add({ locator: { kind: 'attribute', name, value }, quality: 'best', reason: 'dataAttribute' });
  }

  const role = implicitRole(el);
  if (role) {
    const name = accessibleName(el, role);
    if (usable(name)) add({ locator: { kind: 'role', role, name }, quality: 'best', reason: 'role' });
  }

  if (FIELD_TAGS.has(tag)) {
    const ariaLabel = attr('aria-label');
    if (usable(ariaLabel)) add({ locator: { kind: 'label', value: ariaLabel, exact: true }, quality: 'good', reason: 'fieldAriaLabel' });
    const placeholder = attr('placeholder');
    if (usable(placeholder))
      add({ locator: { kind: 'placeholder', value: placeholder, exact: true }, quality: 'good', reason: 'placeholder' });
  }

  const name = attr('name');
  if (name && (FIELD_TAGS.has(tag) || tag === 'button' || tag === 'form')) {
    add({ locator: { kind: 'attribute', name: 'name', value: name }, quality: 'good', reason: 'name' });
  }

  const alt = attr('alt');
  if (tag === 'img' && usable(alt)) add({ locator: { kind: 'altText', value: alt, exact: true }, quality: 'good', reason: 'alt' });
  const title = attr('title');
  if (usable(title)) add({ locator: { kind: 'title', value: title, exact: true }, quality: 'good', reason: 'title' });

  // Visible text for elements without a better handle (role locators already cover buttons/links).
  if (!role && !FIELD_TAGS.has(tag)) {
    const text = collapse(el.textContent);
    if (usable(text)) add({ locator: { kind: 'text', value: text, exact: true }, quality: 'good', reason: 'text' });
  }

  const id = el.getAttribute('id')?.trim() ?? '';
  if (id) {
    const generated = looksGeneratedId(id);
    add({ locator: { kind: 'id', value: id }, quality: generated ? 'fragile' : 'good', reason: generated ? 'generatedId' : 'id' });
  }

  // Stable handles first; within a quality keep the order above.
  const rank: Record<SuggestionQuality, number> = { best: 0, good: 1, fragile: 2 };
  return out
    .map((s, i) => ({ s, i }))
    .sort((a, b) => rank[a.s.quality] - rank[b.s.quality] || a.i - b.i)
    .map(({ s }) => s);
}

export function suggestLocatorsFromHtml(html: string): SuggestResult {
  if (html.length > MAX_HTML_LENGTH) return { ok: false, error: 'tooLarge' };
  // DOMParser builds an inert document: no scripts run, no network requests, nothing is rendered.
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const el = doc.body.firstElementChild ?? doc.head.firstElementChild;
  if (!el) return { ok: false, error: 'empty' };
  return { ok: true, tag: el.tagName.toLowerCase(), suggestions: suggestLocatorsFromElement(el) };
}
