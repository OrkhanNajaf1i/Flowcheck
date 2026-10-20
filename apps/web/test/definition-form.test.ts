import type { TestDefinition } from '@flowcheck/shared';
import { describe, expect, it } from 'vitest';
import { blankStep, toDefinition, toForm } from '@/features/editor/definition-form';

const definition: TestDefinition = {
  schemaVersion: 1,
  metadata: { tags: ['smoke'] },
  inputs: [{ name: 'qty', type: 'number', required: false, default: 2 }],
  setupSteps: [],
  steps: [
    { id: 'open', name: 'Open', type: 'navigate', url: '/' },
    { id: 'click', name: 'Buy', type: 'click', locator: { kind: 'role', role: 'button', name: 'Buy now' }, timeoutMs: 5000 },
    { id: 'fill', name: 'Email', type: 'fill', locator: { kind: 'label', value: 'Email', exact: true }, value: 'qa@example.test' },
    {
      id: 'api',
      name: 'Create',
      type: 'apiRequest',
      method: 'POST',
      path: '/orders',
      query: { dryRun: 'true' },
      headers: { 'X-Trace': 'abc' },
      body: { qty: '{{inputs.qty}}' },
      auth: { kind: 'none' },
      assertions: [
        { kind: 'statusIn', expected: [200, 201] },
        { kind: 'jsonEquals', pointer: '/status', expected: 'created' },
        { kind: 'jsonArrayLength', pointer: '/items', expected: 1 },
      ],
    },
  ],
  cleanupSteps: [],
  runTimeoutMs: 60000,
};

const allTypes: TestDefinition = {
  schemaVersion: 1,
  metadata: { tags: [] },
  inputs: [],
  setupSteps: [],
  steps: [
    {
      id: 't1',
      name: 'Text',
      type: 'assertText',
      locator: { kind: 'testId', value: 'x' },
      expected: 'Hi',
      mode: 'exact',
      normalizeWhitespace: false,
    },
    { id: 't2', name: 'Text2', type: 'assertText', locator: { kind: 'testId', value: 'x' }, expected: 'Hi', mode: 'contains' },
    { id: 'h', name: 'Hidden', type: 'assertHidden', locator: { kind: 'text', value: 'Error', exact: false } },
    { id: 'v', name: 'Value', type: 'assertValue', locator: { kind: 'label', value: 'Name', exact: true }, expected: '' },
    { id: 'e', name: 'Enabled', type: 'assertEnabled', locator: { kind: 'role', role: 'button', name: 'Go' } },
    { id: 'u', name: 'Url', type: 'assertUrl', expected: '/done?a=1', match: 'pathname', query: 'include' },
    {
      id: 's',
      name: 'Select',
      type: 'selectOption',
      locator: { kind: 'label', value: 'Country', exact: true },
      option: { by: 'value', value: 'az' },
    },
    { id: 'c', name: 'Check', type: 'check', locator: { kind: 'testId', value: 'terms' } },
    { id: 'uc', name: 'Uncheck', type: 'uncheck', locator: { kind: 'testId', value: 'terms' } },
    { id: 'p1', name: 'Press', type: 'press', key: 'Enter', locator: { kind: 'testId', value: 'q' } },
    { id: 'p2', name: 'Press page', type: 'press', key: 'Control+a' },
    { id: 'l1', name: 'Id', type: 'click', locator: { kind: 'id', value: 'account-btn' } },
    { id: 'l2', name: 'Attr', type: 'click', locator: { kind: 'attribute', name: 'aria-label', value: 'Hesab' } },
    { id: 'l3', name: 'Alt', type: 'assertVisible', locator: { kind: 'altText', value: 'Logo', exact: false } },
    { id: 'l4', name: 'Title', type: 'assertVisible', locator: { kind: 'title', value: 'Settings', exact: true } },
  ],
  cleanupSteps: [],
};

describe('editor form conversion', () => {
  it('round-trips a definition without losing or coercing data', () => {
    const { definition: back, issues } = toDefinition(toForm({ name: 'T', description: '' }, definition));
    expect(issues).toEqual([]);
    expect(back).toEqual(definition);
  });

  it('round-trips every step type', () => {
    const { definition: back, issues } = toDefinition(toForm({ name: 'T', description: '' }, allTypes));
    expect(issues).toEqual([]);
    expect(back).toEqual(allTypes);
  });

  it('reports non-numeric timeouts instead of coercing them', () => {
    const form = toForm({ name: 'T', description: '' }, definition);
    form.steps[1] = { ...(form.steps[1] as (typeof form.steps)[number]), timeoutMs: '5s' };
    const { issues } = toDefinition(form);
    expect(issues).toContainEqual({ path: ['steps', 1, 'timeoutMs'], message: 'Must be a whole number' });
  });

  it('requires JSON-valued expectations to be real JSON (strings need quotes)', () => {
    const form = toForm({ name: 'T', description: '' }, definition);
    const api = form.steps[3] as (typeof form.steps)[number];
    api.assertions[1] = { ...(api.assertions[1] as (typeof api.assertions)[number]), expected: 'created' };
    const { issues } = toDefinition(form);
    expect(issues.some((i) => i.path.join('.') === 'steps.3.assertions.1.expected')).toBe(true);
  });

  it('surfaces shared-schema errors with definition paths', () => {
    const form = toForm({ name: 'T', description: '' }, definition);
    form.steps.push({ ...blankStep('apiRequest'), name: 'Bad', path: '//evil.example' });
    const { issues } = toDefinition(form);
    expect(issues).toContainEqual(expect.objectContaining({ path: ['steps', 4, 'path'] }));
  });

  it('keeps only the fields of the chosen step type', () => {
    const form = toForm({ name: 'T', description: '' }, definition);
    form.steps[0] = { ...(form.steps[0] as (typeof form.steps)[number]), value: 'leftover', path: '/x' };
    const { definition: back } = toDefinition(form);
    expect((back as TestDefinition).steps[0]).toEqual({ id: 'open', name: 'Open', type: 'navigate', url: '/' });
  });
});
