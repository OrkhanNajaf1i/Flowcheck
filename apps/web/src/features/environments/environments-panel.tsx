import { baseUrlSchema, type CreateEnvironmentBody, type EnvironmentDto, environmentKindSchema, originSchema } from '@flowcheck/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Globe, Pencil, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Empty, ErrorState, Loading, Notice } from '@/components/ui/states';
import { Switch } from '@/components/ui/switch';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { applyServerErrors } from '@/lib/form-errors';

const optionalBaseUrl = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    if (value === '') return;
    const result = baseUrlSchema.safeParse(value);
    if (!result.success) ctx.addIssue({ code: 'custom', message: result.error.issues[0]?.message ?? 'Invalid URL' });
  });

/**
 * Friendly form shape: only the website address is required. An empty name becomes the
 * host name, an empty API address becomes the website address, and extra domains are typed
 * one per line. The server still validates the final body.
 */
const environmentFormSchema = z
  .object({
    name: z.string().trim().max(100),
    frontendBaseUrl: z.string().trim().pipe(baseUrlSchema),
    apiBaseUrl: optionalBaseUrl,
    kind: environmentKindSchema,
    allowedOrigins: z.string().transform((text, ctx) => {
      const origins = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const parsed = z.array(originSchema).max(50).safeParse(origins);
      if (!parsed.success) {
        ctx.addIssue({ code: 'custom', message: parsed.error.issues[0]?.message ?? 'Invalid origin' });
        return z.NEVER;
      }
      return parsed.data;
    }),
    allowPrivateNetwork: z.boolean(),
    enabled: z.boolean(),
  })
  .transform(
    (v): CreateEnvironmentBody => ({
      ...v,
      name: v.name || new URL(v.frontendBaseUrl).host,
      apiBaseUrl: v.apiBaseUrl || v.frontendBaseUrl,
    }),
  );
type EnvironmentFormInput = z.input<typeof environmentFormSchema>;

/** Loopback, private and link-local host names/addresses that need "Allow private network". */
export function looksLocal(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    return false;
  }
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host === '::1' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host)
  );
}

export function EnvironmentsPanel({ projectId, openNewSignal = 0 }: { projectId: string; openNewSignal?: number }) {
  const environments = useQuery({ queryKey: ['environments', projectId], queryFn: () => api.environments(projectId) });
  const [editing, setEditing] = useState<EnvironmentDto | 'new' | null>(null);

  useEffect(() => {
    if (openNewSignal > 0) setEditing('new');
  }, [openNewSignal]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t.environments.realRequests}</p>
        <Button onClick={() => setEditing('new')}>
          <Plus /> {t.environments.new}
        </Button>
      </div>
      {environments.isPending ? (
        <Loading />
      ) : environments.isError ? (
        <ErrorState error={environments.error} />
      ) : environments.data.length === 0 ? (
        <Card>
          <Empty title={t.environments.empty}>
            <p>{t.environments.emptyHint}</p>
            <Button className="mt-3" onClick={() => setEditing('new')}>
              <Plus /> {t.environments.new}
            </Button>
          </Empty>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {environments.data.map((env) => (
            <Card key={env.id}>
              <CardContent className="flex flex-col gap-2 text-sm">
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-2 font-medium">
                    <Globe className="size-4 text-muted-foreground" /> {env.name}
                    {!env.enabled ? <span className="rounded bg-warning/20 px-1.5 text-xs">{t.environments.disabled}</span> : null}
                  </p>
                  <Button variant="ghost" size="icon" aria-label={t.environments.edit} onClick={() => setEditing(env)}>
                    <Pencil />
                  </Button>
                </div>
                <a
                  href={env.frontendBaseUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all font-mono text-xs text-primary hover:underline"
                >
                  {env.frontendBaseUrl}
                </a>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  {env.apiBaseUrl !== env.frontendBaseUrl ? (
                    <>
                      <dt className="text-muted-foreground">{t.environments.apiBaseUrl}</dt>
                      <dd className="break-all font-mono">{env.apiBaseUrl}</dd>
                    </>
                  ) : null}
                  <dt className="text-muted-foreground">{t.environments.effective}</dt>
                  <dd className="break-all font-mono">{env.effectiveAllowedOrigins.join(', ')}</dd>
                  <dt className="text-muted-foreground">{t.environments.allowPrivateNetwork}</dt>
                  <dd>{env.allowPrivateNetwork ? t.common.yes : t.common.no}</dd>
                </dl>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {editing !== null ? (
        <EnvironmentDialog projectId={projectId} environment={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
}

function EnvironmentDialog({
  projectId,
  environment,
  onClose,
}: {
  projectId: string;
  environment: EnvironmentDto | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm<EnvironmentFormInput, unknown, CreateEnvironmentBody>({
    resolver: zodResolver(environmentFormSchema),
    defaultValues: environment
      ? {
          name: environment.name,
          kind: environment.kind,
          frontendBaseUrl: environment.frontendBaseUrl,
          apiBaseUrl: environment.apiBaseUrl === environment.frontendBaseUrl ? '' : environment.apiBaseUrl,
          allowedOrigins: environment.allowedOrigins.join('\n'),
          allowPrivateNetwork: environment.allowPrivateNetwork,
          enabled: environment.enabled,
        }
      : { name: '', kind: 'staging', frontendBaseUrl: '', apiBaseUrl: '', allowedOrigins: '', allowPrivateNetwork: false, enabled: true },
  });
  const save = useMutation({
    mutationFn: (values: CreateEnvironmentBody) =>
      environment ? api.updateEnvironment(environment.id, values) : api.createEnvironment(projectId, values),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['environments', projectId] });
      onClose();
    },
    onError: (error) => applyServerErrors(error, form.setError),
  });
  const errors = form.formState.errors;
  const [frontend, apiUrl, allowPrivate] = useWatch({
    control: form.control,
    name: ['frontendBaseUrl', 'apiBaseUrl', 'allowPrivateNetwork'],
  });
  const local = looksLocal(frontend) || looksLocal(apiUrl ?? '');
  const needsPrivate = local && !allowPrivate;
  const hasAdvancedError = !!(errors.apiBaseUrl || errors.allowedOrigins || errors.kind);
  const [advancedOpen, setAdvancedOpen] = useState(
    environment !== null && (environment.allowPrivateNetwork || environment.allowedOrigins.length > 0),
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={environment ? t.environments.edit : t.environments.new} className="w-[min(640px,calc(100vw-2rem))]">
        <form className="flex flex-col gap-3" onSubmit={form.handleSubmit((values) => save.mutate(values))}>
          <Field
            label={t.environments.frontendBaseUrl}
            htmlFor="env-frontend"
            error={errors.frontendBaseUrl?.message}
            hint={t.environments.frontendHint}
          >
            <Input
              id="env-frontend"
              autoFocus
              inputMode="url"
              placeholder="https://staging.example.com"
              aria-invalid={!!errors.frontendBaseUrl}
              {...form.register('frontendBaseUrl')}
            />
          </Field>
          <Field label={`${t.environments.nameLabel} (${t.common.optional})`} htmlFor="env-name" error={errors.name?.message}>
            <Input id="env-name" placeholder={t.environments.namePlaceholder} aria-invalid={!!errors.name} {...form.register('name')} />
          </Field>
          {needsPrivate ? (
            <Notice tone="warning">
              <span className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {t.environments.localDetected}
              </span>
            </Notice>
          ) : null}

          <details
            className="rounded-md border border-border"
            open={advancedOpen || needsPrivate || hasAdvancedError}
            onToggle={(e) => setAdvancedOpen(e.currentTarget.open)}
          >
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium">{t.common.advanced}</summary>
            <div className="flex flex-col gap-3 border-t border-border p-3">
              <Field
                label={`${t.environments.apiBaseUrl} (${t.common.optional})`}
                htmlFor="env-api"
                error={errors.apiBaseUrl?.message}
                hint={t.environments.apiHint}
              >
                <Input
                  id="env-api"
                  inputMode="url"
                  placeholder="https://staging.example.com/api"
                  aria-invalid={!!errors.apiBaseUrl}
                  {...form.register('apiBaseUrl')}
                />
              </Field>
              <Field
                label={t.environments.allowedOrigins}
                htmlFor="env-origins"
                error={errors.allowedOrigins?.message}
                hint={t.environments.allowedOriginsHint}
              >
                <Textarea id="env-origins" rows={3} placeholder="https://fonts.googleapis.com" {...form.register('allowedOrigins')} />
              </Field>
              <Controller
                control={form.control}
                name="allowPrivateNetwork"
                render={({ field }) => (
                  <div className="flex items-start gap-3 text-sm">
                    <Switch
                      id="env-private"
                      aria-describedby="env-private-hint"
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      className="mt-0.5"
                    />
                    <div>
                      <label htmlFor="env-private" className="font-medium">
                        {t.environments.allowPrivateNetwork}
                      </label>
                      <p id="env-private-hint" className="text-xs text-muted-foreground">
                        {t.environments.allowPrivateNetworkHint}
                      </p>
                    </div>
                  </div>
                )}
              />
              <div className="grid grid-cols-2 gap-3">
                <Field label={t.environments.kind} htmlFor="env-kind">
                  <Select id="env-kind" {...form.register('kind')}>
                    <option value="staging">staging</option>
                    <option value="local">local</option>
                  </Select>
                </Field>
                <Controller
                  control={form.control}
                  name="enabled"
                  render={({ field }) => (
                    <div className="flex items-center gap-3 self-end pb-2 text-sm">
                      <Switch id="env-enabled" checked={field.value} onCheckedChange={field.onChange} />
                      <label htmlFor="env-enabled" className="font-medium">
                        {t.environments.enabled}
                      </label>
                    </div>
                  )}
                />
              </div>
            </div>
          </details>

          {errors.root ? <p className="text-sm text-destructive">{errors.root.message}</p> : null}
          {/* Stays visible while the dialog body scrolls. */}
          <div className="sticky bottom-0 -mx-5 -mb-5 flex justify-end gap-2 border-t border-border bg-card px-5 py-3">
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
