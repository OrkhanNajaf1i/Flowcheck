import type { AuthCaptureDto, EnvironmentDto } from '@flowcheck/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, LogIn, Trash2, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { ErrorState, Notice } from '@/components/ui/states';
import { t } from '@/i18n';
import { api } from '@/lib/api';

const FINAL = new Set<AuthCaptureDto['status']>(['saved', 'failed', 'cancelled']);

/** Login sessions of one website, shown inside its card. */
export function LoginSessions({ environment }: { environment: EnvironmentDto }) {
  const queryClient = useQueryClient();
  const profiles = useQuery({ queryKey: ['authProfiles', environment.projectId], queryFn: () => api.authProfiles(environment.projectId) });
  const [creating, setCreating] = useState(false);
  const remove = useMutation({
    mutationFn: api.deleteAuthProfile,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['authProfiles', environment.projectId] }),
  });
  const own = (profiles.data ?? []).filter((p) => p.environmentId === environment.id);

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-2">
      <p className="text-xs font-medium text-muted-foreground">{t.auth.title}</p>
      {own.length === 0 ? <p className="text-xs text-muted-foreground">{t.auth.none}</p> : null}
      <ul className="flex flex-col gap-1">
        {own.map((profile) => (
          <li key={profile.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-2">
              <LogIn className="size-4 text-muted-foreground" aria-hidden /> {profile.name}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`${t.common.delete}: ${profile.name}`}
              onClick={() => window.confirm(t.auth.deleteConfirm(profile.name)) && remove.mutate(profile.id)}
            >
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
      {remove.isError ? <ErrorState error={remove.error} /> : null}
      <Button variant="outline" size="sm" className="self-start" onClick={() => setCreating(true)}>
        <LogIn /> {t.auth.create}
      </Button>
      {creating ? <CaptureDialog environment={environment} onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

function CaptureDialog({ environment, onClose }: { environment: EnvironmentDto; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [startPath, setStartPath] = useState('/login');
  const [captureId, setCaptureId] = useState<string | null>(null);

  const start = useMutation({
    mutationFn: () => api.startAuthCapture(environment.projectId, { environmentId: environment.id, name: name.trim(), startPath }),
    onSuccess: (capture) => setCaptureId(capture.id),
  });
  // Live status from the DB; the runner drives the browser.
  const capture = useQuery({
    queryKey: ['authCapture', captureId],
    queryFn: () => api.authCapture(captureId as string),
    enabled: captureId !== null,
    refetchInterval: (query) => (query.state.data && FINAL.has(query.state.data.status) ? false : 1000),
  });
  const save = useMutation({ mutationFn: () => api.saveAuthCapture(captureId as string), onSuccess: () => capture.refetch() });
  const cancel = useMutation({ mutationFn: () => api.cancelAuthCapture(captureId as string), onSuccess: () => capture.refetch() });

  const status = capture.data?.status;
  const done = status !== undefined && FINAL.has(status);
  useEffect(() => {
    if (status === 'saved') void queryClient.invalidateQueries({ queryKey: ['authProfiles', environment.projectId] });
  }, [status, queryClient, environment.projectId]);

  const close = () => {
    // Closing the dialog while the browser is open would leave the lock held: cancel first.
    if (captureId && !done) cancel.mutate();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent title={`${t.auth.create} — ${environment.name}`} description={t.auth.intro}>
        {captureId === null ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              start.mutate();
            }}
          >
            <Field label={t.auth.name}>
              <Input autoFocus value={name} placeholder={t.auth.namePlaceholder} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={t.auth.startPath} hint={t.auth.startPathHint}>
              <Input value={startPath} onChange={(e) => setStartPath(e.target.value)} />
            </Field>
            <Notice>{t.auth.limits}</Notice>
            {start.isError ? <ErrorState error={start.error} /> : null}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>
                {t.common.cancel}
              </Button>
              <Button type="submit" disabled={start.isPending || name.trim() === ''}>
                {t.auth.start}
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-3" role="status" aria-live="polite">
            <p className="flex items-start gap-2 text-sm">
              {status === 'saved' ? (
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
              ) : status === 'failed' || status === 'cancelled' ? (
                <XCircle className="mt-0.5 size-5 shrink-0 text-destructive" />
              ) : (
                <Loader2 className="mt-0.5 size-5 shrink-0 animate-spin text-primary" />
              )}
              <span data-testid="capture-status">{status ? t.auth.status[status] : t.common.loading}</span>
            </p>
            {capture.data?.error ? <p className="text-xs text-muted-foreground">{capture.data.error}</p> : null}
            {save.isError ? <ErrorState error={save.error} /> : null}
            <div className="flex justify-end gap-2">
              {done ? (
                <Button onClick={onClose}>{t.common.close}</Button>
              ) : (
                <>
                  <Button variant="outline" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
                    {t.common.cancel}
                  </Button>
                  <Button onClick={() => save.mutate()} disabled={status !== 'waiting_for_login' || save.isPending}>
                    {t.auth.save}
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Editor control: which saved login session a test starts with. */
export function LoginSessionPicker({ projectId, value, onChange }: { projectId: string; value: string; onChange: (id: string) => void }) {
  const profiles = useQuery({ queryKey: ['authProfiles', projectId], queryFn: () => api.authProfiles(projectId) });
  const environments = useQuery({ queryKey: ['environments', projectId], queryFn: () => api.environments(projectId) });
  const siteName = (id: string) => environments.data?.find((e) => e.id === id)?.name ?? '?';
  return (
    <Field label={t.auth.pick} hint={t.auth.pickHint}>
      <select
        className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{t.auth.pickNone}</option>
        {(profiles.data ?? []).map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} — {t.auth.forWebsite(siteName(p.environmentId))}
          </option>
        ))}
      </select>
    </Field>
  );
}
