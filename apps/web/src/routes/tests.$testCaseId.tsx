import { parseDefinition, type TestCaseDto, type TestDefinition } from '@flowcheck/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useBlocker } from '@tanstack/react-router';
import { ChevronLeft, Play, Save } from 'lucide-react';
import { lazy, Suspense, useMemo, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { ErrorState, Loading, Notice } from '@/components/ui/states';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LoginSessionPicker } from '@/features/auth/login-sessions';
import { type EditorForm, issueKey, PHASES, toDefinition, toForm } from '@/features/editor/definition-form';
import { EditorContext } from '@/features/editor/editor-context';
import { InputsSection } from '@/features/editor/inputs-section';
import { PhaseSection } from '@/features/editor/phase-section';
import { RunDialog } from '@/features/editor/run-dialog';
import { t } from '@/i18n';
import { ApiError, api } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';

const JsonEditor = lazy(() => import('@/features/editor/json-editor'));

export const Route = createFileRoute('/tests/$testCaseId')({ component: TestEditorPage });

function TestEditorPage() {
  const { testCaseId } = Route.useParams();
  const testCase = useQuery({ queryKey: ['testCase', testCaseId], queryFn: () => api.testCase(testCaseId) });
  const revisionId = testCase.data?.currentRevisionId;
  const revision = useQuery({
    queryKey: ['revision', revisionId],
    queryFn: () => api.revision(revisionId as string),
    enabled: typeof revisionId === 'string',
    staleTime: Number.POSITIVE_INFINITY, // revisions are immutable
  });

  if (testCase.isPending || (revisionId && revision.isPending)) return <Loading />;
  if (testCase.isError) return <ErrorState error={testCase.error} />;
  if (revision.isError) return <ErrorState error={revision.error} />;
  if (!revision.data) return <ErrorState error={new Error('This test has no saved revision.')} />;

  const parsed = parseDefinition(revision.data.definition);
  if (!parsed.ok) {
    // Old or unknown schema versions are shown as an error, never converted silently.
    return (
      <ErrorState error={new Error(parsed.code === 'UNSUPPORTED_SCHEMA_VERSION' ? parsed.message : 'The saved definition is invalid.')} />
    );
  }
  // Remount the editor whenever a new revision becomes current.
  return (
    <Editor
      key={revision.data.id}
      testCase={testCase.data}
      revisionId={revision.data.id}
      revisionNumber={revision.data.revisionNumber}
      definition={parsed.definition}
    />
  );
}

function Editor({
  testCase,
  revisionId,
  revisionNumber,
  definition,
}: {
  testCase: TestCaseDto;
  revisionId: string;
  revisionNumber: number;
  definition: TestDefinition;
}) {
  const queryClient = useQueryClient();
  const form = useForm<EditorForm>({ defaultValues: toForm(testCase, definition) });
  const [issues, setIssues] = useState<Map<string, string>>(new Map());
  const [running, setRunning] = useState(false);
  const [json, setJson] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const runs = useQuery({ queryKey: ['runs', testCase.id], queryFn: () => api.runs(testCase.id), refetchInterval: 5000 });
  const environments = useQuery({ queryKey: ['environments', testCase.projectId], queryFn: () => api.environments(testCase.projectId) });
  const noEnvironment = environments.data !== undefined && environments.data.length === 0;
  const isDirty = form.formState.isDirty;
  const archived = testCase.archivedAt !== null;

  useBlocker({
    shouldBlockFn: () => form.formState.isDirty && !window.confirm(t.editor.unsaved),
    enableBeforeUnload: () => form.formState.isDirty,
  });

  const save = useMutation({
    mutationFn: async (values: EditorForm) => {
      const { definition: next, issues: localIssues } = toDefinition(values);
      if (localIssues.length > 0) {
        setIssues(new Map(localIssues.map((issue) => [issueKey(issue.path), issue.message])));
        throw new Error(t.editor.fixErrors);
      }
      setIssues(new Map());
      const dirty = form.formState.dirtyFields;
      if (dirty.name || dirty.description) {
        await api.updateTestCase(testCase.id, { name: values.name, description: values.description });
      }
      const definitionChanged = Object.keys(dirty).some((key) => key !== 'name' && key !== 'description');
      return definitionChanged ? api.saveRevision(testCase.id, { baseRevisionId: revisionId, definition: next }) : null;
    },
    onSuccess: async () => {
      form.reset(form.getValues());
      await queryClient.invalidateQueries({ queryKey: ['testCase', testCase.id] });
      await queryClient.invalidateQueries({ queryKey: ['tests', testCase.projectId] });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.issues.length > 0) {
        // Server paths look like ['definition', 'steps', 0, 'url'] or ['name'].
        setIssues(
          new Map(
            error.issues.map((issue) => [issueKey(issue.path[0] === 'definition' ? issue.path.slice(1) : issue.path), issue.message]),
          ),
        );
      }
    },
  });

  const savedInputs = useMemo(() => definition.inputs, [definition]);

  const openJson = () => {
    setJson(JSON.stringify(toDefinition(form.getValues()).definition, null, 2));
    setJsonError(null);
  };
  const applyJson = () => {
    let value: unknown;
    try {
      value = JSON.parse(json);
    } catch {
      setJsonError(t.editor.jsonInvalid);
      return;
    }
    const parsed = parseDefinition(value);
    if (!parsed.ok) {
      setJsonError(
        parsed.code === 'UNSUPPORTED_SCHEMA_VERSION'
          ? parsed.message
          : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'),
      );
      return;
    }
    const { name, description } = form.getValues();
    // keepDefaultValues: the form becomes dirty relative to the saved revision.
    form.reset(toForm({ name, description }, parsed.definition), { keepDefaultValues: true });
    setJsonError(null);
  };

  return (
    <EditorContext.Provider value={{ projectId: testCase.projectId }}>
      <FormProvider {...form}>
        <form className="grid gap-4 lg:grid-cols-[1fr_280px]" onSubmit={form.handleSubmit((values) => save.mutate(values))} noValidate>
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <Link
                  to="/projects/$projectId"
                  params={{ projectId: testCase.projectId }}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <ChevronLeft className="size-3" /> {t.project.tests}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {t.editor.version(revisionNumber)}
                  {archived ? ` · ${t.tests.archived}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{isDirty ? `● ${t.editor.unsavedShort}` : t.editor.noChanges}</span>
                <Button type="submit" variant="outline" disabled={!isDirty || save.isPending || archived}>
                  <Save /> {save.isPending ? t.common.saving : t.editor.saveRevision}
                </Button>
                <Button
                  onClick={() => setRunning(true)}
                  disabled={isDirty || archived || noEnvironment}
                  title={isDirty ? t.editor.runSavedOnly : noEnvironment ? t.editor.noEnvironment : undefined}
                >
                  <Play /> {t.editor.run}
                </Button>
              </div>
            </div>

            {save.isError ? (
              save.error instanceof ApiError && save.error.code === 'REVISION_CONFLICT' ? (
                <ErrorState error={new Error(t.editor.conflict)} />
              ) : (
                <ErrorState error={save.error} />
              )
            ) : null}
            {noEnvironment ? (
              <Notice tone="warning">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  {t.editor.noEnvironment}
                  <Button size="sm" asChild>
                    <Link to="/projects/$projectId" params={{ projectId: testCase.projectId }}>
                      {t.editor.addWebsite}
                    </Link>
                  </Button>
                </span>
              </Notice>
            ) : null}
            {isDirty ? <Notice>{t.editor.runSavedOnly}</Notice> : null}

            <Card>
              <CardContent className="grid gap-3">
                <Field label={t.tests.nameLabel} htmlFor="test-name" error={issues.get('name')}>
                  <Input id="test-name" {...form.register('name')} />
                </Field>
                <Field label={`${t.common.description} (${t.common.optional})`} htmlFor="test-description">
                  <Textarea id="test-description" rows={2} className="min-h-0 font-sans text-sm" {...form.register('description')} />
                </Field>
                <LoginSessionPicker
                  projectId={testCase.projectId}
                  value={form.watch('authProfileId')}
                  onChange={(id) => form.setValue('authProfileId', id, { shouldDirty: true })}
                />
              </CardContent>
            </Card>

            <Tabs defaultValue="steps" onValueChange={(tab) => tab === 'json' && openJson()}>
              <TabsList>
                <TabsTrigger value="steps">{t.editor.steps}</TabsTrigger>
                <TabsTrigger value="json">{t.editor.advanced}</TabsTrigger>
              </TabsList>
              <TabsContent value="steps" className="mt-3 flex flex-col gap-6">
                <Card>
                  <CardContent className="flex flex-col gap-6">
                    {PHASES.map((phase) => (
                      <PhaseSection key={phase} phase={phase} issues={issues} />
                    ))}
                  </CardContent>
                </Card>
                <details className="rounded-lg border border-border bg-card">
                  <summary className="cursor-pointer px-4 py-3 text-sm font-medium">{t.editor.moreSettings}</summary>
                  <div className="flex flex-col gap-4 border-t border-border p-4">
                    <InputsSection issues={issues} />
                    <div className="grid gap-3 md:grid-cols-2">
                      <Field
                        label={t.editor.defaultTimeout}
                        htmlFor="default-timeout"
                        error={issues.get('defaultTimeoutMs')}
                        hint={t.editor.defaultTimeoutHint}
                      >
                        <Input id="default-timeout" inputMode="numeric" {...form.register('defaultTimeoutMs')} />
                      </Field>
                      <Field
                        label={t.editor.runTimeout}
                        htmlFor="run-timeout"
                        error={issues.get('runTimeoutMs')}
                        hint={t.editor.runTimeoutHint}
                      >
                        <Input id="run-timeout" inputMode="numeric" {...form.register('runTimeoutMs')} />
                      </Field>
                    </div>
                  </div>
                </details>
              </TabsContent>
              <TabsContent value="json" className="mt-3 flex flex-col gap-2">
                <Suspense fallback={<Loading />}>
                  <JsonEditor value={json} onChange={setJson} />
                </Suspense>
                {jsonError ? (
                  <pre role="alert" className="whitespace-pre-wrap rounded-md bg-destructive/5 p-2 text-xs text-destructive">
                    {jsonError}
                  </pre>
                ) : null}
                <Button variant="outline" className="self-start" onClick={applyJson}>
                  {t.editor.applyJson}
                </Button>
              </TabsContent>
            </Tabs>
          </div>

          <aside className="flex flex-col gap-3">
            <Card>
              <CardHeader>
                <CardTitle>{t.editor.history}</CardTitle>
              </CardHeader>
              {runs.isPending ? (
                <Loading />
              ) : runs.isError ? (
                <ErrorState error={runs.error} />
              ) : runs.data.length === 0 ? (
                <p className="p-4 text-xs text-muted-foreground">{t.common.never}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {runs.data.map((run) => (
                    <li key={run.id}>
                      <Link
                        to="/runs/$runId"
                        params={{ runId: run.id }}
                        className="flex items-center justify-between gap-2 px-4 py-2 text-xs hover:bg-muted"
                      >
                        <StatusBadge status={run.status} />
                        <span className="text-muted-foreground">{formatDateTime(run.createdAt)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </aside>
        </form>
        {running ? (
          <RunDialog
            authProfileId={definition.authProfileId}
            projectId={testCase.projectId}
            testCaseId={testCase.id}
            inputs={savedInputs}
            onClose={() => setRunning(false)}
          />
        ) : null}
      </FormProvider>
    </EditorContext.Provider>
  );
}
