import { type BaseLocator, describeLocator, type Locator } from '@flowcheck/shared';
import type { Page, Locator as PwLocator } from 'playwright';
import { StepError } from './errors.ts';

type Root = Page | PwLocator;

/** Maps a structured locator (without scope) to a Playwright locator under `root`. No fallbacks, ever. */
function own(root: Root, locator: BaseLocator): PwLocator {
  switch (locator.kind) {
    case 'testId':
      return root.getByTestId(locator.value);
    case 'role':
      return root.getByRole(locator.role, { name: locator.name, exact: true });
    case 'label':
      return root.getByLabel(locator.value, { exact: locator.exact });
    case 'placeholder':
      return root.getByPlaceholder(locator.value, { exact: locator.exact });
    case 'text':
      return root.getByText(locator.value, { exact: locator.exact });
    case 'altText':
      return root.getByAltText(locator.value, { exact: locator.exact });
    case 'title':
      return root.getByTitle(locator.value, { exact: locator.exact });
    case 'id':
      return root.locator(`[id=${cssString(locator.value)}]`);
    case 'attribute':
      // The name is validated by the schema; the value is a quoted, escaped CSS string.
      return root.locator(`[${locator.name}=${cssString(locator.value)}]`);
    case 'css':
      return root.locator(locator.value);
  }
}

/**
 * All elements matching the locator, inside every matching container when scoped.
 * Used where several matches are evaluated (assertHidden); actions use resolveSingle.
 */
export function toPlaywrightLocator(page: Page, locator: Locator): PwLocator {
  return locator.within ? own(own(page, locator.within), locator) : own(page, locator);
}

/** Quotes a value for a CSS attribute selector so it is always matched literally. */
export function cssString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

const POLL_INTERVAL_MS = 100;

/**
 * Waits until the locator matches exactly one element.
 * - more than one match -> AMBIGUOUS_LOCATOR immediately (same as Playwright strict mode); never first()
 * - no match until the deadline -> LOCATOR_NOT_FOUND
 * - match inside a shadow root -> UNSUPPORTED_SHADOW_DOM_TARGET
 * A scoped locator first resolves its container with the same rules, then searches inside it.
 */
export async function resolveSingle(page: Page, locator: Locator, deadline: number): Promise<PwLocator> {
  if (!locator.within) return exactlyOne(page, own(page, locator), describeLocator(locator), deadline, 'element');
  const container = await exactlyOne(page, own(page, locator.within), describeLocator(locator.within), deadline, 'container');
  return exactlyOne(page, own(container, locator), describeLocator(locator), deadline, 'element');
}

async function exactlyOne(
  page: Page,
  target: PwLocator,
  description: string,
  deadline: number,
  what: 'element' | 'container',
): Promise<PwLocator> {
  const subject = what === 'container' ? `Container ${description}` : `Locator ${description}`;
  for (;;) {
    const count = await target.count();
    if (count > 1) {
      const fix = what === 'container' ? 'the container must match exactly one element' : 'it must match exactly one';
      throw new StepError('AMBIGUOUS_LOCATOR', `${subject} matches ${count} elements; ${fix}`, { matchCount: count, scope: what });
    }
    if (count === 1) {
      // Runs in the page; typed structurally so this package does not need DOM typings.
      const inShadow = await target
        .evaluate((el: { getRootNode(): object }) => Object.prototype.toString.call(el.getRootNode()) === '[object ShadowRoot]')
        .catch(() => false);
      if (inShadow) {
        throw new StepError('UNSUPPORTED_SHADOW_DOM_TARGET', `${subject} points into a shadow DOM, which is not supported`);
      }
      return target;
    }
    if (Date.now() >= deadline) {
      const frames = page.frames().length - 1;
      const hint = frames > 0 ? ` The page has ${frames} iframe(s); iframe targets are not supported.` : '';
      const message = what === 'container' ? `No container matches ${description}.${hint}` : `No element matches ${description}.${hint}`;
      throw new StepError('LOCATOR_NOT_FOUND', message, { matchCount: 0, iframeCount: frames, scope: what });
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}
