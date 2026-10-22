import { closestCenter, DndContext, type DragEndEvent, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { StepType } from '@flowcheck/shared';
import { Circle, Plus } from 'lucide-react';
import { useState } from 'react';
import { useFieldArray, useFormContext } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { RecordDialog } from '@/features/recorder/record-dialog';
import { t } from '@/i18n';
import { blankStep, type EditorForm, type Phase, recordedStepsToForm } from './definition-form';
import { useEditorContext } from './editor-context';
import { STEP_GROUPS, STEP_ICONS, StepCard } from './step-card';

const TITLES: Record<Phase, { title: string; hint: string }> = {
  setupSteps: { title: t.editor.setup, hint: t.editor.setupHint },
  steps: { title: t.editor.main, hint: t.editor.mainHint },
  cleanupSteps: { title: t.editor.cleanup, hint: t.editor.cleanupHint },
};

export function PhaseSection({ phase, issues }: { phase: Phase; issues: Map<string, string> }) {
  const { control } = useFormContext<EditorForm>();
  // keyName "fieldKey" keeps react-hook-form from overwriting our own persisted `key`/`id` fields.
  const steps = useFieldArray({ control, name: phase, keyName: 'fieldKey' });
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [picking, setPicking] = useState(false);
  const [recording, setRecording] = useState(false);
  const { projectId, testCaseId } = useEditorContext();
  // Steps added in this session open automatically so the tester can fill them in.
  const [justAdded, setJustAdded] = useState<Set<string>>(new Set());

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = steps.fields.findIndex((f) => f.key === active.id);
    const to = steps.fields.findIndex((f) => f.key === over.id);
    if (from >= 0 && to >= 0) steps.move(from, to);
  };

  const add = (type: StepType) => {
    const step = blankStep(type, t.steps.types[type]);
    setJustAdded((prev) => new Set(prev).add(step.key));
    steps.append(step);
    setPicking(false);
  };

  const phaseIssue = issues.get(phase);
  const hasPhaseIssues = [...issues.keys()].some((key) => key === phase || key.startsWith(`${phase}.`));

  const body = (
    <>
      {phaseIssue ? (
        <p role="alert" className="text-xs text-destructive">
          {phaseIssue}
        </p>
      ) : null}
      {phase === 'steps' && steps.fields.length === 0 ? <p className="text-sm text-muted-foreground">{t.editor.emptyMain}</p> : null}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={steps.fields.map((f) => f.key)} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-2">
            {steps.fields.map((field, index) => (
              <SortableStep
                key={field.key}
                id={field.key}
                phase={phase}
                index={index}
                issues={issues}
                defaultOpen={justAdded.has(field.key)}
                onRemove={() => steps.remove(index)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <div className="flex flex-wrap gap-2">
        <Button variant={phase === 'steps' ? 'default' : 'outline'} size="sm" onClick={() => setPicking(true)}>
          <Plus /> {t.editor.addStep}
        </Button>
        {phase === 'steps' ? (
          <Button variant="outline" size="sm" onClick={() => setRecording(true)}>
            <Circle className="fill-current text-destructive" /> {t.recorder.record}
          </Button>
        ) : null}
      </div>
      {picking ? <StepPicker onPick={add} onClose={() => setPicking(false)} /> : null}
      {recording ? (
        <RecordDialog
          projectId={projectId}
          testCaseId={testCaseId}
          mainIsEmpty={steps.fields.length === 0}
          onAdd={(recorded) => steps.append(recordedStepsToForm(recorded))}
          onClose={() => setRecording(false)}
        />
      ) : null}
    </>
  );

  if (phase !== 'steps') {
    // Setup and cleanup are optional: collapsed until they have steps.
    return (
      <details
        className="rounded-md border border-dashed border-border"
        open={steps.fields.length > 0 || hasPhaseIssues}
        data-testid={`phase-${phase}`}
      >
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
          {TITLES[phase].title} {steps.fields.length > 0 ? `(${steps.fields.length})` : ''}
        </summary>
        <div className="flex flex-col gap-2 border-t border-dashed border-border p-3">
          <p className="text-xs text-muted-foreground">{TITLES[phase].hint}</p>
          {body}
        </div>
      </details>
    );
  }

  return (
    <section className="flex flex-col gap-2" data-testid={`phase-${phase}`}>
      <div>
        <h3 className="text-sm font-semibold">{TITLES[phase].title}</h3>
        <p className="text-xs text-muted-foreground">{TITLES[phase].hint}</p>
      </div>
      {body}
    </section>
  );
}

function StepPicker({ onPick, onClose }: { onPick: (type: StepType) => void; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={t.editor.pickStep} className="w-[min(760px,calc(100vw-2rem))]">
        <div className="flex flex-col gap-4">
          {STEP_GROUPS.map((group) => (
            <section key={group.id} className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.steps.pickerGroups[group.id]}</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {group.types.map((type) => {
                  const Icon = STEP_ICONS[type];
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => onPick(type)}
                      className="flex gap-3 rounded-md border border-border p-3 text-left text-sm transition-colors hover:border-primary hover:bg-primary/5"
                    >
                      <Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
                      <span>
                        <span className="block font-medium">{t.steps.types[type]}</span>
                        <span className="block text-xs text-muted-foreground">{t.steps.typeDescriptions[type]}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SortableStep({
  id,
  ...props
}: {
  id: string;
  phase: Phase;
  index: number;
  issues: Map<string, string>;
  defaultOpen: boolean;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-testid={`step-${props.phase}-${props.index}`}
    >
      <StepCard {...props} dragHandle={{ attributes, listeners }} />
    </div>
  );
}
