import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { ErrorState } from '@/components/ui/states';
import { t } from '@/i18n';
import { api } from '@/lib/api';

/** Permanent deletion, guarded by typing the project name. The server refuses while a run is active. */
export function DeleteProjectDialog({ projectId, projectName }: { projectId: string; projectName: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const remove = useMutation({
    mutationFn: () => api.deleteProject(projectId),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: ['project', projectId] });
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      await navigate({ to: '/' });
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setTyped('');
        remove.reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive/5">
          <Trash2 /> {t.project.delete}
        </Button>
      </DialogTrigger>
      <DialogContent title={t.project.deleteTitle(projectName)} description={t.project.deleteWhat}>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            remove.mutate();
          }}
        >
          <Field label={t.project.deleteConfirmLabel(projectName)} htmlFor="delete-confirm">
            <Input id="delete-confirm" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </Field>
          {remove.isError ? <ErrorState error={remove.error} /> : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button type="submit" variant="destructive" disabled={typed.trim() !== projectName.trim() || remove.isPending}>
              {remove.isPending ? t.project.deleting : t.project.deleteConfirm}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
