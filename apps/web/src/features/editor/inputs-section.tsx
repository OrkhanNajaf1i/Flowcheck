import { INPUT_TYPES } from '@flowcheck/shared';
import { Plus, Trash2 } from 'lucide-react';
import { useFieldArray, useFormContext } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { t } from '@/i18n';
import type { EditorForm } from './definition-form';

export function InputsSection({ issues }: { issues: Map<string, string> }) {
  const { control, register } = useFormContext<EditorForm>();
  const inputs = useFieldArray({ control, name: 'inputs' });

  return (
    <section className="flex flex-col gap-2">
      <div>
        <h3 className="text-sm font-semibold">{t.editor.inputs}</h3>
        <p className="text-xs text-muted-foreground">{t.editor.inputsHint}</p>
      </div>
      {inputs.fields.map((field, i) => {
        const nameError = issues.get(`inputs.${i}.name`);
        const defaultError = issues.get(`inputs.${i}.default`);
        return (
          <div key={field.id} className="flex flex-col gap-1">
            <div className="grid grid-cols-[1fr_110px_1fr_auto_auto] items-center gap-2">
              <Input aria-label={t.steps.inputName} aria-invalid={!!nameError} placeholder="email" {...register(`inputs.${i}.name`)} />
              <Select aria-label={t.steps.inputType} {...register(`inputs.${i}.type`)}>
                {INPUT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </Select>
              <Input
                aria-label={t.steps.inputDefault}
                aria-invalid={!!defaultError}
                placeholder={t.steps.inputDefault}
                {...register(`inputs.${i}.default`)}
              />
              <label className="flex items-center gap-1 text-xs">
                <input type="checkbox" {...register(`inputs.${i}.required`)} /> {t.steps.inputRequired}
              </label>
              <Button variant="ghost" size="icon" aria-label={t.common.delete} onClick={() => inputs.remove(i)}>
                <Trash2 />
              </Button>
            </div>
            {nameError || defaultError ? (
              <p role="alert" className="text-xs text-destructive">
                {nameError ?? defaultError}
              </p>
            ) : null}
          </div>
        );
      })}
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => inputs.append({ name: '', type: 'string', required: true, default: '', description: '' })}
      >
        <Plus /> {t.editor.addInput}
      </Button>
    </section>
  );
}
