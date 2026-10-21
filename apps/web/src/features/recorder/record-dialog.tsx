import type { RecorderWarning, RecordingDto, Step } from '@flowcheck/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { ErrorState, Loading, Notice } from '@/components/ui/states';
import { language, t } from '@/i18n';
import { api } from '@/lib/api';

const FINAL = new Set<RecordingDto['status']>(['stopped', 'failed']);

/**
 * Records steps in a browser opened by the runner (PROJECT_RULES §8). The result is a draft:
 * the steps are added to the form and nothing is saved until the tester presses Save.
 */
export function RecordDialog({
  projectId,
  testCaseId,
  mainIsEmpty,
  onAdd,
  onClose,
}: {
  projectId: string;
  testCaseId: string;
  /** With no main steps yet the "Open page" step is kept by default. */
  mainIsEmpty: boolean;
  onAdd: (steps: Step[]) => void;
  onClose: () => void;
}) {
  const environments = useQuery({ queryKey: ['environments', projectId], queryFn: () => api.environments(projectId) });
  const enabled = (environments.data ?? []).filter((env) => env.enabled);
  const [environmentId, setEnvironmentId] = useState('');
  const [startPath, setStartPath] = useState('/');
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [includeOpen, setIncludeOpen] = useState(mainIsEmpty);

  const start = useMutation({
    mutationFn: () =>
      api.startRecording(projectId, { environmentId: environmentId || (enabled[0]?.id ?? ''), startPath, testCaseId, language }),
    onSuccess: (recording) => setRecordingId(recording.id),
  });
  // Live draft from the DB; the runner drives the browser.
  const recording = useQuery({
    queryKey: ['recording', recordingId],
    queryFn: () => api.recording(recordingId as string),
    enabled: recordingId !== null,
    refetchInterval: (query) => (query.state.data && FINAL.has(query.state.data.status) ? false : 1000),
  });
  const stop = useMutation({ mutationFn: () => api.stopRecording(recordingId as string), onSuccess: () => recording.refetch() });

  const status = recording.data?.status;
  const done = status !== undefined && FINAL.has(status);
  const steps = recording.data?.steps ?? [];
  const chosen = includeOpen ? steps : steps.slice(1);

  const close = () => {
    // Closing while the browser is open would keep the execution lock: stop first.
    if (recordingId && !done) stop.mutate();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent title={t.recorder.title} description={t.recorder.intro}>
        {recordingId === null ? (
          environments.isPending ? (
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
              <Field label={t.recorder.website} htmlFor="record-env">
                <Select id="record-env" value={environmentId || enabled[0]?.id} onChange={(e) => setEnvironmentId(e.target.value)}>
                  {enabled.map((env) => (
                    <option key={env.id} value={env.id}>
                      {env.name} — {env.frontendBaseUrl}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t.recorder.startPath} hint={t.recorder.startPathHint}>
                <Input value={startPath} onChange={(e) => setStartPath(e.target.value)} />
              </Field>
              <Notice>{t.recorder.limits}</Notice>
              {start.isError ? <ErrorState error={start.error} /> : null}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={onClose}>
                  {t.common.cancel}
                </Button>
                <Button type="submit" disabled={start.isPending}>
                  <Circle className="fill-current text-destructive" /> {t.recorder.start}
                </Button>
              </div>
            </form>
          )
        ) : (
          <div className="flex flex-col gap-3">
            <p className="flex items-start gap-2 text-sm" role="status" aria-live="polite">
              {status === 'stopped' ? (
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
              ) : status === 'failed' ? (
                <XCircle className="mt-0.5 size-5 shrink-0 text-destructive" />
              ) : (
                <Loader2 className="mt-0.5 size-5 shrink-0 animate-spin text-primary" />
              )}
              <span data-testid="recording-status">{status ? t.recorder.status[status] : t.common.loading}</span>
            </p>
            {recording.data?.error ? <p className="text-xs text-muted-foreground">{recording.data.error}</p> : null}

            <RecordedSteps steps={steps} warnings={recording.data?.warnings ?? []} />

            {done && steps.length > 1 ? (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={includeOpen} onChange={(e) => setIncludeOpen(e.target.checked)} />
                {t.recorder.includeOpen}
              </label>
            ) : null}
            {done ? <p className="text-xs text-muted-foreground">{t.recorder.addHint}</p> : null}
            {stop.isError ? <ErrorState error={stop.error} /> : null}

            <div className="flex justify-end gap-2">
              {done ? (
                <>
                  <Button variant="outline" onClick={onClose}>
                    {t.recorder.discard}
                  </Button>
                  <Button
                    disabled={chosen.length === 0}
                    onClick={() => {
                      onAdd(chosen);
                      onClose();
                    }}
                  >
                    {t.recorder.add(chosen.length)}
                  </Button>
                </>
              ) : (
                <Button onClick={() => stop.mutate()} disabled={status !== 'recording' || stop.isPending}>
                  {t.recorder.stop}
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RecordedSteps({ steps, warnings }: { steps: Step[]; warnings: RecorderWarning[] }) {
  const general = warnings.filter((w) => w.stepId === undefined);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-muted-foreground">{t.recorder.recorded(steps.length)}</p>
      <ol className="flex max-h-64 list-decimal flex-col gap-1 overflow-auto rounded-md border border-border bg-muted/40 py-2 pr-2 pl-8 text-sm">
        {steps.map((step) => {
          const own = warnings.filter((w) => w.stepId === step.id);
          return (
            <li key={step.id}>
              {step.name}
              {own.map((w) => (
                <span key={w.code} className="mt-0.5 flex items-start gap-1 text-xs text-muted-foreground">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0 text-warning" /> {t.recorder.warnings[w.code]}
                </span>
              ))}
            </li>
          );
        })}
      </ol>
      {general.length > 0 ? (
        <Notice tone="warning">
          <ul className="flex flex-col gap-1">
            {general.map((w) => (
              <li key={w.code}>
                {t.recorder.warnings[w.code]}
                {w.count > 1 ? ` (×${w.count})` : ''}
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}
    </div>
  );
}
