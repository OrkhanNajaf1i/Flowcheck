import { HTTP_METHODS, JSON_VALUE_TYPES } from '@flowcheck/shared';
import { Network, Plus, Trash2 } from 'lucide-react';
import { type Path, useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { t } from '@/i18n';
import {
  type AssertionForm,
  type AssertionKind,
  blankAssertion,
  blankNetworkCheck,
  blankOutput,
  type EditorForm,
  type OutputForm,
} from './definition-form';

const ASSERTION_KINDS = Object.keys(t.steps.assertionKinds) as AssertionKind[];
type Err = (sub: string) => string | undefined;
const asPath = (p: string) => p as Path<EditorForm>;

/** "Expected response" list, shared by API requests and network checks. */
export function AssertionsEditor({ path, err }: { path: string; err: Err }) {
  const { register, control } = useFormContext<EditorForm>();
  const assertions = useFieldArray({ control, name: asPath(path) as `steps.${number}.assertions` });
  const kinds = (useWatch({ name: asPath(path) }) as AssertionForm[] | undefined) ?? [];
  const hasStatus = kinds.some((a) => a.kind === 'statusEquals' || a.kind === 'statusIn');

  return (
    <div className="flex flex-col gap-2 rounded-md bg-muted/60 p-3">
      <span className="text-xs font-medium text-muted-foreground">{t.steps.assertions}</span>
      {!hasStatus ? <p className="text-xs text-warning">⚠ {t.steps.noStatusWarning}</p> : null}
      {assertions.fields.map((field, i) => {
        const kind = kinds[i]?.kind ?? 'statusEquals';
        const needsPointer = kind.startsWith('json');
        const needsName = kind === 'headerEquals' || kind === 'headerContains';
        const expectedError = err(`${i}.expected`);
        return (
          <div key={field.id} className="grid items-start gap-2 md:grid-cols-[190px_1fr_1fr_auto]">
            <Select aria-label={t.steps.check} {...register(asPath(`${path}.${i}.kind`))}>
              {ASSERTION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t.steps.assertionKinds[k]}
                </option>
              ))}
            </Select>
            {needsPointer ? (
              <Field label={t.steps.pointer} error={err(`${i}.pointer`)} hint={t.steps.pointerHint}>
                <Input placeholder="/id" {...register(asPath(`${path}.${i}.pointer`))} />
              </Field>
            ) : needsName ? (
              <Field label={t.steps.headerName} error={err(`${i}.name`)}>
                <Input placeholder="content-type" {...register(asPath(`${path}.${i}.name`))} />
              </Field>
            ) : (
              <div />
            )}
            {kind === 'jsonExists' ? (
              <div />
            ) : kind === 'jsonType' ? (
              <Field label={t.steps.expected}>
                <Select {...register(asPath(`${path}.${i}.expected`))}>
                  {JSON_VALUE_TYPES.map((jt) => (
                    <option key={jt} value={jt}>
                      {jt}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <Field
                label={kind === 'statusIn' ? t.steps.statusList : t.steps.expected}
                error={expectedError}
                hint={kind === 'jsonEquals' ? t.steps.expectedJsonHint : undefined}
              >
                <Input aria-invalid={!!expectedError} {...register(asPath(`${path}.${i}.expected`))} />
              </Field>
            )}
            <Button variant="ghost" size="icon" aria-label={t.common.delete} onClick={() => assertions.remove(i)}>
              <Trash2 />
            </Button>
          </div>
        );
      })}
      <Button variant="outline" size="sm" className="self-start" onClick={() => assertions.append(blankAssertion('statusEquals'))}>
        <Plus /> {t.steps.addAssertion}
      </Button>
    </div>
  );
}

/** Values to keep from a passed response as {{outputs.name}}. */
export function OutputsEditor({ path, err }: { path: string; err: Err }) {
  const { register, control } = useFormContext<EditorForm>();
  const outputs = useFieldArray({ control, name: asPath(path) as `steps.${number}.outputs` });
  const values = (useWatch({ name: asPath(path) }) as OutputForm[] | undefined) ?? [];

  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed border-border p-3">
      <span className="text-xs font-medium text-muted-foreground">{t.network.outputs}</span>
      <p className="text-xs text-muted-foreground">{t.network.outputsHint}</p>
      {outputs.fields.map((field, i) => {
        const output = values[i];
        return (
          <div key={field.id} className="flex flex-col gap-1">
            <div className="grid items-start gap-2 md:grid-cols-[1fr_150px_1fr_auto]">
              <Field label={t.network.outputName} error={err(`${i}.name`)}>
                <Input placeholder="orderId" {...register(asPath(`${path}.${i}.name`))} />
              </Field>
              <Field label={t.network.outputFrom}>
                <Select {...register(asPath(`${path}.${i}.from`))}>
                  <option value="json">{t.network.outputFromJson}</option>
                  <option value="header">{t.network.outputFromHeader}</option>
                </Select>
              </Field>
              {output?.from === 'header' ? (
                <Field label={t.steps.headerName} error={err(`${i}.header`)}>
                  <Input placeholder="location" {...register(asPath(`${path}.${i}.header`))} />
                </Field>
              ) : (
                <Field label={t.steps.pointer} error={err(`${i}.pointer`)} hint={t.steps.pointerHint}>
                  <Input placeholder="/id" {...register(asPath(`${path}.${i}.pointer`))} />
                </Field>
              )}
              <Button variant="ghost" size="icon" aria-label={t.common.delete} onClick={() => outputs.remove(i)}>
                <Trash2 />
              </Button>
            </div>
            {output?.name ? (
              <p className="font-mono text-xs text-primary">{t.network.referenceHint(`{{outputs.${output.name.trim()}}}`)}</p>
            ) : null}
          </div>
        );
      })}
      <Button variant="outline" size="sm" className="self-start" onClick={() => outputs.append(blankOutput())}>
        <Plus /> {t.network.addOutput}
      </Button>
    </div>
  );
}

/** Requests the step's action must send, observed in the browser (never re-sent). */
export function NetworkChecksSection({ prefix, err }: { prefix: `${string}.${number}`; err: Err }) {
  const { register, control } = useFormContext<EditorForm>();
  const path = `${prefix}.networkChecks`;
  const checks = useFieldArray({ control, name: asPath(path) as `steps.${number}.networkChecks`, keyName: 'fieldKey' });
  const values = (useWatch({ name: asPath(path) }) as { originMode: string }[] | undefined) ?? [];

  return (
    <details className="rounded-md border border-dashed border-border" open={checks.fields.length > 0}>
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium">
        <Network className="size-4 text-primary" aria-hidden /> {t.network.title}{' '}
        {checks.fields.length > 0 ? `(${checks.fields.length})` : ''}
      </summary>
      <div className="flex flex-col gap-3 border-t border-dashed border-border p-3">
        <p className="text-xs text-muted-foreground">{t.network.hint}</p>
        {checks.fields.map((field, i) => {
          const base = `${path}.${i}`;
          const e: Err = (sub) => err(`networkChecks.${i}.${sub}`);
          return (
            <div
              key={field.fieldKey}
              className="flex flex-col gap-3 rounded-md border border-border bg-card p-3"
              data-testid={`network-check-${i}`}
            >
              <div className="flex items-end gap-2">
                <Field label={t.network.name} className="flex-1" error={e('name')}>
                  <Input placeholder={t.network.namePlaceholder} {...register(asPath(`${base}.name`))} />
                </Field>
                <Button variant="ghost" size="icon" aria-label={t.common.delete} onClick={() => checks.remove(i)}>
                  <Trash2 />
                </Button>
              </div>
              <div className="grid gap-3 md:grid-cols-[180px_110px_1fr]">
                <Field label={t.network.origin}>
                  <Select {...register(asPath(`${base}.originMode`))}>
                    <option value="api">{t.network.originApi}</option>
                    <option value="frontend">{t.network.originFrontend}</option>
                    <option value="custom">{t.network.originCustom}</option>
                  </Select>
                </Field>
                <Field label={t.steps.method}>
                  <Select {...register(asPath(`${base}.method`))}>
                    {HTTP_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t.network.pathname} error={e('match.pathname')} hint={t.network.pathnameHint}>
                  <Input placeholder="/api/orders" {...register(asPath(`${base}.pathname`))} />
                </Field>
              </div>
              {values[i]?.originMode === 'custom' ? (
                <Field label={t.network.customOrigin} error={e('match.origin')}>
                  <Input placeholder="https://api.example.com" {...register(asPath(`${base}.origin`))} />
                </Field>
              ) : null}
              <div className="grid gap-3 md:grid-cols-[1fr_180px]">
                <Field label={t.network.query} hint={t.network.queryHint}>
                  <Input placeholder="draft=false" {...register(asPath(`${base}.query`))} />
                </Field>
                <Field label={t.network.timeout} error={e('timeoutMs')} hint={t.network.timeoutHint}>
                  <Input inputMode="numeric" {...register(asPath(`${base}.timeoutMs`))} />
                </Field>
              </div>
              <AssertionsEditor path={`${base}.assertions`} err={(sub) => e(`assertions.${sub}`)} />
              <OutputsEditor path={`${base}.outputs`} err={(sub) => e(`outputs.${sub}`)} />
            </div>
          );
        })}
        <Button variant="outline" size="sm" className="self-start" onClick={() => checks.append(blankNetworkCheck(t.network.defaultName))}>
          <Plus /> {t.network.add}
        </Button>
      </div>
    </details>
  );
}
