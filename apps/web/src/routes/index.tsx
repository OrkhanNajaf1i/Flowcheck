import { createProjectSchema } from '@flowcheck/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { FolderPlus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { ErrorState, Loading } from '@/components/ui/states';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { applyServerErrors } from '@/lib/form-errors';
import { formatDateTime } from '@/lib/utils';

export const Route = createFileRoute('/')({ component: ProjectsPage });

function ProjectsPage() {
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{t.projects.title}</h1>
          <p className="text-sm text-muted-foreground">{t.app.tagline}</p>
        </div>
        <NewProjectDialog />
      </div>
      <Card>
        {projects.isPending ? (
          <Loading />
        ) : projects.isError ? (
          <ErrorState error={projects.error} />
        ) : projects.data.length === 0 ? (
          <div className="flex flex-col items-center gap-5 px-6 py-10 text-center">
            <div>
              <p className="text-base font-semibold">{t.projects.empty}</p>
              <p className="text-sm text-muted-foreground">{t.projects.emptyHint}</p>
            </div>
            <ol className="grid w-full max-w-3xl gap-3 text-left md:grid-cols-3">
              {t.projects.howSteps.map((text, i) => (
                <li key={text} className="flex gap-3 rounded-md border border-border bg-muted/50 p-3 text-sm">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                    {i + 1}
                  </span>
                  {text}
                </li>
              ))}
            </ol>
            <NewProjectDialog label={t.projects.createFirst} />
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {projects.data.map((project) => (
              <li key={project.id}>
                <Link
                  to="/projects/$projectId"
                  params={{ projectId: project.id }}
                  className="flex items-center justify-between px-4 py-3 hover:bg-muted"
                >
                  <div>
                    <p className="font-medium">{project.name}</p>
                    {project.description ? <p className="text-sm text-muted-foreground">{project.description}</p> : null}
                  </div>
                  <span className="text-xs text-muted-foreground">{formatDateTime(project.updatedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

type ProjectForm = z.input<typeof createProjectSchema>;

function NewProjectDialog({ label = t.projects.new }: { label?: string }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const form = useForm<ProjectForm>({ resolver: zodResolver(createProjectSchema), defaultValues: { name: '', description: '' } });
  const create = useMutation({
    mutationFn: api.createProject,
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      setOpen(false);
      form.reset();
      await navigate({ to: '/projects/$projectId', params: { projectId: project.id } });
    },
    onError: (error) => applyServerErrors(error, form.setError),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <FolderPlus /> {label}
        </Button>
      </DialogTrigger>
      <DialogContent title={t.projects.new}>
        <form className="flex flex-col gap-3" onSubmit={form.handleSubmit((values) => create.mutate(values))}>
          <Field label={t.common.name} htmlFor="project-name" error={form.formState.errors.name?.message}>
            <Input id="project-name" autoFocus aria-invalid={!!form.formState.errors.name} {...form.register('name')} />
          </Field>
          <Field label={`${t.common.description} (${t.common.optional})`} htmlFor="project-description">
            <Textarea id="project-description" className="font-sans text-sm" {...form.register('description')} />
          </Field>
          {form.formState.errors.root ? <p className="text-sm text-destructive">{form.formState.errors.root.message}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? t.common.saving : t.common.create}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
