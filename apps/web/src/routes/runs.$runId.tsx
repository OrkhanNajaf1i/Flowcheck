import { isFinalRunStatus, type RunDto, type StepRunDto } from '@flowcheck/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ChevronDown, ChevronLeft, ChevronRight, Square } from 'lucide-react';
import { useState } from 'react';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState, Loading, Notice } from '@/components/ui/states';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { formatDateTime, formatDuration } from '@/lib/utils';

export const Route = createFileRoute('/runs/$runId')({ component: RunPage });

function RunPage() {
  const { runId } = Route.useParams();
  const queryClient = useQueryClient();
  // Polling while the run is active; state always comes from the DB, so reconnects need nothing special.
  const run = useQuery({
    queryKey: ['run', runId],
    queryFn: () => api.run(runId),
    refetchInterval: (query) => (query.state.data && isFinalRunStatus(query.state.data.status) ? false : 1000),
  });
  const cancel = useMutation({
    mutationFn: () => api.cancelRun(runId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['run', runId] }),
  });

  if (run.isPending) return <Loading />;
  if (run.isError) return <ErrorState error={run.error} />;
  const data = run.data;
  const active = !isFinalRunStatus(data.status);
  const cancelRequested = data.cancellationRequestedAt !== null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link
            to="/tests/$testCaseId"
            params={{ testCaseId: data.testCaseId }}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-3" /> {t.run.openTest}
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold">{t.run.title}</h1>
            <StatusBadge status={data.status} className="text-sm" />
          </div>
        </div>
        {active ? (
          <Button variant="destructive" disabled={cancel.isPending || cancelRequested} onClick={() => cancel.mutate()}>
            <Square /> {cancelRequested ? t.run.cancelRequested : t.run.cancel}
          </Button>
        ) : null}
      </div>

      {cancel.isError ? <ErrorState error={cancel.error} /> : null}
      {active ? <Notice>{t.run.cancelNote}</Notice> : null}
      <Summary run={data} />

      <Card>
        <CardHeader>
          <CardTitle>{t.run.steps}</CardTitle>
        </CardHeader>
        {data.steps.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{data.status === 'queued' ? t.run.waiting : t.run.noSteps}</p>
        ) : (
          <ol className="divide-y divide-border">
            {data.steps.map((step) => (
              <StepRow key={step.id} runId={data.id} step={step} />
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

function Summary({ run }: { run: RunDto }) {
  const help = run.status in t.statusHelp ? t.statusHelp[run.status as keyof typeof t.statusHelp] : null;
  const hint = run.failureSummary ? t.run.hints[run.failureSummary.code] : undefined;
  return (
    <Card>
      <CardContent className="grid gap-4 text-sm md:grid-cols-4">
        <Info label={t.run.environment} value={`${run.environment.name} (${run.environment.frontendBaseUrl})`} hint={t.run.snapshotNote} />
        <Info label={t.run.revision} value={`#${run.revisionNumber}`} />
        <Info label={t.run.started} value={formatDateTime(run.startedAt ?? run.createdAt)} />
        <Info label={t.run.duration} value={formatDuration(run.startedAt, run.finishedAt)} />
        {run.failureSummary ? (
          <div className="md:col-span-4 rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <p className="text-xs font-medium text-muted-foreground">{t.run.failure}</p>
            <p className="font-mono text-xs">{run.failureSummary.code}</p>
            <p>{run.failureSummary.message}</p>
            {help ? <p className="mt-1 text-xs text-muted-foreground">{help}</p> : null}
            {hint ? (
              <div className="mt-2 rounded border border-border bg-card p-2 text-sm">
                <p className="text-xs font-medium text-muted-foreground">{t.run.whatToCheck}</p>
                <p>{hint}</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Info({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="break-all">{value}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

const PHASE_LABEL = t.run.phases;

function StepRow({ runId, step }: { runId: string; step: StepRunDto }) {
  const failed = step.status === 'failed' || step.status === 'error';
  // Until the user toggles it, a step is open exactly when it failed — also when it fails while the page is open.
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = toggled ?? failed;
  const setOpen = (value: boolean) => setToggled(value);
  const blocked = blockedRequests(step.actual);

  return (
    <li>
      <button
        type="button"
        className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-muted/50"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        <span className="w-6 text-xs text-muted-foreground">{step.order + 1}.</span>
        <StatusBadge status={step.status} />
        <span className="flex-1">
          <span className="font-medium">{step.name}</span> <span className="text-xs text-muted-foreground">· {step.type}</span>
          {step.phase !== 'main' ? <span className="ml-2 rounded bg-muted px-1.5 text-xs">{PHASE_LABEL[step.phase]}</span> : null}
        </span>
        {blocked.length > 0 ? <span className="rounded bg-warning/20 px-1.5 text-xs">{t.run.blockedCount(blocked.length)}</span> : null}
        <span className="text-xs text-muted-foreground">{formatDuration(step.startedAt, step.finishedAt)}</span>
      </button>
      {open ? (
        <div className="flex flex-col gap-3 border-t border-border bg-muted/30 px-4 py-3 text-sm">
          {step.errorCode || step.errorMessage ? (
            <div className="rounded-md border border-destructive/30 bg-card p-2">
              <p className="font-mono text-xs text-destructive">{step.errorCode}</p>
              <p>{step.errorMessage}</p>
            </div>
          ) : null}
          {step.skipReason ? (
            <p className="text-xs">
              <span className="font-medium">{t.run.skipped}:</span> {step.skipReason}
            </p>
          ) : null}
          {blocked.length > 0 ? (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
              <p className="font-medium">{t.run.blocked}</p>
              <p className="mb-1 text-muted-foreground">{t.run.blockedHint}</p>
              <ul className="list-inside list-disc font-mono">
                {blocked.map((b, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: the same URL can be blocked several times
                  <li key={i} className="break-all">
                    {b.url} — {b.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="grid gap-3 md:grid-cols-2">
            <JsonBlock title={t.run.expected} value={step.expected} />
            <JsonBlock title={t.run.actual} value={withoutBlocked(step.actual)} />
          </div>
          {step.artifacts
            .filter((a) => a.type === 'screenshot')
            .map((artifact) => (
              <figure key={artifact.id} className="flex flex-col gap-1">
                <figcaption className="text-xs text-muted-foreground">
                  {t.run.screenshot} · {t.run.screenshotNote}
                </figcaption>
                <a href={api.artifactUrl(runId, artifact.id)} target="_blank" rel="noreferrer">
                  <img
                    src={api.artifactUrl(runId, artifact.id)}
                    alt={`${t.run.screenshot}: ${step.name}`}
                    className="max-h-96 rounded-md border border-border"
                  />
                </a>
              </figure>
            ))}
        </div>
      ) : null}
    </li>
  );
}

/** Evidence is rendered as text only — response bodies are never interpreted as HTML. */
function JsonBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs font-medium text-muted-foreground">{title}</p>
      <pre className="max-h-80 overflow-auto rounded-md border border-border bg-card p-2 font-mono text-xs">
        {value === null || value === undefined ? '—' : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function blockedRequests(actual: unknown): { url: string; reason: string }[] {
  if (typeof actual === 'object' && actual !== null && 'blockedRequests' in actual && Array.isArray(actual.blockedRequests)) {
    return actual.blockedRequests as { url: string; reason: string }[];
  }
  return [];
}

function withoutBlocked(actual: unknown): unknown {
  if (typeof actual !== 'object' || actual === null || !('blockedRequests' in actual)) return actual;
  const { blockedRequests: _omit, ...rest } = actual as Record<string, unknown>;
  return Object.keys(rest).length === 0 ? null : rest;
}
