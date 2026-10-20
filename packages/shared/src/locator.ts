import { z } from 'zod';

/**
 * Structured locator — never an executable string (PROJECT_RULES §7).
 * Order of LOCATOR_KINDS is the preference order used by the recorder and editor.
 */
export const LOCATOR_KINDS = ['testId', 'role', 'label', 'placeholder', 'text', 'css'] as const;
export type LocatorKind = (typeof LOCATOR_KINDS)[number];

/** ARIA roles accepted by role locators. Kept to roles that Playwright's getByRole supports. */
export const ARIA_ROLES = [
  'alert',
  'alertdialog',
  'article',
  'banner',
  'button',
  'cell',
  'checkbox',
  'columnheader',
  'combobox',
  'complementary',
  'contentinfo',
  'dialog',
  'form',
  'grid',
  'gridcell',
  'heading',
  'img',
  'link',
  'list',
  'listbox',
  'listitem',
  'main',
  'menu',
  'menubar',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'navigation',
  'option',
  'progressbar',
  'radio',
  'radiogroup',
  'region',
  'row',
  'rowheader',
  'search',
  'searchbox',
  'slider',
  'spinbutton',
  'status',
  'switch',
  'tab',
  'table',
  'tablist',
  'tabpanel',
  'textbox',
  'tree',
  'treeitem',
] as const;

const value = z.string().min(1).max(500);

export const locatorSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('testId'), value }),
  z.strictObject({ kind: z.literal('role'), role: z.enum(ARIA_ROLES), name: value }),
  z.strictObject({ kind: z.literal('label'), value, exact: z.boolean() }),
  z.strictObject({ kind: z.literal('placeholder'), value, exact: z.boolean() }),
  z.strictObject({ kind: z.literal('text'), value, exact: z.boolean() }),
  z.strictObject({ kind: z.literal('css'), value }),
]);
export type Locator = z.infer<typeof locatorSchema>;

/** CSS locators are shown as "fragile" in the editor. */
export function isFragileLocator(locator: Locator): boolean {
  return locator.kind === 'css';
}

export function describeLocator(locator: Locator): string {
  switch (locator.kind) {
    case 'testId':
      return `testId "${locator.value}"`;
    case 'role':
      return `role ${locator.role} named "${locator.name}"`;
    case 'label':
    case 'placeholder':
    case 'text':
      return `${locator.kind} ${locator.exact ? 'exactly' : 'containing'} "${locator.value}"`;
    case 'css':
      return `css "${locator.value}" (fragile)`;
  }
}
