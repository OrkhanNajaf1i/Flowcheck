import { CheckCircle2, Circle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';

interface Step {
  title: string;
  description: string;
  action: string;
  done: boolean;
  onAction: () => void;
}

/** Three-step checklist shown until the project has a website, a test and at least one run. */
export function GettingStarted({
  hasWebsite,
  hasTest,
  hasRun,
  onAddWebsite,
  onNewTest,
  onOpenTest,
}: {
  hasWebsite: boolean;
  hasTest: boolean;
  hasRun: boolean;
  onAddWebsite: () => void;
  onNewTest: () => void;
  onOpenTest: () => void;
}) {
  if (hasWebsite && hasTest && hasRun) return null;
  const steps: Step[] = [
    { ...t.onboarding.addWebsite, done: hasWebsite, onAction: onAddWebsite },
    { ...t.onboarding.createTest, done: hasTest, onAction: onNewTest },
    { ...t.onboarding.runTest, done: hasRun, onAction: onOpenTest },
  ];
  const current = steps.findIndex((step) => !step.done);

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">{t.onboarding.title}</h2>
        <ol className="grid gap-3 md:grid-cols-3">
          {steps.map((step, i) => (
            <li
              key={step.title}
              className={cn(
                'flex flex-col gap-2 rounded-md border bg-card p-3',
                i === current ? 'border-primary shadow-sm' : 'border-border',
              )}
            >
              <div className="flex items-center gap-2 text-sm font-medium">
                {step.done ? (
                  <CheckCircle2 className="size-5 text-success" aria-label={t.onboarding.done} />
                ) : (
                  <Circle className="size-5 text-muted-foreground" />
                )}
                <span>
                  {i + 1}. {step.title}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{step.description}</p>
              {i === current ? (
                <Button size="sm" className="self-start" onClick={step.onAction}>
                  {step.action}
                </Button>
              ) : null}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
