import { describe, expect, it } from 'vitest';
import { parseDefinition } from '../src/definition.ts';
import { ERROR_CODES } from '../src/errors.ts';
import { looksGeneratedId } from '../src/locator.ts';
import { parseTemplate } from '../src/templates.ts';

const base = {
  schemaVersion: 1,
  metadata: { tags: [] },
  inputs: [],
  setupSteps: [],
  cleanupSteps: [],
};

const navigate = { id: 'open', name: 'Open home', type: 'navigate', url: '/' };

function issues(input: unknown): string[] {
  const result = parseDefinition(input);
  if (result.ok) return [];
  if (result.code === 'UNSUPPORTED_SCHEMA_VERSION') return [result.message];
  return result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
}

describe('parseDefinition', () => {
  it('accepts a minimal valid definition', () => {
    expect(issues({ ...base, steps: [navigate] })).toEqual([]);
  });

  it('rejects unknown schemaVersion without trying to migrate', () => {
    const result = parseDefinition({ ...base, schemaVersion: 2, steps: [navigate] });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.code).toBe('UNSUPPORTED_SCHEMA_VERSION');
  });

  it('rejects unknown keys so arbitrary code cannot be smuggled in', () => {
    expect(issues({ ...base, steps: [{ ...navigate, script: 'alert(1)' }] }).length).toBeGreaterThan(0);
    expect(issues({ ...base, steps: [{ id: 'x', name: 'x', type: 'evaluate', code: '1' }] }).length).toBeGreaterThan(0);
  });

  it('requires at least one main step', () => {
    expect(issues({ ...base, steps: [] }).join()).toContain('at least one main step');
  });

  it('rejects duplicate step ids across phases', () => {
    const result = issues({ ...base, setupSteps: [navigate], steps: [navigate] });
    expect(result.join()).toContain('Duplicate step id');
  });

  it('rejects references to undeclared inputs and malformed templates', () => {
    expect(issues({ ...base, steps: [{ ...navigate, url: '/{{inputs.missing}}' }] }).join()).toContain('undeclared input');
    expect(issues({ ...base, steps: [{ ...navigate, url: '/{{inputs.x' }] }).join()).toContain('Unclosed');
  });

  it('rejects protocol-relative API paths and controlled headers', () => {
    const api = { id: 'a', name: 'a', type: 'apiRequest', method: 'GET', assertions: [] };
    expect(issues({ ...base, steps: [{ ...api, path: '//evil.example/x' }] }).join()).toContain('single "/"');
    expect(issues({ ...base, steps: [{ ...api, path: 'orders' }] }).join()).toContain('single "/"');
    expect(issues({ ...base, steps: [{ ...api, path: '/x', headers: { Host: 'evil' } }] }).join()).toContain('controlled by FlowCheck');
  });

  it('validates JSON Pointer syntax', () => {
    const api = (pointer: string) => ({
      id: 'a',
      name: 'a',
      type: 'apiRequest',
      method: 'GET',
      path: '/x',
      assertions: [{ kind: 'jsonExists', pointer }],
    });
    expect(issues({ ...base, steps: [api('')] })).toEqual([]);
    expect(issues({ ...base, steps: [api('/a~1b/0')] })).toEqual([]);
    expect(issues({ ...base, steps: [api('id')] }).length).toBeGreaterThan(0);
    expect(issues({ ...base, steps: [api('/a~2')] }).length).toBeGreaterThan(0);
  });

  it('checks input default type', () => {
    const def = { ...base, inputs: [{ name: 'n', type: 'number', required: false, default: '1' }], steps: [navigate] };
    expect(issues(def).join()).toContain('must be a number');
  });
});

describe('parseTemplate', () => {
  it('splits text and references', () => {
    const result = parseTemplate('a {{ inputs.email }} b');
    expect(result).toEqual({
      ok: true,
      parts: [
        { kind: 'text', text: 'a ' },
        { kind: 'ref', namespace: 'inputs', name: 'email', raw: '{{ inputs.email }}' },
        { kind: 'text', text: ' b' },
      ],
    });
  });

  it('rejects prototype-polluting names, unknown namespaces and run variables', () => {
    expect(parseTemplate('{{inputs.__proto__}}').ok).toBe(false);
    expect(parseTemplate('{{inputs.constructor}}').ok).toBe(false);
    expect(parseTemplate('{{env.HOME}}').ok).toBe(false);
    expect(parseTemplate('{{run.anything}}').ok).toBe(false);
    expect(parseTemplate('{{inputs.a + 1}}').ok).toBe(false);
  });
});

describe('error codes', () => {
  it('are unique', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });
});

describe('new step types', () => {
  const loc = { kind: 'testId', value: 'x' };
  const step = (extra: Record<string, unknown>) => ({ ...base, steps: [{ id: 'a', name: 'a', ...extra }] });

  it('accepts every implemented step type', () => {
    expect(issues(step({ type: 'assertText', locator: loc, expected: 'Hi', mode: 'exact' }))).toEqual([]);
    expect(issues(step({ type: 'assertHidden', locator: loc }))).toEqual([]);
    expect(issues(step({ type: 'assertValue', locator: loc, expected: '' }))).toEqual([]);
    expect(issues(step({ type: 'assertEnabled', locator: loc }))).toEqual([]);
    expect(issues(step({ type: 'assertUrl', expected: '/done', match: 'pathname', query: 'ignore' }))).toEqual([]);
    expect(issues(step({ type: 'selectOption', locator: loc, option: { by: 'label', value: 'Azerbaijan' } }))).toEqual([]);
    expect(issues(step({ type: 'check', locator: loc }))).toEqual([]);
    expect(issues(step({ type: 'uncheck', locator: loc }))).toEqual([]);
    expect(issues(step({ type: 'press', key: 'Control+Shift+Tab' }))).toEqual([]);
    expect(issues(step({ type: 'press', locator: loc, key: 'Enter' }))).toEqual([]);
  });

  it('rejects unsupported keyboard combinations', () => {
    expect(issues(step({ type: 'press', key: 'Hyper+x' })).join()).toContain('not a supported modifier');
    expect(issues(step({ type: 'press', key: 'Control+Alt+Shift+a' })).join()).toContain('At most two');
    expect(issues(step({ type: 'press', key: 'PrintScreen' })).join()).toContain('not a supported key');
  });

  it('checks the expected URL shape for the chosen mode', () => {
    expect(issues(step({ type: 'assertUrl', expected: 'done', match: 'pathname', query: 'ignore' })).join()).toContain(
      'must start with "/"',
    );
    expect(issues(step({ type: 'assertUrl', expected: '/done', match: 'fullUrl', query: 'include' })).join()).toContain('http://');
  });
});

describe('extra locator kinds', () => {
  const visible = (locator: unknown) => ({ ...base, steps: [{ id: 'a', name: 'a', type: 'assertVisible', locator }] });

  it('accepts id, attribute, alt text and title locators', () => {
    expect(issues(visible({ kind: 'id', value: 'account-btn' }))).toEqual([]);
    expect(issues(visible({ kind: 'attribute', name: 'aria-label', value: 'Hesab' }))).toEqual([]);
    expect(issues(visible({ kind: 'attribute', name: 'data-qa', value: 'x"y' }))).toEqual([]);
    expect(issues(visible({ kind: 'altText', value: 'Logo', exact: true }))).toEqual([]);
    expect(issues(visible({ kind: 'title', value: 'Settings', exact: false }))).toEqual([]);
  });

  it('accepts one level of scope and rejects nested scopes', () => {
    expect(issues(visible({ kind: 'text', value: 'Axtar', exact: true, within: { kind: 'id', value: 'header' } }))).toEqual([]);
    expect(
      issues(visible({ kind: 'text', value: 'A', exact: true, within: { kind: 'id', value: 'h', within: { kind: 'id', value: 'x' } } }))
        .length,
    ).toBeGreaterThan(0);
  });

  it('rejects attribute names that could inject selector syntax', () => {
    expect(issues(visible({ kind: 'attribute', name: 'name], body [a', value: 'x' })).length).toBeGreaterThan(0);
    expect(issues(visible({ kind: 'attribute', name: '', value: 'x' })).length).toBeGreaterThan(0);
  });
});

describe('looksGeneratedId', () => {
  it('flags framework-generated ids and keeps stable ones', () => {
    for (const id of [
      'reka-dropdown-menu-trigger-v-31',
      'menu-trigger-v-31',
      'nav-12',
      'field123',
      ':r5:',
      'radix-12',
      'headlessui-menu-button-3',
      'mui-123',
    ]) {
      expect(looksGeneratedId(id), id).toBe(true);
    }
    for (const id of ['account-btn', 'login', 'user-menu', 'email-input', 'download', 'added']) {
      expect(looksGeneratedId(id), id).toBe(false);
    }
  });
});

describe('network checks and outputs', () => {
  const click = (extra: Record<string, unknown> = {}) => ({
    id: 'place',
    name: 'Place order',
    type: 'click',
    locator: { kind: 'testId', value: 'place-order' },
    networkChecks: [
      {
        id: 'create',
        name: 'Order created',
        match: { origin: 'api', method: 'POST', pathname: '/api/orders' },
        assertions: [{ kind: 'statusEquals', expected: 201 }],
        outputs: [{ name: 'orderId', from: 'json', pointer: '/id' }],
      },
    ],
    ...extra,
  });
  const readOrder = { id: 'read', name: 'Read', type: 'apiRequest', method: 'GET', path: '/orders/{{outputs.orderId}}', assertions: [] };

  it('lets later steps and cleanup use an output', () => {
    const cleanup = [
      { id: 'del', name: 'Delete', type: 'apiRequest', method: 'DELETE', path: '/orders/{{outputs.orderId}}', assertions: [] },
    ];
    expect(issues({ ...base, steps: [click(), readOrder], cleanupSteps: cleanup })).toEqual([]);
  });

  it('rejects using an output before the step that sets it', () => {
    expect(issues({ ...base, steps: [readOrder, click()] }).join()).toContain('{{outputs.orderId}} is not set by any earlier step');
    expect(issues({ ...base, steps: [readOrder] }).join()).toContain('not set by any earlier step');
  });

  it('rejects setting the same output twice', () => {
    const second = { ...readOrder, id: 'again', path: '/orders', outputs: [{ name: 'orderId', from: 'json', pointer: '/0/id' }] };
    expect(issues({ ...base, steps: [click(), second] }).join()).toContain('Output "orderId" is already set');
  });

  it('validates the matcher', () => {
    const bad = click();
    bad.networkChecks[0] = {
      ...bad.networkChecks[0],
      match: { origin: 'https://api.example.com/v1', method: 'POST', pathname: 'api/orders' },
    } as never;
    const result = issues({ ...base, steps: [bad] }).join();
    expect(result).toContain('Origin must look like');
    expect(result).toContain('Path must start with "/"');
  });

  it('only allows network checks on action steps', () => {
    const visible = { id: 'v', name: 'v', type: 'assertVisible', locator: { kind: 'testId', value: 'x' }, networkChecks: [] };
    expect(issues({ ...base, steps: [visible] }).length).toBeGreaterThan(0);
  });
});
