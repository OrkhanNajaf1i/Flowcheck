import { describeLocator, type Locator } from '@flowcheck/shared';
import type { Page, Locator as PwLocator } from 'playwright';
import { StepError } from './errors.ts';

/** Maps a structured locator to a Playwright locator. No fallback chain, ever. */
export function toPlaywrightLocator(page: Page, locator: Locator): PwLocator {
  switch (locator.kind) {
    case 'testId':
      return page.getByTestId(locator.value);
    case 'role':
      return page.getByRole(locator.role, { name: locator.name, exact: true });
    case 'label':
      return page.getByLabel(locator.value, { exact: locator.exact });
    case 'placeholder':
      return page.getByPlaceholder(locator.value, { exact: locator.exact });
    case 'text':
      return page.getByText(locator.value, { exact: locator.exact });
    case 'altText':
      return page.getByAltText(locator.value, { exact: locator.exact });
    case 'title':
      return page.getByTitle(locator.value, { exact: locator.exact });
    case 'id':
      return page.locator(`[id=${cssString(locator.value)}]`);
    case 'attribute':
      // The name is validated by the schema; the value is a quoted, escaped CSS string.
      return page.locator(`[${locator.name}=${cssString(locator.value)}]`);
    case 'css':
      return page.locator(locator.value);
  }
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
 */
export async function resolveSingle(page: Page, locator: Locator, deadline: number): Promise<PwLocator> {
  const target = toPlaywrightLocator(page, locator);
  const description = describeLocator(locator);
  for (;;) {
    const count = await target.count();
    if (count > 1) {
      throw new StepError('AMBIGUOUS_LOCATOR', `Locator ${description} matches ${count} elements; it must match exactly one`, {
        matchCount: count,
      });
    }
    if (count === 1) {
      // Runs in the page; typed structurally so this package does not need DOM typings.
      const inShadow = await target
        .evaluate((el: { getRootNode(): object }) => Object.prototype.toString.call(el.getRootNode()) === '[object ShadowRoot]')
        .catch(() => false);
      if (inShadow) {
        throw new StepError('UNSUPPORTED_SHADOW_DOM_TARGET', `Locator ${description} points into a shadow DOM, which is not supported`);
      }
      return target;
    }
    if (Date.now() >= deadline) {
      const frames = page.frames().length - 1;
      const hint = frames > 0 ? ` The page has ${frames} iframe(s); iframe targets are not supported.` : '';
      throw new StepError('LOCATOR_NOT_FOUND', `No element matches ${description}.${hint}`, { matchCount: 0, iframeCount: frames });
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}
