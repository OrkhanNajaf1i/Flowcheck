import type { InputDefinition } from '@flowcheck/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { ErrorState, Loading, Notice } from '@/components/ui/states';
import { t } from '@/i18n';
import { ApiError, api } from '@/lib/api';

/** Starts a run of the saved revision after an explicit confirmation that real requests are sent. */
export function RunDialog({
  authProfileId,
  projectId,
  testCaseId,
  inputs,
  onClose,
}: {
  /** Saved login session of the revision being run: only its website is offered. */
  authProfileId?: string | undefined;
  projectId: string;
  testCaseId: string;
  inputs: InputDefinition[];
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const environments = useQuery({ queryKey: ['environments', projectId], queryFn: () => api.environments(projectId) });
  const profiles = useQuery({
    queryKey: ['authProfiles', projectId],
    queryFn: () => api.authProfiles(projectId),
    enabled: !!authProfileId,
  });
  const profileEnvironmentId = profiles.data?.find((p) => p.id === authProfileId)?.environmentId;
  const enabled = (environments.data ?? []).filter((env) => env.enabled && (!profileEnvironmentId || env.id === profileEnvironmentId));
  const onlySite = profileEnvironmentId ? environments.data?.find((env) => env.id === profileEnvironmentId)?.name : undefined;
  const [environmentId, setEnvironmentId] = useState('');
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(inputs.map((input) => [input.name, input.default === undefined ? '' : String(input.default)])),
  );

  const start = useMutation({
    mutationFn: () => {
      const typed: Record<string, string | number | boolean> = {};
      for (const input of inputs) {
        const raw = values[input.name] ?? '';
        if (raw === '' && !input.required) continue;
        // Convert explicitly by declared type; the server rejects any mismatch.
        typed[input.name] = input.type === 'number' ? Number(raw) : input.type === 'boolean' ? raw === 'true' : raw;
      }
      return api.startRun(testCaseId, { environmentId: environmentId || (enabled[0]?.id ?? ''), inputs: typed });
    },
    onSuccess: ({ runId }) => navigate({ to: '/runs/$runId', params: { runId } }),
  });
  const inputIssue = (name: string) =>
    start.error instanceof ApiError ? start.error.issues.find((i) => i.path[1] === name)?.message : undefined;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={t.run.start}>
        {environments.isPending ? (
          <Loading />
        ) : enabled.length === 0 ? (
          <Notice>{t.run.noEnvironments}</Notice>
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              start.mutate();
            }}
          >
            {onlySite ? <Notice>{t.auth.runOnlyOn(onlySite)}</Notice> : null}
            <Field label={t.run.environment} htmlFor="run-env">
              <Select id="run-env" value={environmentId || enabled[0]?.id} onChange={(e) => setEnvironmentId(e.target.value)}>
                {enabled.map((env) => (
                  <option key={env.id} value={env.id}>
                    {env.name} — {env.frontendBaseUrl}
                  </option>
                ))}
              </Select>
            </Field>
            {inputs.length > 0 ? (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-xs font-medium text-muted-foreground">{t.run.inputs}</legend>
                {inputs.map((input) => (
                  <Field
                    key={input.name}
                    label={`${input.name} (${input.type}${input.required ? ', required' : ''})`}
                    error={inputIssue(input.name)}
                  >
                    {input.type === 'boolean' ? (
                      <Select value={values[input.name] ?? ''} onChange={(e) => setValues({ ...values, [input.name]: e.target.value })}>
                        <option value="">—</option>
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </Select>
                    ) : (
                      <Input
                        inputMode={input.type === 'number' ? 'decimal' : undefined}
                        value={values[input.name] ?? ''}
                        onChange={(e) => setValues({ ...values, [input.name]: e.target.value })}
                      />
                    )}
                  </Field>
                ))}
              </fieldset>
            ) : null}
            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {t.run.warning}
            </div>
            {start.isError && !(start.error instanceof ApiError && start.error.issues.length > 0) ? (
              <ErrorState error={start.error} />
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>
                {t.common.cancel}
              </Button>
              <Button type="submit" disabled={start.isPending}>
                {t.run.confirm}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
