import { z } from 'zod';
import { parseKeyCombination } from './keyboard.ts';
import { locatorSchema } from './locator.ts';
import { isValidVariableName, parseTemplate, type TemplateRef, templateRefs } from './templates.ts';

/**
 * Test definition, schemaVersion 1 (PROJECT_RULES §6).
 *
 * Rules:
 * - Only step types the engine actually executes are part of the schema. New step types are
 *   added to v1 when implemented (additive, old revisions stay valid). Breaking changes need
 *   a new schemaVersion with its own schema; old revisions are never migrated silently.
 * - Every object is strict: unknown keys are rejected, so no code can be smuggled in.
 */

export const CURRENT_SCHEMA_VERSION = 1;

export const TIMEOUT_DEFAULTS = {
  stepMs: 30_000,
  networkCheckMs: 10_000,
  runMs: 300_000,
} as const;

export const TIMEOUT_LIMITS = {
  stepMinMs: 1_000,
  stepMaxMs: 300_000,
  runMinMs: 10_000,
  runMaxMs: 3_600_000,
} as const;

const stepTimeout = z.number().int().min(TIMEOUT_LIMITS.stepMinMs).max(TIMEOUT_LIMITS.stepMaxMs);
const runTimeout = z.number().int().min(TIMEOUT_LIMITS.runMinMs).max(TIMEOUT_LIMITS.runMaxMs);

/** A string that may contain {{namespace.name}} references. */
const template = (max = 2000) =>
  z
    .string()
    .max(max)
    .superRefine((value, ctx) => {
      const parsed = parseTemplate(value);
      if (!parsed.ok) ctx.addIssue({ code: 'custom', message: parsed.message });
    });

const stepId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'Step id may contain letters, digits, "_" and "-" (max 64)');

const stepBase = {
  id: stepId,
  name: z.string().min(1).max(200),
  timeoutMs: stepTimeout.optional(),
};

/**
 * Steps that work on the page. A screenshot is always taken when one fails; `screenshot: true`
 * also keeps one after it passes, as visual evidence (it is not a check by itself).
 */
const uiStepBase = {
  ...stepBase,
  screenshot: z.boolean().optional(),
};

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

/** Methods that are never retried and that the editor marks as state-changing. */
export const MUTATING_HTTP_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;

const headerName = z.string().regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/, 'Invalid header name');

/** Headers the runner controls itself; setting them from a test is rejected. */
export const FORBIDDEN_REQUEST_HEADERS = ['host', 'content-length', 'transfer-encoding', 'connection'] as const;

/** RFC 6901 JSON Pointer syntax: "" or "/" segments, "~" only as "~0" or "~1". */
export const jsonPointerSchema = z
  .string()
  .max(500)
  .regex(/^(\/([^~]|~[01])*)*$/, 'Invalid JSON Pointer (RFC 6901): use "" for root, "/id", "/items/0"');

export const JSON_VALUE_TYPES = ['string', 'number', 'boolean', 'null', 'object', 'array'] as const;

const statusCode = z.number().int().min(100).max(599);

export const responseAssertionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('statusEquals'), expected: statusCode }),
  z.strictObject({ kind: z.literal('statusIn'), expected: z.array(statusCode).min(1).max(20) }),
  z.strictObject({ kind: z.literal('headerEquals'), name: headerName, expected: template(1000) }),
  z.strictObject({ kind: z.literal('headerContains'), name: headerName, expected: template(1000) }),
  z.strictObject({ kind: z.literal('jsonExists'), pointer: jsonPointerSchema }),
  z.strictObject({ kind: z.literal('jsonEquals'), pointer: jsonPointerSchema, expected: z.json() }),
  z.strictObject({
    kind: z.literal('jsonType'),
    pointer: jsonPointerSchema,
    expected: z.enum(JSON_VALUE_TYPES),
  }),
  z.strictObject({
    kind: z.literal('jsonArrayLength'),
    pointer: jsonPointerSchema,
    expected: z.number().int().min(0),
  }),
  z.strictObject({ kind: z.literal('textContains'), expected: template(1000) }),
]);
export type ResponseAssertion = z.infer<typeof responseAssertionSchema>;

export const apiAuthSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({ kind: z.literal('browserCookies') }),
]);

/**
 * Takes a value from a passed response and stores it as {{outputs.<name>}} for later steps.
 * Only primitives (string, number, boolean, null) can be stored; objects/arrays are rejected.
 */
export const outputMappingSchema = z.discriminatedUnion('from', [
  z.strictObject({
    name: z.string().refine(isValidVariableName, 'Invalid output name'),
    from: z.literal('json'),
    pointer: jsonPointerSchema,
  }),
  z.strictObject({ name: z.string().refine(isValidVariableName, 'Invalid output name'), from: z.literal('header'), header: headerName }),
]);
export type OutputMapping = z.infer<typeof outputMappingSchema>;

/** "api" / "frontend" take the origin from the run's environment; otherwise an explicit origin. */
export const networkOriginSchema = z.union([
  z.enum(['api', 'frontend']),
  z.string().regex(/^https?:\/\/[^/?#\s]+$/, 'Origin must look like https://api.example.com (no path)'),
]);

/**
 * Observes a request the browser sends because of the step's action (PROJECT_RULES §10):
 * matched by origin, method, exact pathname and selected query parameters — never by status.
 */
export const networkCheckSchema = z.strictObject({
  id: stepId,
  name: z.string().min(1).max(200),
  match: z.strictObject({
    origin: networkOriginSchema,
    method: z.enum(HTTP_METHODS),
    /** Exact pathname, e.g. /api/orders. */
    pathname: template(500),
    query: z.record(z.string().min(1).max(200), template(500)).optional(),
  }),
  timeoutMs: stepTimeout.optional(),
  assertions: z.array(responseAssertionSchema).max(50),
  outputs: z.array(outputMappingSchema).max(20).optional(),
});
export type NetworkCheck = z.infer<typeof networkCheckSchema>;

const networkChecks = z.array(networkCheckSchema).max(5).optional();

export const navigateStepSchema = z.strictObject({
  ...uiStepBase,
  type: z.literal('navigate'),
  /** Path starting with "/" (resolved against frontendBaseUrl) or an absolute http(s) URL. */
  url: template(),
  networkChecks,
});

export const clickStepSchema = z.strictObject({
  ...uiStepBase,
  type: z.literal('click'),
  locator: locatorSchema,
  networkChecks,
});

export const fillStepSchema = z.strictObject({
  ...uiStepBase,
  type: z.literal('fill'),
  locator: locatorSchema,
  value: template(),
  networkChecks,
});

export const assertVisibleStepSchema = z.strictObject({
  ...uiStepBase,
  type: z.literal('assertVisible'),
  locator: locatorSchema,
});

export const TEXT_MATCH_MODES = ['exact', 'contains'] as const;

/** The element's visible text equals / contains the expected text. Missing element ≠ empty text. */
export const assertTextStepSchema = z.strictObject({
  ...uiStepBase,
  type: z.literal('assertText'),
  locator: locatorSchema,
  expected: template(),
  mode: z.enum(TEXT_MATCH_MODES),
  /** Collapse runs of whitespace and trim both sides before comparing (default true). */
  normalizeWhitespace: z.boolean().optional(),
});

/**
 * No matching element is visible: zero matches pass, matches that are all hidden pass, and the
 * step fails if at least one match is visible. Several matches are evaluated, never first().
 */
export const assertHiddenStepSchema = z.strictObject({
  ...uiStepBase,
  type: z.literal('assertHidden'),
  locator: locatorSchema,
});

/** The input / textarea / select value equals the expected text exactly. */
export const assertValueStepSchema = z.strictObject({
  ...uiStepBase,
  type: z.literal('assertValue'),
  locator: locatorSchema,
  expected: template(),
});

export const assertEnabledStepSchema = z.strictObject({
  ...uiStepBase,
  type: z.literal('assertEnabled'),
  locator: locatorSchema,
});

export const URL_MATCH_MODES = ['pathname', 'fullUrl'] as const;
export const URL_QUERY_MODES = ['ignore', 'include'] as const;

/** Default: pathname only, query ignored. Hash is never compared. */
export const assertUrlStepSchema = z.strictObject({
  ...uiStepBase,
  type: z.literal('assertUrl'),
  expected: template(),
  match: z.enum(URL_MATCH_MODES),
  query: z.enum(URL_QUERY_MODES),
});

export const OPTION_SELECTORS = ['label', 'value'] as const;

export const selectOptionStepSchema = z.strictObject({
  ...uiStepBase,
  type: z.literal('selectOption'),
  locator: locatorSchema,
  option: z.strictObject({ by: z.enum(OPTION_SELECTORS), value: template(500) }),
  networkChecks,
});

export const checkStepSchema = z.strictObject({ ...uiStepBase, type: z.literal('check'), locator: locatorSchema, networkChecks });
export const uncheckStepSchema = z.strictObject({ ...uiStepBase, type: z.literal('uncheck'), locator: locatorSchema, networkChecks });

/** Presses a key combination on an element (focused first) or, without a locator, on the page. */
export const pressStepSchema = z.strictObject({
  ...uiStepBase,
  type: z.literal('press'),
  locator: locatorSchema.optional(),
  key: z
    .string()
    .max(60)
    .superRefine((value, ctx) => {
      const result = parseKeyCombination(value);
      if (!result.ok) ctx.addIssue({ code: 'custom', message: result.message, params: { errorCode: 'UNSUPPORTED_KEYBOARD_COMBINATION' } });
    }),
  networkChecks,
});

export const apiRequestStepSchema = z.strictObject({
  ...stepBase,
  type: z.literal('apiRequest'),
  method: z.enum(HTTP_METHODS),
  /** Must start with "/"; appended to apiBaseUrl's path. */
  path: template(),
  query: z.record(z.string().min(1).max(200), template(1000)).optional(),
  headers: z.record(headerName, template(4000)).optional(),
  body: z.json().optional(),
  auth: apiAuthSchema.optional(),
  assertions: z.array(responseAssertionSchema).max(50),
  outputs: z.array(outputMappingSchema).max(20).optional(),
});

export const stepSchema = z.discriminatedUnion('type', [
  navigateStepSchema,
  clickStepSchema,
  fillStepSchema,
  assertVisibleStepSchema,
  assertTextStepSchema,
  assertHiddenStepSchema,
  assertValueStepSchema,
  assertEnabledStepSchema,
  assertUrlStepSchema,
  selectOptionStepSchema,
  checkStepSchema,
  uncheckStepSchema,
  pressStepSchema,
  apiRequestStepSchema,
]);
export type Step = z.infer<typeof stepSchema>;
export type StepType = Step['type'];
export type NavigateStep = z.infer<typeof navigateStepSchema>;
export type ClickStep = z.infer<typeof clickStepSchema>;
export type FillStep = z.infer<typeof fillStepSchema>;
export type AssertVisibleStep = z.infer<typeof assertVisibleStepSchema>;
export type ApiRequestStep = z.infer<typeof apiRequestStepSchema>;
export type AssertTextStep = z.infer<typeof assertTextStepSchema>;
export type AssertUrlStep = z.infer<typeof assertUrlStepSchema>;
export type SelectOptionStep = z.infer<typeof selectOptionStepSchema>;
export type PressStep = z.infer<typeof pressStepSchema>;

/** Step types that perform a browser action and may carry network checks. */
export const NETWORK_CHECK_STEP_TYPES = ['navigate', 'click', 'fill', 'selectOption', 'check', 'uncheck', 'press'] as const;

export function stepNetworkChecks(step: Step): NetworkCheck[] {
  return 'networkChecks' in step ? (step.networkChecks ?? []) : [];
}

/** Output names a step publishes when it passes. */
export function stepOutputs(step: Step): string[] {
  const own = step.type === 'apiRequest' ? (step.outputs ?? []) : [];
  return [...own, ...stepNetworkChecks(step).flatMap((check) => check.outputs ?? [])].map((o) => o.name);
}

export const INPUT_TYPES = ['string', 'number', 'boolean'] as const;

export const inputDefinitionSchema = z
  .strictObject({
    name: z.string().refine(isValidVariableName, 'Invalid input name'),
    type: z.enum(INPUT_TYPES),
    required: z.boolean(),
    default: z.union([z.string(), z.number(), z.boolean()]).optional(),
    description: z.string().max(500).optional(),
  })
  .superRefine((input, ctx) => {
    if (input.default !== undefined && typeof input.default !== input.type) {
      ctx.addIssue({
        code: 'custom',
        path: ['default'],
        message: `Default value must be a ${input.type}`,
      });
    }
  });
export type InputDefinition = z.infer<typeof inputDefinitionSchema>;

/** Collects every template string in a step, tagged with whether secrets are allowed there. */
function stepTemplates(step: Step): { path: (string | number)[]; value: string; secretsAllowed: boolean }[] {
  const out: { path: (string | number)[]; value: string; secretsAllowed: boolean }[] = [];
  switch (step.type) {
    case 'navigate':
      out.push({ path: ['url'], value: step.url, secretsAllowed: false });
      break;
    case 'fill':
      out.push({ path: ['value'], value: step.value, secretsAllowed: true });
      break;
    case 'apiRequest':
      out.push({ path: ['path'], value: step.path, secretsAllowed: false });
      for (const [key, value] of Object.entries(step.query ?? {})) {
        out.push({ path: ['query', key], value, secretsAllowed: false });
      }
      for (const [key, value] of Object.entries(step.headers ?? {})) {
        out.push({ path: ['headers', key], value, secretsAllowed: true });
      }
      step.assertions.forEach((assertion, index) => {
        if ('expected' in assertion && typeof assertion.expected === 'string') {
          out.push({ path: ['assertions', index, 'expected'], value: assertion.expected, secretsAllowed: false });
        }
      });
      break;
    case 'assertText':
    case 'assertValue':
      out.push({ path: ['expected'], value: step.expected, secretsAllowed: false });
      break;
    case 'assertUrl':
      out.push({ path: ['expected'], value: step.expected, secretsAllowed: false });
      break;
    case 'selectOption':
      out.push({ path: ['option', 'value'], value: step.option.value, secretsAllowed: false });
      break;
    case 'click':
    case 'assertVisible':
    case 'assertHidden':
    case 'assertEnabled':
    case 'check':
    case 'uncheck':
    case 'press':
      break;
  }
  stepNetworkChecks(step).forEach((check, c) => {
    const base = ['networkChecks', c];
    out.push({ path: [...base, 'match', 'pathname'], value: check.match.pathname, secretsAllowed: false });
    for (const [key, value] of Object.entries(check.match.query ?? {})) {
      out.push({ path: [...base, 'match', 'query', key], value, secretsAllowed: false });
    }
    check.assertions.forEach((assertion, index) => {
      if ('expected' in assertion && typeof assertion.expected === 'string') {
        out.push({ path: [...base, 'assertions', index, 'expected'], value: assertion.expected, secretsAllowed: false });
      }
    });
  });
  return out;
}

export const testDefinitionV1Schema = z
  .strictObject({
    schemaVersion: z.literal(1),
    metadata: z.strictObject({
      tags: z.array(z.string().min(1).max(50)).max(20),
    }),
    inputs: z.array(inputDefinitionSchema).max(50),
    setupSteps: z.array(stepSchema).max(100),
    steps: z.array(stepSchema).min(1, 'A test needs at least one main step').max(200),
    cleanupSteps: z.array(stepSchema).max(100),
    defaultTimeoutMs: stepTimeout.optional(),
    runTimeoutMs: runTimeout.optional(),
    /** Saved login session loaded into every run; it must belong to the run's environment. */
    authProfileId: z.string().min(1).max(64).optional(),
  })
  .superRefine((def, ctx) => {
    const seenInputs = new Set<string>();
    def.inputs.forEach((input, index) => {
      if (seenInputs.has(input.name)) {
        ctx.addIssue({ code: 'custom', path: ['inputs', index, 'name'], message: `Duplicate input "${input.name}"` });
      }
      seenInputs.add(input.name);
    });

    const seenSteps = new Set<string>();
    /** Outputs published by steps that run before the current one (setup → main → cleanup). */
    const availableOutputs = new Set<string>();
    const declaredOutputs = new Set<string>();
    const phases = [
      ['setupSteps', def.setupSteps],
      ['steps', def.steps],
      ['cleanupSteps', def.cleanupSteps],
    ] as const;
    for (const [phaseKey, steps] of phases) {
      steps.forEach((step, index) => {
        if (seenSteps.has(step.id)) {
          ctx.addIssue({ code: 'custom', path: [phaseKey, index, 'id'], message: `Duplicate step id "${step.id}"` });
        }
        seenSteps.add(step.id);

        if (step.type === 'assertUrl' && !step.expected.startsWith('{{')) {
          const ok = step.match === 'pathname' ? step.expected.startsWith('/') : /^https?:\/\//.test(step.expected);
          if (!ok) {
            ctx.addIssue({
              code: 'custom',
              path: [phaseKey, index, 'expected'],
              message:
                step.match === 'pathname'
                  ? 'Expected path must start with "/", e.g. /dashboard'
                  : 'Expected URL must start with http:// or https://',
            });
          }
        }
        if (step.type === 'apiRequest') {
          if (!step.path.startsWith('/') || step.path.startsWith('//')) {
            ctx.addIssue({
              code: 'custom',
              path: [phaseKey, index, 'path'],
              message: 'API path must start with a single "/"',
            });
          }
          for (const header of Object.keys(step.headers ?? {})) {
            if ((FORBIDDEN_REQUEST_HEADERS as readonly string[]).includes(header.toLowerCase())) {
              ctx.addIssue({
                code: 'custom',
                path: [phaseKey, index, 'headers', header],
                message: `Header "${header}" is controlled by FlowCheck and cannot be set`,
              });
            }
          }
        }

        stepNetworkChecks(step).forEach((check, c) => {
          if (!check.match.pathname.startsWith('/')) {
            ctx.addIssue({
              code: 'custom',
              path: [phaseKey, index, 'networkChecks', c, 'match', 'pathname'],
              message: 'Path must start with "/", e.g. /api/orders',
            });
          }
          if (seenSteps.has(check.id)) {
            ctx.addIssue({ code: 'custom', path: [phaseKey, index, 'networkChecks', c, 'id'], message: `Duplicate id "${check.id}"` });
          }
          seenSteps.add(check.id);
        });

        for (const tpl of stepTemplates(step)) {
          const parsed = parseTemplate(tpl.value);
          if (!parsed.ok) {
            ctx.addIssue({ code: 'custom', path: [phaseKey, index, ...tpl.path], message: parsed.message });
            continue;
          }
          for (const ref of templateRefs(tpl.value)) {
            checkRef(ref, tpl.secretsAllowed, [phaseKey, index, ...tpl.path]);
          }
        }

        // Outputs become available only to later steps, and each name may be declared once.
        for (const name of stepOutputs(step)) {
          if (declaredOutputs.has(name)) {
            ctx.addIssue({ code: 'custom', path: [phaseKey, index], message: `Output "${name}" is already set by an earlier step` });
          }
          declaredOutputs.add(name);
        }
        for (const name of stepOutputs(step)) availableOutputs.add(name);
      });
    }

    function checkRef(ref: TemplateRef, secretsAllowed: boolean, path: (string | number)[]) {
      if (ref.namespace === 'inputs' && !seenInputs.has(ref.name)) {
        ctx.addIssue({ code: 'custom', path, message: `${ref.raw} refers to an undeclared input` });
      }
      if (ref.namespace === 'secrets' && !secretsAllowed) {
        ctx.addIssue({
          code: 'custom',
          path,
          message: `${ref.raw}: secrets are not allowed in URLs, paths, query parameters or assertions`,
        });
      }
      if (ref.namespace === 'outputs' && !availableOutputs.has(ref.name)) {
        ctx.addIssue({ code: 'custom', path, message: `${ref.raw} is not set by any earlier step` });
      }
    }
  });
export type TestDefinitionV1 = z.infer<typeof testDefinitionV1Schema>;
export type TestDefinition = TestDefinitionV1;

/** Definition schemas by schemaVersion. Each revision is validated with its own version. */
export const DEFINITION_SCHEMAS: Readonly<Record<number, z.ZodType<TestDefinition>>> = {
  1: testDefinitionV1Schema,
};

export type ParseDefinitionResult =
  | { ok: true; definition: TestDefinition }
  | { ok: false; code: 'UNSUPPORTED_SCHEMA_VERSION'; message: string }
  | { ok: false; code: 'VALIDATION_ERROR'; error: z.ZodError };

export function parseDefinition(input: unknown): ParseDefinitionResult {
  const version = typeof input === 'object' && input !== null && 'schemaVersion' in input ? input.schemaVersion : undefined;
  if (typeof version !== 'number' || !Object.hasOwn(DEFINITION_SCHEMAS, version)) {
    return {
      ok: false,
      code: 'UNSUPPORTED_SCHEMA_VERSION',
      message: `Unsupported schemaVersion ${JSON.stringify(version)}; supported: ${Object.keys(DEFINITION_SCHEMAS).join(', ')}`,
    };
  }
  const schema = DEFINITION_SCHEMAS[version] as z.ZodType<TestDefinition>;
  const result = schema.safeParse(input);
  return result.success ? { ok: true, definition: result.data } : { ok: false, code: 'VALIDATION_ERROR', error: result.error };
}

export type InputValue = string | number | boolean;

export type ResolveInputsResult =
  | { ok: true; values: Record<string, InputValue> }
  | { ok: false; issues: { input: string; message: string }[] };

/**
 * Validates run inputs against the declared inputs: required ones must be present (or defaulted),
 * types must match exactly (no coercion), undeclared inputs are rejected.
 */
export function resolveInputs(def: TestDefinition, provided: Record<string, InputValue>): ResolveInputsResult {
  const issues: { input: string; message: string }[] = [];
  const values: Record<string, InputValue> = {};
  const declared = new Set(def.inputs.map((i) => i.name));
  for (const name of Object.keys(provided)) {
    if (!declared.has(name)) issues.push({ input: name, message: `Input "${name}" is not declared by the test` });
  }
  for (const input of def.inputs) {
    const value = Object.hasOwn(provided, input.name) ? provided[input.name] : input.default;
    if (value === undefined) {
      if (input.required) issues.push({ input: input.name, message: `Required input "${input.name}" is missing` });
      continue;
    }
    if (typeof value !== input.type) {
      issues.push({ input: input.name, message: `Input "${input.name}" must be a ${input.type}, got ${typeof value}` });
      continue;
    }
    values[input.name] = value;
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, values };
}

/** Names of all secrets a definition refers to ({{secrets.name}}), sorted and unique. */
export function referencedSecrets(def: TestDefinition): string[] {
  const names = new Set<string>();
  for (const { step } of allSteps(def)) {
    for (const tpl of stepTemplates(step)) {
      for (const ref of templateRefs(tpl.value)) if (ref.namespace === 'secrets') names.add(ref.name);
    }
  }
  return [...names].sort();
}

export function allSteps(def: TestDefinition) {
  return [
    ...def.setupSteps.map((step) => ({ phase: 'setup' as const, step })),
    ...def.steps.map((step) => ({ phase: 'main' as const, step })),
    ...def.cleanupSteps.map((step) => ({ phase: 'cleanup' as const, step })),
  ];
}
