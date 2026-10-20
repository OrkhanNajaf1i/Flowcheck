import type { RunStatus, StepStatus } from '@flowcheck/shared';
import { Ban, CheckCircle2, CircleDashed, CircleSlash, Clock, Loader2, OctagonAlert, PauseCircle, XCircle } from 'lucide-react';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';

const STYLES: Record<RunStatus | StepStatus, { className: string; Icon: typeof CheckCircle2 }> = {
  queued: { className: 'bg-muted text-muted-foreground', Icon: Clock },
  pending: { className: 'bg-muted text-muted-foreground', Icon: CircleDashed },
  running: { className: 'bg-primary/10 text-primary', Icon: Loader2 },
  passed: { className: 'bg-success/15 text-success', Icon: CheckCircle2 },
  failed: { className: 'bg-destructive/10 text-destructive', Icon: XCircle },
  error: { className: 'bg-warning/20 text-foreground', Icon: OctagonAlert },
  skipped: { className: 'bg-muted text-muted-foreground', Icon: CircleSlash },
  cancelled: { className: 'bg-muted text-foreground', Icon: Ban },
  interrupted: { className: 'bg-warning/20 text-foreground', Icon: PauseCircle },
};

export function StatusBadge({ status, className }: { status: RunStatus | StepStatus; className?: string }) {
  const { className: tone, Icon } = STYLES[status];
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', tone, className)}>
      <Icon className={cn('size-3.5', status === 'running' && 'animate-spin')} aria-hidden />
      {t.status[status]}
    </span>
  );
}
