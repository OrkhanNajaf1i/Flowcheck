import type {
  ApiRequestStep,
  ARIA_ROLES,
  BaseLocator,
  HTTP_METHODS,
  InputDefinition,
  JSON_VALUE_TYPES,
  Locator,
  ResponseAssertion,
  Step,
  StepType,
  TestDefinition,
  ValidationIssue,
} from '@flowcheck/shared';
import {
  CURRENT_SCHEMA_VERSION,
  NETWORK_CHECK_STEP_TYPES,
  type NetworkCheck,
  type OutputMapping,
  parseDefinition,
  stepNetworkChecks,
  zodIssuesToValidationIssues,
} from '@flowcheck/shared';
import { t } from '@/i18n';

/**
 * Editor form model. Every step carries all fields (a flat shape is much easier to bind to
 * react-hook-form than a union); `toDefinition` keeps only the fields of the chosen type.
 * Numbers and JSON are edited as text and converted strictly — invalid text is reported, never
 * coerced silently.
 */

export type LocatorKind = Locator['kind'];
export type AssertionKind = ResponseAssertion['kind'];

export interface BaseLocatorForm {
  kind: LocatorKind;
  value: string;
  /** Attribute name for kind "attribute" (e.g. name, aria-label, data-qa). */
  attrName: string;
  role: (typeof ARIA_ROLES)[number];
  exact: boolean;
}

export interface LocatorForm extends BaseLocatorForm {
  /** Search only inside this container (optional). */
  withinEnabled: boolean;
  within: BaseLocatorForm;
}

const blankBaseLocator = (kind: LocatorKind = 'testId'): BaseLocatorForm => ({
  kind,
  value: '',
  attrName: 'name',
  role: 'button',
  exact: true,
});
const blankLocator = (): LocatorForm => ({ ...blankBaseLocator(), withinEnabled: false, within: blankBaseLocator('id') });

export interface AssertionForm {
  kind: AssertionKind;
  /** status, status list, header/text value, JSON value (as JSON text), type or length. */
  expected: string;
  pointer: string;
  name: string;
}

export interface StepForm {
  /** Stable React/dnd key; not persisted. */
  key: string;
  id: string;
  name: string;
  type: StepType;
  timeoutMs: string;
  url: string;
  locator: LocatorForm;
  value: string;
  method: (typeof HTTP_METHODS)[number];
  path: string;
  headers: { name: string; value: string }[];
  body: string;
  auth: 'browserCookies' | 'none';
  assertions: AssertionForm[];
  /** Expected text / value / URL of assertText, assertValue, assertUrl. */
  expected: string;
  textMode: 'exact' | 'contains';
  normalizeWhitespace: boolean;
  urlMatch: 'pathname' | 'fullUrl';
  urlQuery: 'ignore' | 'include';
  optionBy: 'label' | 'value';
  keyCombo: string;
  /** press: focus an element first (true) or press on the page (false). */
  pressOnElement: boolean;
  /** Keep a screenshot after the step passes (page steps only). */
  screenshot: boolean;
  /** Requests the action must send (action steps only). */
  networkChecks: NetworkCheckForm[];
  /** Values taken from the API response (apiRequest only). */
  outputs: OutputForm[];
}

export interface OutputForm {
  name: string;
  from: 'json' | 'header';
  pointer: string;
  header: string;
}

export interface NetworkCheckForm {
  key: string;
  id: string;
  name: string;
  originMode: 'api' | 'frontend' | 'custom';
  origin: string;
  method: (typeof HTTP_METHODS)[number];
  pathname: string;
  /** Selected query parameters as "a=1&b=2". */
  query: string;
  timeoutMs: string;
  assertions: AssertionForm[];
  outputs: OutputForm[];
}

export function blankOutput(): OutputForm {
  return { name: '', from: 'json', pointer: '/id', header: '' };
}

export function blankNetworkCheck(name: string): NetworkCheckForm {
  return {
    key: newKey(),
    id: newStepId(),
    name,
    originMode: 'api',
    origin: '',
    method: 'POST',
    pathname: '/',
    query: '',
    timeoutMs: '',
    assertions: [blankAssertion()],
    outputs: [],
  };
}

export interface InputForm {
  name: string;
  type: InputDefinition['type'];
  required: boolean;
  default: string;
  description: string;
}

export interface EditorForm {
  name: string;
  description: string;
  tags: string[];
  inputs: InputForm[];
  setupSteps: StepForm[];
  steps: StepForm[];
  cleanupSteps: StepForm[];
  defaultTimeoutMs: string;
  runTimeoutMs: string;
  /** Saved login session id, or "" for none. */
  authProfileId: string;
}

export type Phase = 'setupSteps' | 'steps' | 'cleanupSteps';
export const PHASES: Phase[] = ['setupSteps', 'steps', 'cleanupSteps'];

let keyCounter = 0;
const newKey = () => `k${Date.now().toString(36)}${(keyCounter++).toString(36)}`;

export function newStepId(): string {
  return `s_${Math.random().toString(36).slice(2, 10)}`;
}

export function blankStep(type: StepType = 'navigate', name = ''): StepForm {
  return {
    key: newKey(),
    id: newStepId(),
    name,
    type,
    timeoutMs: '',
    url: '/',
    locator: blankLocator(),
    value: '',
    method: 'GET',
    path: '/',
    headers: [],
    body: '',
    auth: 'browserCookies',
    assertions: type === 'apiRequest' ? [blankAssertion()] : [],
    expected: type === 'assertUrl' ? '/' : '',
    textMode: 'contains',
    normalizeWhitespace: true,
    urlMatch: 'pathname',
    urlQuery: 'ignore',
    optionBy: 'label',
    keyCombo: 'Enter',
    pressOnElement: true,
    screenshot: false,
    networkChecks: [],
    outputs: [],
  };
}

export function blankAssertion(kind: AssertionKind = 'statusEquals'): AssertionForm {
  return { kind, expected: kind === 'statusEquals' ? '200' : '', pointer: '', name: '' };
}

// ---- definition -> form ----

function locatorToForm(locator: Locator): LocatorForm {
  return {
    ...baseLocatorToForm(locator),
    withinEnabled: locator.within !== undefined,
    within: locator.within ? baseLocatorToForm(locator.within) : blankBaseLocator('id'),
  };
}

function baseLocatorToForm(locator: BaseLocator): BaseLocatorForm {
  const base = blankBaseLocator(locator.kind);
  switch (locator.kind) {
    case 'role':
      return { ...base, role: locator.role, value: locator.name };
    case 'testId':
    case 'css':
    case 'id':
      return { ...base, value: locator.value };
    case 'attribute':
      return { ...base, attrName: locator.name, value: locator.value };
    default:
      return { ...base, value: locator.value, exact: locator.exact };
  }
}

function assertionToForm(a: ResponseAssertion): AssertionForm {
  const base = { kind: a.kind, expected: '', pointer: '', name: '' };
  switch (a.kind) {
    case 'statusEquals':
    case 'jsonArrayLength':
      return { ...base, expected: String(a.expected), pointer: 'pointer' in a ? a.pointer : '' };
    case 'statusIn':
      return { ...base, expected: a.expected.join(', ') };
    case 'headerEquals':
    case 'headerContains':
      return { ...base, name: a.name, expected: a.expected };
    case 'textContains':
      return { ...base, expected: a.expected };
    case 'jsonExists':
      return { ...base, pointer: a.pointer };
    case 'jsonEquals':
      return { ...base, pointer: a.pointer, expected: JSON.stringify(a.expected) };
    case 'jsonType':
      return { ...base, pointer: a.pointer, expected: a.expected };
  }
}

function outputToForm(o: OutputMapping): OutputForm {
  return o.from === 'json'
    ? { ...blankOutput(), name: o.name, pointer: o.pointer }
    : { ...blankOutput(), name: o.name, from: 'header', header: o.header, pointer: '' };
}

function networkCheckToForm(check: NetworkCheck): NetworkCheckForm {
  const mode = check.match.origin === 'api' || check.match.origin === 'frontend' ? check.match.origin : 'custom';
  return {
    ...blankNetworkCheck(check.name),
    id: check.id,
    originMode: mode,
    origin: mode === 'custom' ? check.match.origin : '',
    method: check.match.method,
    pathname: check.match.pathname,
    query: check.match.query ? new URLSearchParams(check.match.query).toString() : '',
    timeoutMs: check.timeoutMs?.toString() ?? '',
    assertions: check.assertions.map(assertionToForm),
    outputs: (check.outputs ?? []).map(outputToForm),
  };
}

function stepToForm(step: Step): StepForm {
  return {
    ...stepToFormBase(step),
    networkChecks: stepNetworkChecks(step).map(networkCheckToForm),
    outputs: step.type === 'apiRequest' ? (step.outputs ?? []).map(outputToForm) : [],
  };
}

function stepToFormBase(step: Step): StepForm {
  const form = {
    ...blankStep(step.type),
    id: step.id,
    name: step.name,
    timeoutMs: step.timeoutMs?.toString() ?? '',
    screenshot: 'screenshot' in step && step.screenshot === true,
    assertions: [] as AssertionForm[],
  };
  switch (step.type) {
    case 'navigate':
      return { ...form, url: step.url };
    case 'click':
    case 'assertVisible':
    case 'assertHidden':
    case 'assertEnabled':
    case 'check':
    case 'uncheck':
      return { ...form, locator: locatorToForm(step.locator) };
    case 'fill':
      return { ...form, locator: locatorToForm(step.locator), value: step.value };
    case 'assertText':
      return {
        ...form,
        locator: locatorToForm(step.locator),
        expected: step.expected,
        textMode: step.mode,
        normalizeWhitespace: step.normalizeWhitespace ?? true,
      };
    case 'assertValue':
      return { ...form, locator: locatorToForm(step.locator), expected: step.expected };
    case 'assertUrl':
      return { ...form, expected: step.expected, urlMatch: step.match, urlQuery: step.query };
    case 'selectOption':
      return { ...form, locator: locatorToForm(step.locator), optionBy: step.option.by, value: step.option.value };
    case 'press':
      return {
        ...form,
        keyCombo: step.key,
        pressOnElement: step.locator !== undefined,
        ...(step.locator ? { locator: locatorToForm(step.locator) } : {}),
      };
    case 'apiRequest':
      return {
        ...form,
        method: step.method,
        path: step.path + (step.query && Object.keys(step.query).length > 0 ? `?${new URLSearchParams(step.query).toString()}` : ''),
        headers: Object.entries(step.headers ?? {}).map(([name, value]) => ({ name, value })),
        body: step.body === undefined ? '' : JSON.stringify(step.body, null, 2),
        auth: step.auth?.kind ?? 'browserCookies',
        assertions: step.assertions.map(assertionToForm),
      };
  }
}

/** Recorded draft steps as new editor steps (fresh ids, so they never clash with existing ones). */
export function recordedStepsToForm(steps: Step[]): StepForm[] {
  return steps.map((step) => ({ ...stepToForm(step), id: newStepId() }));
}

export function toForm(testCase: { name: string; description: string }, def: TestDefinition): EditorForm {
  return {
    name: testCase.name,
    description: testCase.description,
    tags: def.metadata.tags,
    inputs: def.inputs.map((input) => ({
      name: input.name,
      type: input.type,
      required: input.required,
      default: input.default === undefined ? '' : String(input.default),
      description: input.description ?? '',
    })),
    setupSteps: def.setupSteps.map(stepToForm),
    steps: def.steps.map(stepToForm),
    cleanupSteps: def.cleanupSteps.map(stepToForm),
    defaultTimeoutMs: def.defaultTimeoutMs?.toString() ?? '',
    runTimeoutMs: def.runTimeoutMs?.toString() ?? '',
    authProfileId: def.authProfileId ?? '',
  };
}

// ---- form -> definition ----

export interface ConversionIssue {
  path: (string | number)[];
  message: string;
}

class Collector {
  readonly issues: ConversionIssue[] = [];
  add(path: (string | number)[], message: string) {
    this.issues.push({ path, message });
  }
}

function intOrUndefined(text: string, path: (string | number)[], c: Collector): number | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  if (!/^\d+$/.test(trimmed)) {
    c.add(path, 'Must be a whole number');
    return undefined;
  }
  return Number(trimmed);
}

function locatorFromForm(l: LocatorForm): Locator {
  const own = baseLocatorFromForm(l);
  return l.withinEnabled ? { ...own, within: baseLocatorFromForm(l.within) } : own;
}

function baseLocatorFromForm(l: BaseLocatorForm): BaseLocator {
  switch (l.kind) {
    case 'role':
      return { kind: 'role', role: l.role, name: l.value };
    case 'testId':
      return { kind: 'testId', value: l.value };
    case 'css':
      return { kind: 'css', value: l.value };
    case 'id':
      return { kind: 'id', value: l.value };
    case 'attribute':
      return { kind: 'attribute', name: l.attrName.trim(), value: l.value };
    default:
      return { kind: l.kind, value: l.value, exact: l.exact };
  }
}

function assertionFromForm(a: AssertionForm, path: (string | number)[], c: Collector): ResponseAssertion | null {
  switch (a.kind) {
    case 'statusEquals': {
      const n = intOrUndefined(a.expected, [...path, 'expected'], c);
      if (n === undefined) {
        c.add([...path, 'expected'], 'Enter a status code');
        return null;
      }
      return { kind: a.kind, expected: n };
    }
    case 'statusIn': {
      const parts = a.expected
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (parts.length === 0 || parts.some((p) => !/^\d+$/.test(p))) {
        c.add([...path, 'expected'], 'Enter status codes separated by commas, e.g. 200, 201');
        return null;
      }
      return { kind: a.kind, expected: parts.map(Number) };
    }
    case 'headerEquals':
    case 'headerContains':
      return { kind: a.kind, name: a.name, expected: a.expected };
    case 'textContains':
      return { kind: a.kind, expected: a.expected };
    case 'jsonExists':
      return { kind: a.kind, pointer: a.pointer };
    case 'jsonEquals': {
      try {
        return { kind: a.kind, pointer: a.pointer, expected: JSON.parse(a.expected) };
      } catch {
        c.add([...path, 'expected'], 'Must be a JSON value, e.g. "text" (with quotes), 42, true or null');
        return null;
      }
    }
    case 'jsonType':
      return { kind: a.kind, pointer: a.pointer, expected: a.expected as (typeof JSON_VALUE_TYPES)[number] };
    case 'jsonArrayLength': {
      const n = intOrUndefined(a.expected, [...path, 'expected'], c);
      if (n === undefined) {
        c.add([...path, 'expected'], 'Enter a length');
        return null;
      }
      return { kind: a.kind, pointer: a.pointer, expected: n };
    }
  }
}

function outputFromForm(o: OutputForm): OutputMapping {
  return o.from === 'json'
    ? { name: o.name.trim(), from: 'json', pointer: o.pointer }
    : { name: o.name.trim(), from: 'header', header: o.header.trim() };
}

function networkCheckFromForm(n: NetworkCheckForm, path: (string | number)[], c: Collector): NetworkCheck {
  const timeoutMs = intOrUndefined(n.timeoutMs, [...path, 'timeoutMs'], c);
  const query = n.query.trim() ? Object.fromEntries(new URLSearchParams(n.query.trim().replace(/^\?/, ''))) : undefined;
  return {
    id: n.id,
    name: n.name,
    match: {
      origin: n.originMode === 'custom' ? n.origin.trim() : n.originMode,
      method: n.method,
      pathname: n.pathname.trim(),
      ...(query && Object.keys(query).length > 0 ? { query } : {}),
    },
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    assertions: n.assertions
      .map((a, i) => assertionFromForm(a, [...path, 'assertions', i], c))
      .filter((a): a is ResponseAssertion => a !== null),
    ...(n.outputs.length > 0 ? { outputs: n.outputs.map(outputFromForm) } : {}),
  };
}

function stepFromForm(s: StepForm, path: (string | number)[], c: Collector): Step {
  const base = stepFromFormBase(s, path, c);
  const step = s.screenshot && base.type !== 'apiRequest' ? ({ ...base, screenshot: true } as Step) : base;
  if (step.type === 'apiRequest' && s.outputs.length > 0) return { ...step, outputs: s.outputs.map(outputFromForm) };
  if ((NETWORK_CHECK_STEP_TYPES as readonly string[]).includes(step.type) && s.networkChecks.length > 0) {
    const networkChecks = s.networkChecks.map((n, i) => networkCheckFromForm(n, [...path, 'networkChecks', i], c));
    return { ...step, networkChecks } as Step;
  }
  return step;
}

function stepFromFormBase(s: StepForm, path: (string | number)[], c: Collector): Step {
  const timeoutMs = intOrUndefined(s.timeoutMs, [...path, 'timeoutMs'], c);
  const base = { id: s.id, name: s.name, ...(timeoutMs === undefined ? {} : { timeoutMs }) };
  switch (s.type) {
    case 'navigate':
      return { ...base, type: 'navigate', url: s.url };
    case 'click':
      return { ...base, type: 'click', locator: locatorFromForm(s.locator) };
    case 'assertVisible':
      return { ...base, type: 'assertVisible', locator: locatorFromForm(s.locator) };
    case 'fill':
      return { ...base, type: 'fill', locator: locatorFromForm(s.locator), value: s.value };
    case 'assertHidden':
    case 'assertEnabled':
    case 'check':
    case 'uncheck':
      return { ...base, type: s.type, locator: locatorFromForm(s.locator) };
    case 'assertText':
      return {
        ...base,
        type: 'assertText',
        locator: locatorFromForm(s.locator),
        expected: s.expected,
        mode: s.textMode,
        ...(s.normalizeWhitespace ? {} : { normalizeWhitespace: false }),
      };
    case 'assertValue':
      return { ...base, type: 'assertValue', locator: locatorFromForm(s.locator), expected: s.expected };
    case 'assertUrl':
      return { ...base, type: 'assertUrl', expected: s.expected, match: s.urlMatch, query: s.urlQuery };
    case 'selectOption':
      return { ...base, type: 'selectOption', locator: locatorFromForm(s.locator), option: { by: s.optionBy, value: s.value } };
    case 'press':
      return { ...base, type: 'press', key: s.keyCombo, ...(s.pressOnElement ? { locator: locatorFromForm(s.locator) } : {}) };
    case 'apiRequest': {
      const [rawPath = '', search] = s.path.split(/\?(.*)/s);
      const query = search ? Object.fromEntries(new URLSearchParams(search)) : undefined;
      let body: ApiRequestStep['body'];
      if (s.body.trim() !== '') {
        try {
          body = JSON.parse(s.body);
        } catch {
          c.add([...path, 'body'], 'Body must be valid JSON');
        }
      }
      const headers = Object.fromEntries(s.headers.filter((h) => h.name.trim() !== '').map((h) => [h.name.trim(), h.value]));
      const assertions = s.assertions
        .map((a, i) => assertionFromForm(a, [...path, 'assertions', i], c))
        .filter((a): a is ResponseAssertion => a !== null);
      return {
        ...base,
        type: 'apiRequest',
        method: s.method,
        path: rawPath,
        ...(query && Object.keys(query).length > 0 ? { query } : {}),
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
        ...(body === undefined ? {} : { body }),
        auth: { kind: s.auth },
        assertions,
      };
    }
  }
}

export interface ToDefinitionResult {
  definition: unknown;
  issues: ConversionIssue[];
}

/** Builds the definition and validates it with the same shared schema the server uses. */
export function toDefinition(form: EditorForm): ToDefinitionResult {
  const c = new Collector();
  const inputs = form.inputs.map((input, i) => {
    let defaultValue: string | number | boolean | undefined;
    if (input.default.trim() !== '') {
      if (input.type === 'number') {
        defaultValue = Number(input.default);
        if (!Number.isFinite(defaultValue)) c.add(['inputs', i, 'default'], 'Must be a number');
      } else if (input.type === 'boolean') {
        if (input.default !== 'true' && input.default !== 'false') c.add(['inputs', i, 'default'], 'Must be true or false');
        defaultValue = input.default === 'true';
      } else defaultValue = input.default;
    }
    return {
      name: input.name,
      type: input.type,
      required: input.required,
      ...(defaultValue === undefined ? {} : { default: defaultValue }),
      ...(input.description ? { description: input.description } : {}),
    };
  });
  const defaultTimeoutMs = intOrUndefined(form.defaultTimeoutMs, ['defaultTimeoutMs'], c);
  const runTimeoutMs = intOrUndefined(form.runTimeoutMs, ['runTimeoutMs'], c);
  const definition = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    metadata: { tags: form.tags },
    inputs,
    setupSteps: form.setupSteps.map((s, i) => stepFromForm(s, ['setupSteps', i], c)),
    steps: form.steps.map((s, i) => stepFromForm(s, ['steps', i], c)),
    cleanupSteps: form.cleanupSteps.map((s, i) => stepFromForm(s, ['cleanupSteps', i], c)),
    ...(defaultTimeoutMs === undefined ? {} : { defaultTimeoutMs }),
    ...(runTimeoutMs === undefined ? {} : { runTimeoutMs }),
    ...(form.authProfileId ? { authProfileId: form.authProfileId } : {}),
  };
  const parsed = parseDefinition(definition);
  const schemaIssues: ValidationIssue[] = parsed.ok
    ? []
    : parsed.code === 'VALIDATION_ERROR'
      ? zodIssuesToValidationIssues(parsed.error)
      : [{ path: ['schemaVersion'], code: parsed.code, message: parsed.message }];
  return { definition, issues: [...c.issues, ...schemaIssues.map(({ path, message }) => ({ path, message }))] };
}

/** Maps a definition issue path (e.g. ['steps', 0, 'locator', 'value']) to "steps.0.locator.value". */
export function issueKey(path: (string | number)[]): string {
  return path.join('.');
}

/** One-line, human readable description of a step for collapsed cards. */
export function stepSummary(step: StepForm): string {
  const sm = t.steps.summary;
  const describe = (l: BaseLocatorForm) =>
    l.kind === 'attribute' ? sm.element(`[${l.attrName}]`, l.value.trim()) : sm.element(t.steps.summaryLocator[l.kind], l.value.trim());
  const element = () =>
    step.locator.withinEnabled ? sm.within(describe(step.locator), describe(step.locator.within)) : describe(step.locator);
  switch (step.type) {
    case 'navigate':
      return sm.navigate(step.url || '/');
    case 'click':
    case 'assertVisible':
      return element();
    case 'fill':
      return sm.fill(element(), step.value);
    case 'assertText':
      return sm.text(element(), step.textMode, step.expected);
    case 'assertHidden':
      return sm.hidden(element());
    case 'assertValue':
      return sm.value(element(), step.expected);
    case 'assertEnabled':
      return sm.enabled(element());
    case 'assertUrl':
      return sm.url(step.expected);
    case 'selectOption':
      return sm.select(element(), step.value);
    case 'check':
      return sm.check(element());
    case 'uncheck':
      return sm.uncheck(element());
    case 'press':
      return sm.press(step.keyCombo, step.pressOnElement ? element() : null);
    case 'apiRequest':
      return sm.api(step.method, step.path);
  }
}
