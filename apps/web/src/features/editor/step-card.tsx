import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core';
import {
  ARIA_ROLES,
  type BaseLocator,
  COMMON_KEYS,
  HTTP_METHODS,
  looksGeneratedId,
  MUTATING_HTTP_METHODS,
  NETWORK_CHECK_STEP_TYPES,
  type StepType,
} from '@flowcheck/shared';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Globe,
  GripVertical,
  HelpCircle,
  Keyboard,
  Link,
  ListChecks,
  MousePointerClick,
  Plus,
  Square,
  SquareCheck,
  TextCursorInput,
  ToggleRight,
  Trash2,
  Type,
  Webhook,
} from 'lucide-react';
import { useState } from 'react';
import { type Path, useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { PlainPasswordWarning, SecretPicker } from '@/features/secrets/secrets-panel';
import { t } from '@/i18n';
import { blankAssertion, type EditorForm, type LocatorKind, type Phase, type StepForm, stepSummary } from './definition-form';
import { useEditorContext } from './editor-context';
import { AssertionsEditor, NetworkChecksSection, OutputsEditor } from './response-editors';
import { SuggestFromHtmlDialog } from './suggest-dialog';

/** Step types grouped the way the picker shows them. */
export const STEP_GROUPS: { id: 'actions' | 'checks' | 'api'; types: StepType[] }[] = [
  { id: 'actions', types: ['navigate', 'click', 'fill', 'selectOption', 'check', 'uncheck', 'press'] },
  { id: 'checks', types: ['assertVisible', 'assertText', 'assertHidden', 'assertValue', 'assertEnabled', 'assertUrl'] },
  { id: 'api', types: ['apiRequest'] },
];
export const STEP_TYPES: StepType[] = STEP_GROUPS.flatMap((group) => group.types);
export const STEP_ICONS: Record<StepType, typeof Globe> = {
  navigate: Globe,
  click: MousePointerClick,
  fill: TextCursorInput,
  selectOption: ListChecks,
  check: SquareCheck,
  uncheck: Square,
  press: Keyboard,
  assertVisible: Eye,
  assertText: Type,
  assertHidden: EyeOff,
  assertValue: TextCursorInput,
  assertEnabled: ToggleRight,
  assertUrl: Link,
  apiRequest: Webhook,
};
/** Steps that act on one element chosen with a locator. */
const LOCATOR_STEPS: ReadonlySet<StepType> = new Set([
  'click',
  'fill',
  'selectOption',
  'check',
  'uncheck',
  'assertVisible',
  'assertText',
  'assertHidden',
  'assertValue',
  'assertEnabled',
]);

export interface StepCardProps {
  phase: Phase;
  index: number;
  /** Validation messages keyed by definition path ("steps.0.url"). */
  issues: Map<string, string>;
  onRemove: () => void;
  dragHandle: { attributes: DraggableAttributes; listeners: DraggableSyntheticListeners };
  defaultOpen?: boolean;
}

/** A password-like field filled with literal text instead of a secret. */
function looksLikePlainPassword(step: StepForm): boolean {
  const target = `${step.locator.value} ${step.locator.attrName}`;
  return /pass|parol|şifr|sifr|secret/i.test(target) && step.value.trim() !== '' && !step.value.includes('{{secrets.');
}

export function StepCard({ phase, index, issues, onRemove, dragHandle, defaultOpen = false }: StepCardProps) {
  const { projectId } = useEditorContext();
  const { register, setValue, getValues } = useFormContext<EditorForm>();
  const prefix = `${phase}.${index}` as const;
  const step = useWatch<EditorForm, `${Phase}.${number}`>({ name: prefix }) as StepForm;
  const [open, setOpen] = useState(defaultOpen);
  const err = (sub: string) => issues.get(`${prefix}.${sub}`);
  const stepIssues = [...issues.entries()].filter(([key]) => key === prefix || key.startsWith(`${prefix}.`));
  const Icon = STEP_ICONS[step.type];

  return (
    <div className={`rounded-md border bg-card ${stepIssues.length > 0 ? 'border-destructive/60' : 'border-border'}`}>
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button
          type="button"
          className="cursor-grab rounded p-1 text-muted-foreground hover:bg-muted"
          aria-label={t.common.reorder}
          {...dragHandle.attributes}
          {...dragHandle.listeners}
        >
          <GripVertical className="size-4" />
        </button>
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          {open ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
          <span className="w-5 shrink-0 text-xs text-muted-foreground">{index + 1}.</span>
          <Icon className="size-4 shrink-0 text-primary" aria-hidden />
          <span className={step.name ? 'shrink-0 font-medium' : 'shrink-0 italic text-muted-foreground'}>
            {step.name || t.common.unnamedStep}
          </span>
          <span className="truncate text-xs text-muted-foreground">· {stepSummary(step)}</span>
          {stepIssues.length > 0 ? <AlertTriangle className="size-4 shrink-0 text-destructive" aria-label={t.common.hasErrors} /> : null}
        </button>
        <Button variant="ghost" size="icon" aria-label={t.common.delete} onClick={onRemove}>
          <Trash2 />
        </Button>
      </div>
      {open ? (
        <div className="flex flex-col gap-3 border-t border-border p-3">
          <div className="grid gap-3 md:grid-cols-[200px_1fr]">
            <Field label={t.steps.typeLabel} htmlFor={`${prefix}-type`}>
              <Select
                id={`${prefix}-type`}
                {...register(`${prefix}.type`, {
                  onChange: (e) => {
                    if (e.target.value === 'apiRequest' && getValues(`${prefix}.assertions`).length === 0) {
                      setValue(`${prefix}.assertions`, [blankAssertion()], { shouldDirty: true });
                    }
                  },
                })}
              >
                {STEP_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {t.steps.types[value]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t.steps.stepName} htmlFor={`${prefix}-name`} error={err('name')}>
              <Input
                id={`${prefix}-name`}
                aria-invalid={!!err('name')}
                placeholder={t.steps.stepNamePlaceholder}
                {...register(`${prefix}.name`)}
              />
            </Field>
          </div>

          {step.type === 'navigate' ? (
            <Field label={t.steps.url} htmlFor={`${prefix}-url`} error={err('url')} hint={t.steps.urlHint}>
              <Input id={`${prefix}-url`} aria-invalid={!!err('url')} placeholder="/login" {...register(`${prefix}.url`)} />
            </Field>
          ) : null}

          {LOCATOR_STEPS.has(step.type) || (step.type === 'press' && step.pressOnElement) ? (
            <LocatorFields prefix={prefix} err={err} />
          ) : null}
          {step.type === 'assertHidden' ? <p className="text-xs text-muted-foreground">{t.steps.hiddenRule}</p> : null}

          {step.type === 'fill' ? (
            <div className="flex flex-col gap-2">
              <Field label={t.steps.value} htmlFor={`${prefix}-value`} error={err('value')}>
                <Input id={`${prefix}-value`} aria-invalid={!!err('value')} {...register(`${prefix}.value`)} />
              </Field>
              <SecretPicker projectId={projectId} onPick={(ref) => setValue(`${prefix}.value`, ref, { shouldDirty: true })} />
              {looksLikePlainPassword(step) ? <PlainPasswordWarning /> : null}
            </div>
          ) : null}

          {step.type === 'assertText' ? (
            <div className="grid gap-3 md:grid-cols-[220px_1fr]">
              <Field label={t.steps.textMode} htmlFor={`${prefix}-tm`}>
                <Select id={`${prefix}-tm`} {...register(`${prefix}.textMode`)}>
                  <option value="contains">{t.steps.textModes.contains}</option>
                  <option value="exact">{t.steps.textModes.exact}</option>
                </Select>
              </Field>
              <Field label={t.steps.expectedText} htmlFor={`${prefix}-exp`} error={err('expected')}>
                <Input id={`${prefix}-exp`} aria-invalid={!!err('expected')} {...register(`${prefix}.expected`)} />
              </Field>
              <label className="flex items-center gap-2 text-xs md:col-span-2">
                <input type="checkbox" {...register(`${prefix}.normalizeWhitespace`)} /> {t.steps.normalizeWhitespace}
              </label>
            </div>
          ) : null}

          {step.type === 'assertValue' ? (
            <Field label={t.steps.expectedValue} htmlFor={`${prefix}-exp`} error={err('expected')} hint={t.steps.expectedValueHint}>
              <Input id={`${prefix}-exp`} aria-invalid={!!err('expected')} {...register(`${prefix}.expected`)} />
            </Field>
          ) : null}

          {step.type === 'assertUrl' ? (
            <div className="grid gap-3 md:grid-cols-2">
              <Field label={t.steps.urlMatch} htmlFor={`${prefix}-um`}>
                <Select id={`${prefix}-um`} {...register(`${prefix}.urlMatch`)}>
                  <option value="pathname">{t.steps.urlMatches.pathname}</option>
                  <option value="fullUrl">{t.steps.urlMatches.fullUrl}</option>
                </Select>
              </Field>
              <Field label={t.steps.urlQuery} htmlFor={`${prefix}-uq`}>
                <Select id={`${prefix}-uq`} {...register(`${prefix}.urlQuery`)}>
                  <option value="ignore">{t.steps.urlQueries.ignore}</option>
                  <option value="include">{t.steps.urlQueries.include}</option>
                </Select>
              </Field>
              <Field
                label={t.steps.expectedUrl}
                htmlFor={`${prefix}-exp`}
                error={err('expected')}
                hint={step.urlMatch === 'pathname' ? t.steps.urlHintPathname : t.steps.urlHintFull}
                className="md:col-span-2"
              >
                <Input
                  id={`${prefix}-exp`}
                  aria-invalid={!!err('expected')}
                  placeholder={step.urlMatch === 'pathname' ? '/dashboard' : 'https://staging.example.com/dashboard'}
                  {...register(`${prefix}.expected`)}
                />
              </Field>
            </div>
          ) : null}

          {step.type === 'selectOption' ? (
            <div className="grid gap-3 md:grid-cols-[220px_1fr]">
              <Field label={t.steps.optionBy} htmlFor={`${prefix}-ob`}>
                <Select id={`${prefix}-ob`} {...register(`${prefix}.optionBy`)}>
                  <option value="label">{t.steps.optionBys.label}</option>
                  <option value="value">{t.steps.optionBys.value}</option>
                </Select>
              </Field>
              <Field label={t.steps.optionValue} htmlFor={`${prefix}-ov`} error={err('option.value')}>
                <Input id={`${prefix}-ov`} aria-invalid={!!err('option.value')} {...register(`${prefix}.value`)} />
              </Field>
            </div>
          ) : null}

          {step.type === 'press' ? (
            <div className="grid gap-3 md:grid-cols-[220px_1fr]">
              <Field label={t.steps.key} htmlFor={`${prefix}-key`} error={err('key')} hint={t.steps.keyHint}>
                <Input id={`${prefix}-key`} aria-invalid={!!err('key')} list="flowcheck-keys" {...register(`${prefix}.keyCombo`)} />
              </Field>
              <label className="flex items-start gap-2 self-end pb-2 text-xs">
                <input type="checkbox" className="mt-0.5" {...register(`${prefix}.pressOnElement`)} />
                <span>
                  {t.steps.pressOnElement}
                  <span className="block text-muted-foreground">{t.steps.pressOnElementHint}</span>
                </span>
              </label>
              <datalist id="flowcheck-keys">
                {COMMON_KEYS.map((k) => (
                  <option key={k} value={k} />
                ))}
              </datalist>
            </div>
          ) : null}

          {step.type === 'apiRequest' ? <ApiFields prefix={prefix} err={err} /> : null}

          {(NETWORK_CHECK_STEP_TYPES as readonly string[]).includes(step.type) ? <NetworkChecksSection prefix={prefix} err={err} /> : null}

          <details className="text-sm">
            <summary className="cursor-pointer text-xs text-muted-foreground">{t.common.advanced}</summary>
            <div className="mt-2 max-w-60">
              <Field label={t.steps.timeout} htmlFor={`${prefix}-timeout`} error={err('timeoutMs')} hint={t.steps.timeoutHint}>
                <Input id={`${prefix}-timeout`} inputMode="numeric" {...register(`${prefix}.timeoutMs`)} />
              </Field>
            </div>
          </details>

          {stepIssues.length > 0 ? (
            <ul className="list-inside list-disc text-xs text-destructive" role="alert">
              {stepIssues.map(([key, message]) => (
                <li key={key}>
                  <span className="font-mono">{key.slice(prefix.length + 1) || 'step'}</span>: {message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

type Prefix = `${Phase}.${number}`;

type LocatorPath = `${Phase}.${number}.locator` | `${Phase}.${number}.locator.within`;

function LocatorFields({ prefix, err }: { prefix: Prefix; err: (sub: string) => string | undefined }) {
  const { register } = useFormContext<EditorForm>();
  const withinEnabled = useWatch({ name: `${prefix}.locator.withinEnabled` as Path<EditorForm> }) as boolean;

  return (
    <div className="flex flex-col gap-2 rounded-md bg-muted/60 p-3">
      <LocatorKindFields path={`${prefix}.locator`} idBase={`${prefix}-l`} err={(sub) => err(`locator.${sub}`)} />
      <p className="text-xs text-muted-foreground">{t.steps.locatorRule}</p>

      <div className="flex flex-col gap-2 rounded-md border border-dashed border-border bg-card/60 p-2">
        <label className="flex items-start gap-2 text-xs">
          <input type="checkbox" className="mt-0.5" {...register(`${prefix}.locator.withinEnabled`)} />
          <span>
            <span className="font-medium">{t.steps.withinToggle}</span>
            <span className="block text-muted-foreground">{t.steps.withinHint}</span>
          </span>
        </label>
        {withinEnabled ? (
          <LocatorKindFields path={`${prefix}.locator.within`} idBase={`${prefix}-w`} err={(sub) => err(`locator.within.${sub}`)} />
        ) : null}
      </div>

      <details className="text-xs">
        <summary className="inline-flex cursor-pointer items-center gap-1 text-primary">
          <HelpCircle className="size-3.5" /> {t.steps.locatorHelpTitle}
        </summary>
        <ol className="mt-1 list-inside list-decimal space-y-0.5 text-muted-foreground">
          {t.steps.locatorHelp.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
      </details>
    </div>
  );
}

/** "Find the element by" + its value fields; used for the element and for its container. */
function LocatorKindFields({ path, idBase, err }: { path: LocatorPath; idBase: string; err: (sub: string) => string | undefined }) {
  const { register, setValue } = useFormContext<EditorForm>();
  const reg = (field: string) => register(`${path}.${field}` as Path<EditorForm>);
  const fill = (locator: BaseLocator) => {
    const set = (field: string, value: unknown) =>
      setValue(`${path}.${field}` as Path<EditorForm>, value as never, { shouldDirty: true, shouldValidate: false });
    set('kind', locator.kind);
    set('value', locator.kind === 'role' ? locator.name : locator.value);
    if (locator.kind === 'role') set('role', locator.role);
    if (locator.kind === 'attribute') set('attrName', locator.name);
    if ('exact' in locator) set('exact', locator.exact);
  };
  const kind = useWatch({ name: `${path}.kind` as Path<EditorForm> }) as LocatorKind;
  const value = useWatch({ name: `${path}.value` as Path<EditorForm> }) as string | undefined;
  const valueError = err('value') ?? err('name');
  const isContainer = path.endsWith('.within');

  return (
    <>
      <div className="grid gap-3 md:grid-cols-[260px_1fr]">
        <Field label={isContainer ? t.steps.withinKind : t.steps.locatorKind} htmlFor={`${idBase}k`}>
          <Select id={`${idBase}k`} {...reg('kind')}>
            {Object.entries(t.steps.locatorKinds).map(([option, label]) => (
              <option key={option} value={option}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        {kind === 'attribute' ? (
          <div className="grid grid-cols-[150px_1fr] gap-3">
            <Field label={t.steps.attrName} htmlFor={`${idBase}an`} error={err('name')}>
              <Input id={`${idBase}an`} aria-invalid={!!err('name')} placeholder="name" {...reg('attrName')} />
            </Field>
            <Field label={t.steps.attrValue} htmlFor={`${idBase}v`} error={valueError}>
              <Input id={`${idBase}v`} aria-invalid={!!valueError} placeholder="email" {...reg('value')} />
            </Field>
          </div>
        ) : kind === 'role' ? (
          <div className="grid grid-cols-[130px_1fr] gap-3">
            <Field label={t.steps.role} htmlFor={`${idBase}r`}>
              <Select id={`${idBase}r`} {...reg('role')}>
                {ARIA_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t.steps.accessibleName} htmlFor={`${idBase}v`} error={valueError}>
              <Input id={`${idBase}v`} aria-invalid={!!valueError} placeholder={t.steps.locatorPlaceholders.role} {...reg('value')} />
            </Field>
          </div>
        ) : (
          <Field label={isContainer ? t.steps.withinValue : t.steps.locator} htmlFor={`${idBase}v`} error={valueError}>
            <Input
              id={`${idBase}v`}
              aria-invalid={!!valueError}
              placeholder={isContainer && kind === 'id' ? 'header' : t.steps.locatorPlaceholders[kind]}
              {...reg('value')}
            />
          </Field>
        )}
      </div>
      {kind === 'id' && looksGeneratedId(value ?? '') ? <p className="text-xs text-warning">⚠ {t.steps.generatedId}</p> : null}
      {kind === 'label' || kind === 'placeholder' || kind === 'text' || kind === 'altText' || kind === 'title' ? (
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" {...reg('exact')} /> {t.steps.exact}
        </label>
      ) : null}
      {kind === 'css' ? <p className="text-xs text-warning">⚠ {t.steps.fragile}</p> : null}
      <SuggestFromHtmlDialog onPick={fill} />
    </>
  );
}

function ApiFields({ prefix, err }: { prefix: Prefix; err: (sub: string) => string | undefined }) {
  const { register, control } = useFormContext<EditorForm>();
  const headers = useFieldArray({ control, name: `${prefix}.headers` });
  const method = useWatch<EditorForm, `${Phase}.${number}.method`>({ name: `${prefix}.method` });

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-[120px_1fr_260px]">
        <Field label={t.steps.method} htmlFor={`${prefix}-method`}>
          <Select id={`${prefix}-method`} {...register(`${prefix}.method`)}>
            {HTTP_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t.steps.path} htmlFor={`${prefix}-path`} error={err('path')} hint={t.steps.pathHint}>
          <Input
            id={`${prefix}-path`}
            aria-invalid={!!err('path')}
            placeholder="/orders/{{inputs.orderId}}"
            {...register(`${prefix}.path`)}
          />
        </Field>
        <Field label={t.steps.auth} htmlFor={`${prefix}-auth`}>
          <Select id={`${prefix}-auth`} {...register(`${prefix}.auth`)}>
            <option value="browserCookies">{t.steps.authKinds.browserCookies}</option>
            <option value="none">{t.steps.authKinds.none}</option>
          </Select>
        </Field>
      </div>
      {(MUTATING_HTTP_METHODS as readonly string[]).includes(method) ? (
        <p className="text-xs text-muted-foreground">{t.steps.mutatingNote}</p>
      ) : null}

      <AssertionsEditor path={`${prefix}.assertions`} err={(sub) => err(`assertions.${sub}`)} />
      <OutputsEditor path={`${prefix}.outputs`} err={(sub) => err(`outputs.${sub}`)} />

      <details className="text-sm" open={headers.fields.length > 0 || (method !== 'GET' && method !== 'HEAD')}>
        <summary className="cursor-pointer text-xs text-muted-foreground">
          {t.steps.headers} / {t.steps.body}
        </summary>
        <div className="mt-2 flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">{t.steps.headers}</span>
            {headers.fields.map((field, i) => (
              <div key={field.id} className="grid grid-cols-[1fr_2fr_auto] gap-2">
                <Input aria-label={t.steps.headerName} placeholder="X-Request-Id" {...register(`${prefix}.headers.${i}.name`)} />
                <Input aria-label={t.steps.headerValue} {...register(`${prefix}.headers.${i}.value`)} />
                <Button variant="ghost" size="icon" aria-label={t.common.delete} onClick={() => headers.remove(i)}>
                  <Trash2 />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" className="self-start" onClick={() => headers.append({ name: '', value: '' })}>
              <Plus /> {t.steps.addHeader}
            </Button>
          </div>
          {method !== 'GET' && method !== 'HEAD' ? (
            <Field label={t.steps.body} htmlFor={`${prefix}-body`} error={err('body')} hint={t.steps.bodyHint}>
              <Textarea id={`${prefix}-body`} rows={4} placeholder={'{\n  "productId": "p-1"\n}'} {...register(`${prefix}.body`)} />
            </Field>
          ) : null}
        </div>
      </details>
    </div>
  );
}
