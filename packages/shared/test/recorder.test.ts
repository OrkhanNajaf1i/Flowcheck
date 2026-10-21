import { describe, expect, it } from 'vitest';
import { buildRecordedSteps, pageEventSchema, type RecordedEvent } from '../src/recorder.ts';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const email = { kind: 'label', value: 'Email', exact: true } as const;
const save = { kind: 'role', role: 'button', name: 'Save' } as const;
let n = 0;
const fill = (value: string, extra: Partial<{ password: boolean; fragile: boolean; locator: object }> = {}) =>
  ({ kind: 'fill', clientEventId: uuid(++n), locator: email, fragile: false, value, password: false, ...extra }) as RecordedEvent;
const click = (locator: object = save, fragile = false) => ({ kind: 'click', clientEventId: uuid(++n), locator, fragile }) as RecordedEvent;

describe('buildRecordedSteps', () => {
  it('starts with the start page and keeps one fill per field (last value)', () => {
    const { steps, warnings } = buildRecordedSteps([fill('a'), fill('ab'), fill('abc'), click()], '/login');
    expect(steps.map((s) => s.type)).toEqual(['navigate', 'fill', 'click']);
    expect(steps[0]).toMatchObject({ url: '/login', name: 'Open /login' });
    expect(steps[1]).toMatchObject({ value: 'abc', name: 'Type into "Email"' });
    expect(steps[2]).toMatchObject({ name: 'Click "Save"' });
    expect(warnings).toEqual([]);
  });

  it('keeps fill → click → fill order (no merging across other actions)', () => {
    const { steps } = buildRecordedSteps([fill('a'), click(), fill('b')], '/');
    expect(steps.map((s) => (s.type === 'fill' ? `fill:${s.value}` : s.type))).toEqual(['navigate', 'fill:a', 'click', 'fill:b']);
  });

  it('never stores a password value; uses a secret placeholder with a warning', () => {
    const { steps, warnings } = buildRecordedSteps([fill('', { password: true })], '/');
    expect(steps[1]).toMatchObject({ type: 'fill', value: '{{secrets.password}}' });
    expect(JSON.stringify(steps)).not.toContain('hunter2');
    expect(warnings).toEqual([{ code: 'passwordField', stepId: steps[1]?.id, count: 1 }]);
  });

  it('empties typed text that would be read as a template and warns', () => {
    const { steps, warnings } = buildRecordedSteps([fill('price {{x')], '/');
    expect(steps[1]).toMatchObject({ value: '' });
    expect(warnings[0]?.code).toBe('bracesInValue');
  });

  it('marks fragile locators and collects page warnings with counts', () => {
    const { warnings } = buildRecordedSteps(
      [
        click({ kind: 'css', value: 'main > div:nth-of-type(2) > span' }, true),
        { kind: 'unsupported', clientEventId: uuid(++n), what: 'fileInput' },
        { kind: 'unsupported', clientEventId: uuid(++n), what: 'fileInput' },
        { kind: 'notice', code: 'browserClosed' },
      ],
      '/',
    );
    expect(warnings).toEqual([
      { code: 'fragileLocator', stepId: 'rec-2', count: 1 },
      { code: 'fileInput', count: 2 },
      { code: 'browserClosed', count: 1 },
    ]);
  });

  it('turns direct navigation into an Open step and merges consecutive ones', () => {
    const { steps } = buildRecordedSteps([{ kind: 'navigate', url: '/a' }, { kind: 'navigate', url: '/b' }, click()], '/');
    expect(steps.map((s) => (s.type === 'navigate' ? s.url : s.type))).toEqual(['/b', 'click']);
  });

  it('records select, check, uncheck and keys as steps', () => {
    const country = { kind: 'label', value: 'Country', exact: true } as const;
    const { steps } = buildRecordedSteps(
      [
        { kind: 'select', clientEventId: uuid(++n), locator: country, fragile: false, option: { by: 'label', value: 'Azerbaijan' } },
        { kind: 'check', clientEventId: uuid(++n), locator: { kind: 'label', value: 'Terms', exact: true }, fragile: false },
        { kind: 'uncheck', clientEventId: uuid(++n), locator: { kind: 'label', value: 'Terms', exact: true }, fragile: false },
        { kind: 'press', clientEventId: uuid(++n), key: 'Enter', locator: email, fragile: false },
        { kind: 'press', clientEventId: uuid(++n), key: 'Escape', fragile: false },
      ],
      '/',
    );
    expect(steps.slice(1).map((s) => s.name)).toEqual([
      'Choose "Azerbaijan" in "Country"',
      'Tick "Terms"',
      'Untick "Terms"',
      'Press Enter in "Email"',
      'Press Escape',
    ]);
  });
});

describe('pageEventSchema', () => {
  it('rejects events the page must not send (runner-only kinds, unknown keys, bad ids)', () => {
    expect(pageEventSchema.safeParse({ kind: 'navigate', url: '/x' }).success).toBe(false);
    expect(pageEventSchema.safeParse({ kind: 'click', clientEventId: 'x', locator: save, fragile: false }).success).toBe(false);
    expect(pageEventSchema.safeParse({ kind: 'click', clientEventId: uuid(1), locator: save, fragile: false, code: 'x' }).success).toBe(
      false,
    );
    expect(pageEventSchema.safeParse({ kind: 'press', clientEventId: uuid(1), key: 'a', fragile: false }).success).toBe(false);
    expect(pageEventSchema.safeParse({ kind: 'click', clientEventId: uuid(1), locator: save, fragile: false }).success).toBe(true);
  });
});

describe('checks picked by the tester', () => {
  it('become "Check it is shown" and exact "Check text" steps', () => {
    const heading = { kind: 'role', role: 'heading', name: 'New approval' } as const;
    const { steps } = buildRecordedSteps(
      [
        { kind: 'assertVisible', clientEventId: uuid(++n), locator: heading, fragile: false },
        { kind: 'assertText', clientEventId: uuid(++n), locator: { kind: 'testId', value: 'saved' }, fragile: false, text: 'Saved: Ada' },
      ],
      '/',
    );
    expect(steps.slice(1)).toEqual([
      { id: 'rec-2', name: 'Check "New approval" is shown', type: 'assertVisible', locator: heading },
      {
        id: 'rec-3',
        name: 'Check text "Saved: Ada"',
        type: 'assertText',
        locator: { kind: 'testId', value: 'saved' },
        expected: 'Saved: Ada',
        mode: 'exact',
      },
    ]);
  });

  it('drops a text check that would read as a template instead of checking for empty text', () => {
    const { steps, warnings } = buildRecordedSteps(
      [{ kind: 'assertText', clientEventId: uuid(++n), locator: { kind: 'testId', value: 'x' }, fragile: false, text: 'a {{b' }],
      '/',
    );
    expect(steps).toHaveLength(1);
    expect(warnings).toEqual([{ code: 'bracesInValue', count: 1 }]);
  });
});
