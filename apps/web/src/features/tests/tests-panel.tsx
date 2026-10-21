import { RUN_STATUSES, type TestCaseDto } from '@flowcheck/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  createColumnHelper,
  createSortedRowModel,
  flexRender,
  rowSortingFeature,
  sortFn_alphanumeric,
  tableFeatures,
  useTable,
} from '@tanstack/react-table';
import { Archive, Copy, FilePlus2, FileText, KeyRound, ScanText, Webhook } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Empty, ErrorState, Loading } from '@/components/ui/states';
import { Switch } from '@/components/ui/switch';
import { TEMPLATE_IDS, type TemplateId, templateDefinition } from '@/features/tests/templates';
import { t } from '@/i18n';
import { ApiError, api } from '@/lib/api';
import { useUiStore } from '@/lib/ui-store';
import { cn, formatDateTime } from '@/lib/utils';

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric },
});
const column = createColumnHelper<typeof features, TestCaseDto>();

const TEMPLATE_ICONS: Record<TemplateId, typeof FileText> = { login: KeyRound, pageText: ScanText, api: Webhook, blank: FileText };

export function TestsPanel({ projectId, openNewSignal = 0 }: { projectId: string; openNewSignal?: number }) {
  const queryClient = useQueryClient();
  const { testNameFilter, testResultFilter, showArchived, setTestNameFilter, setTestResultFilter, setShowArchived } = useUiStore();
  const tests = useQuery({ queryKey: ['tests', projectId, showArchived], queryFn: () => api.testCases(projectId, showArchived) });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (openNewSignal > 0) setCreating(true);
  }, [openNewSignal]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['tests', projectId] });
  const duplicate = useMutation({ mutationFn: api.duplicateTestCase, onSuccess: invalidate });
  const archive = useMutation({ mutationFn: api.archiveTestCase, onSuccess: invalidate });

  const data = useMemo(() => {
    const name = testNameFilter.trim().toLowerCase();
    return (tests.data ?? []).filter((test) => {
      if (name && !test.name.toLowerCase().includes(name)) return false;
      if (testResultFilter === 'any') return true;
      if (testResultFilter === 'never') return test.lastRun === null;
      return test.lastRun?.status === testResultFilter;
    });
  }, [tests.data, testNameFilter, testResultFilter]);

  const columns = useMemo(
    () =>
      column.columns([
        column.accessor('name', {
          header: t.common.name,
          sortFn: 'alphanumeric',
          cell: (info) => (
            <Link to="/tests/$testCaseId" params={{ testCaseId: info.row.original.id }} className="font-medium hover:underline">
              {info.getValue()}
              {info.row.original.archivedAt ? (
                <span className="ml-2 rounded bg-muted px-1.5 text-xs text-muted-foreground">{t.tests.archived}</span>
              ) : null}
            </Link>
          ),
        }),
        column.display({
          id: 'lastRun',
          header: t.tests.lastResult,
          cell: (info) => {
            const run = info.row.original.lastRun;
            return run ? (
              <Link to="/runs/$runId" params={{ runId: run.id }}>
                <StatusBadge status={run.status} />
              </Link>
            ) : (
              <span className="text-xs text-muted-foreground">{t.common.never}</span>
            );
          },
        }),
        column.accessor('updatedAt', {
          header: t.tests.updated,
          cell: (info) => <span className="text-xs">{formatDateTime(info.getValue())}</span>,
        }),
        column.display({
          id: 'actions',
          header: '',
          cell: (info) => {
            const test = info.row.original;
            return (
              <div className="flex justify-end gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  title={t.tests.duplicate}
                  aria-label={t.tests.duplicate}
                  disabled={duplicate.isPending}
                  onClick={() => duplicate.mutate(test.id)}
                >
                  <Copy />
                </Button>
                {test.archivedAt ? null : (
                  <Button
                    variant="ghost"
                    size="icon"
                    title={t.tests.archive}
                    aria-label={t.tests.archive}
                    disabled={archive.isPending}
                    onClick={() => window.confirm(t.tests.archiveConfirm) && archive.mutate(test.id)}
                  >
                    <Archive />
                  </Button>
                )}
              </div>
            );
          },
        }),
      ]),
    [duplicate, archive],
  );

  const table = useTable({ features, columns, data });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t.tests.filterName} htmlFor="test-filter" className="w-60">
          <Input id="test-filter" value={testNameFilter} onChange={(e) => setTestNameFilter(e.target.value)} />
        </Field>
        <Field label={t.tests.filterResult} htmlFor="test-result" className="w-44">
          <Select
            id="test-result"
            value={testResultFilter}
            onChange={(e) => setTestResultFilter(e.target.value as typeof testResultFilter)}
          >
            <option value="any">{t.tests.anyResult}</option>
            <option value="never">{t.common.never}</option>
            {RUN_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t.status[status]}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex h-9 items-center gap-2 text-sm">
          <Switch id="show-archived" checked={showArchived} onCheckedChange={setShowArchived} />
          <label htmlFor="show-archived">{t.tests.showArchived}</label>
        </div>
        <Button className="ml-auto" onClick={() => setCreating(true)}>
          <FilePlus2 /> {t.tests.new}
        </Button>
      </div>
      {duplicate.isError || archive.isError ? <ErrorState error={duplicate.error ?? archive.error} /> : null}
      <Card>
        {tests.isPending ? (
          <Loading />
        ) : tests.isError ? (
          <ErrorState error={tests.error} />
        ) : (tests.data ?? []).length === 0 ? (
          <Empty title={t.tests.empty}>
            <p>{t.tests.emptyHint}</p>
            <Button className="mt-3" onClick={() => setCreating(true)}>
              <FilePlus2 /> {t.tests.new}
            </Button>
          </Empty>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs text-muted-foreground">
              {table.getHeaderGroups().map((group) => (
                <tr key={group.id}>
                  {group.headers.map((header) => (
                    <th key={header.id} className="px-4 py-2 font-medium">
                      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-border">
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="hover:bg-muted/50">
                  {row.getAllCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-2">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {creating ? <NewTestDialog projectId={projectId} onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

function NewTestDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [template, setTemplate] = useState<TemplateId>('login');
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () =>
      api.createTestCase(projectId, {
        name: name.trim() || t.tests.templates[template].title,
        description: '',
        definition: templateDefinition(template),
      }),
    onSuccess: async ({ testCase }) => {
      await queryClient.invalidateQueries({ queryKey: ['tests', projectId] });
      await navigate({ to: '/tests/$testCaseId', params: { testCaseId: testCase.id } });
    },
  });
  const nameError = create.error instanceof ApiError ? create.error.issues.find((i) => i.path[0] === 'name')?.message : undefined;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={t.tests.new} className="w-[min(680px,calc(100vw-2rem))]">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-xs font-medium text-muted-foreground">{t.tests.startFrom}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {TEMPLATE_IDS.map((id) => {
                const Icon = TEMPLATE_ICONS[id];
                const selected = template === id;
                return (
                  <label
                    key={id}
                    className={cn(
                      'flex cursor-pointer gap-3 rounded-md border p-3 text-sm transition-colors',
                      selected ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:bg-muted',
                    )}
                  >
                    <input
                      type="radio"
                      name="template"
                      value={id}
                      checked={selected}
                      onChange={() => setTemplate(id)}
                      className="sr-only"
                    />
                    <Icon className={cn('mt-0.5 size-5 shrink-0', selected ? 'text-primary' : 'text-muted-foreground')} aria-hidden />
                    <span>
                      <span className="block font-medium">{t.tests.templates[id].title}</span>
                      <span className="block text-xs text-muted-foreground">{t.tests.templates[id].description}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            {template !== 'blank' ? <p className="text-xs text-muted-foreground">{t.tests.templateNote}</p> : null}
          </fieldset>
          <Field label={`${t.tests.nameLabel} (${t.common.optional})`} htmlFor="new-test-name" error={nameError}>
            <Input
              id="new-test-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.tests.templates[template].title}
            />
          </Field>
          {create.isError && !nameError ? <ErrorState error={create.error} /> : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {t.common.create}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
