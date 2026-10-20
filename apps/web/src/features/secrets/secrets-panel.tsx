import { createSecretSchema, type SecretDto } from '@flowcheck/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Empty, ErrorState, Loading, Notice } from '@/components/ui/states';
import { t } from '@/i18n';
import { ApiError, api } from '@/lib/api';
import { applyServerErrors } from '@/lib/form-errors';
import { formatDateTime } from '@/lib/utils';

type SecretForm = z.input<typeof createSecretSchema>;

/** Secrets of a project: names only — values are write-only. */
export function SecretsPanel({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const secrets = useQuery({ queryKey: ['secrets', projectId], queryFn: () => api.secrets(projectId) });
  const [adding, setAdding] = useState(false);
  const [replacing, setReplacing] = useState<SecretDto | null>(null);
  const remove = useMutation({
    mutationFn: api.deleteSecret,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['secrets', projectId] }),
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1 text-sm text-muted-foreground">
          <p>{t.secrets.intro}</p>
          <p className="text-xs">{t.secrets.keyNote}</p>
        </div>
        <Button onClick={() => setAdding(true)}>
          <Plus /> {t.secrets.add}
        </Button>
      </div>
      {remove.isError ? <ErrorState error={remove.error} /> : null}
      <Card>
        {secrets.isPending ? (
          <Loading />
        ) : secrets.isError ? (
          <ErrorState error={secrets.error} />
        ) : secrets.data.length === 0 ? (
          <Empty title={t.secrets.empty} />
        ) : (
          <ul className="divide-y divide-border">
            {secrets.data.map((secret) => (
              <li key={secret.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <div>
                  <p className="flex items-center gap-2 font-medium">
                    <KeyRound className="size-4 text-muted-foreground" aria-hidden /> {secret.name}
                    <span className="font-mono text-xs text-muted-foreground">••••••••</span>
                  </p>
                  <p className="font-mono text-xs text-primary">{t.secrets.usage(`{{secrets.${secret.name}}}`)}</p>
                </div>
                <div className="flex items-center gap-1">
                  <span className="mr-2 text-xs text-muted-foreground">
                    {t.secrets.updated}: {formatDateTime(secret.updatedAt)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    title={t.secrets.replace}
                    aria-label={`${t.secrets.replace}: ${secret.name}`}
                    onClick={() => setReplacing(secret)}
                  >
                    <RefreshCw />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title={t.common.delete}
                    aria-label={`${t.common.delete}: ${secret.name}`}
                    onClick={() => window.confirm(t.secrets.deleteConfirm(secret.name)) && remove.mutate(secret.id)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {adding ? <AddSecretDialog projectId={projectId} onClose={() => setAdding(false)} /> : null}
      {replacing ? <ReplaceSecretDialog projectId={projectId} secret={replacing} onClose={() => setReplacing(null)} /> : null}
    </div>
  );
}

function AddSecretDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const form = useForm<SecretForm>({ resolver: zodResolver(createSecretSchema), defaultValues: { name: '', value: '' } });
  const save = useMutation({
    mutationFn: (values: SecretForm) => api.createSecret(projectId, values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['secrets', projectId] });
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'SECRET_TOO_SHORT') form.setError('value', { message: error.message });
      else applyServerErrors(error, form.setError);
    },
  });
  const errors = form.formState.errors;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={t.secrets.add}>
        <form className="flex flex-col gap-3" onSubmit={form.handleSubmit((values) => save.mutate(values))}>
          <Field label={t.secrets.name} error={errors.name?.message} hint={t.secrets.nameHint}>
            <Input autoFocus autoComplete="off" placeholder="testPassword" aria-invalid={!!errors.name} {...form.register('name')} />
          </Field>
          <Field label={t.secrets.value} error={errors.value?.message} hint={t.secrets.valueHint}>
            <Input type="password" autoComplete="new-password" aria-invalid={!!errors.value} {...form.register('value')} />
          </Field>
          {errors.root ? <p className="text-sm text-destructive">{errors.root.message}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? t.common.saving : t.common.save}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReplaceSecretDialog({ projectId, secret, onClose }: { projectId: string; secret: SecretDto; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState('');
  const save = useMutation({
    mutationFn: () => api.replaceSecret(secret.id, value),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['secrets', projectId] });
      onClose();
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={t.secrets.replaceTitle(secret.name)}>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field label={t.secrets.value} hint={t.secrets.valueHint} error={save.error instanceof ApiError ? save.error.message : undefined}>
            <Input type="password" autoFocus autoComplete="new-password" value={value} onChange={(e) => setValue(e.target.value)} />
          </Field>
          {save.isError && !(save.error instanceof ApiError) ? <ErrorState error={save.error} /> : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={save.isPending || value === ''}>
              {t.common.save}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** For "Type text" steps: put {{secrets.name}} into the value field. */
export function SecretPicker({ projectId, onPick }: { projectId: string; onPick: (reference: string) => void }) {
  const secrets = useQuery({ queryKey: ['secrets', projectId], queryFn: () => api.secrets(projectId) });
  if (secrets.isPending || secrets.isError) return null;
  if (secrets.data.length === 0) return <p className="text-xs text-muted-foreground">{t.secrets.insertNone}</p>;
  return (
    <label className="flex items-center gap-2 text-xs">
      <KeyRound className="size-3.5 text-muted-foreground" aria-hidden />
      <span>{t.secrets.insert}:</span>
      <select
        className="rounded border border-border bg-card px-1.5 py-0.5"
        value=""
        onChange={(e) => e.target.value && onPick(`{{secrets.${e.target.value}}}`)}
      >
        <option value="">—</option>
        {secrets.data.map((s) => (
          <option key={s.id} value={s.name}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function PlainPasswordWarning() {
  return <Notice tone="warning">{t.secrets.plainPasswordWarning}</Notice>;
}
