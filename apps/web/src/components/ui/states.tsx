import { AlertTriangle, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { t } from '@/i18n';
import { ApiError } from '@/lib/api';

export function Loading({ label = t.common.loading }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground" role="status">
      <Loader2 className="size-4 animate-spin" /> {label}
    </div>
  );
}

export function ErrorState({ error }: { error: unknown }) {
  const message = error instanceof ApiError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : String(error);
  return (
    <div
      role="alert"
      className="m-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 p-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {children ? <div className="text-sm text-muted-foreground">{children}</div> : null}
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warning'; children: ReactNode }) {
  return (
    <div
      className={
        tone === 'warning'
          ? 'rounded-md border border-warning/40 bg-warning/10 p-3 text-sm'
          : 'rounded-md border border-border bg-muted p-3 text-sm text-muted-foreground'
      }
    >
      {children}
    </div>
  );
}
