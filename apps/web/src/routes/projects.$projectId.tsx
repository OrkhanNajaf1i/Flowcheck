import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';
import { useState } from 'react';
import { ErrorState, Loading } from '@/components/ui/states';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EnvironmentsPanel } from '@/features/environments/environments-panel';
import { DeleteProjectDialog } from '@/features/projects/delete-project-dialog';
import { GettingStarted } from '@/features/projects/getting-started';
import { TestsPanel } from '@/features/tests/tests-panel';
import { t } from '@/i18n';
import { api } from '@/lib/api';

export const Route = createFileRoute('/projects/$projectId')({ component: ProjectPage });

type Tab = 'tests' | 'environments';

function ProjectPage() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate();
  const project = useQuery({ queryKey: ['project', projectId], queryFn: () => api.project(projectId) });
  const environments = useQuery({ queryKey: ['environments', projectId], queryFn: () => api.environments(projectId) });
  const tests = useQuery({ queryKey: ['tests', projectId, false], queryFn: () => api.testCases(projectId, false) });
  const [tab, setTab] = useState<Tab | null>(null);
  // Bumped to ask a panel to open its "create" dialog (from the getting-started checklist).
  const [openNewEnvironment, setOpenNewEnvironment] = useState(0);
  const [openNewTest, setOpenNewTest] = useState(0);

  if (project.isPending || environments.isPending || tests.isPending) return <Loading />;
  if (project.isError) return <ErrorState error={project.error} />;
  if (environments.isError) return <ErrorState error={environments.error} />;
  if (tests.isError) return <ErrorState error={tests.error} />;

  // Nothing can run without a website, so a new project starts there.
  const activeTab: Tab = tab ?? (environments.data.length === 0 ? 'environments' : 'tests');
  const firstTest = tests.data[0];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link to="/" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-3" /> {t.projects.title}
        </Link>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">{project.data.name}</h1>
          <DeleteProjectDialog projectId={projectId} projectName={project.data.name} />
        </div>
        {project.data.description ? <p className="text-sm text-muted-foreground">{project.data.description}</p> : null}
      </div>

      <GettingStarted
        hasWebsite={environments.data.length > 0}
        hasTest={tests.data.length > 0}
        hasRun={tests.data.some((test) => test.lastRun !== null)}
        onAddWebsite={() => {
          setTab('environments');
          setOpenNewEnvironment((n) => n + 1);
        }}
        onNewTest={() => {
          setTab('tests');
          setOpenNewTest((n) => n + 1);
        }}
        onOpenTest={() => firstTest && navigate({ to: '/tests/$testCaseId', params: { testCaseId: firstTest.id } })}
      />

      <Tabs value={activeTab} onValueChange={(value) => setTab(value as Tab)} className="flex flex-col gap-4">
        <TabsList className="self-start">
          <TabsTrigger value="tests">
            {t.project.tests} ({tests.data.length})
          </TabsTrigger>
          <TabsTrigger value="environments">
            {t.project.environments} ({environments.data.length})
          </TabsTrigger>
        </TabsList>
        <TabsContent value="tests">
          <TestsPanel projectId={projectId} openNewSignal={openNewTest} />
        </TabsContent>
        <TabsContent value="environments">
          <EnvironmentsPanel projectId={projectId} openNewSignal={openNewEnvironment} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
