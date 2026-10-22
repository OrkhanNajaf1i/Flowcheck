import * as LabelPrimitive from '@radix-ui/react-label';
import { type ComponentProps, cloneElement, isValidElement, type ReactElement, type ReactNode, useId } from 'react';
import { cn } from '@/lib/utils';

export function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
  return <LabelPrimitive.Root className={cn('text-xs font-medium text-muted-foreground', className)} {...props} />;
}

/**
 * Label + control + hint + field-level error. The label is always associated with the control:
 * without `htmlFor`, the single child control gets a generated id. The hint and error are linked
 * with aria-describedby.
 */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  error?: string | undefined;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const generated = useId();
  const control = isValidElement<{ id?: string; 'aria-describedby'?: string }>(children)
    ? (children as ReactElement<{ id?: string; 'aria-describedby'?: string }>)
    : null;
  const id = htmlFor ?? control?.props.id ?? generated;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  const content = control
    ? cloneElement(control, {
        id,
        ...(describedBy ? { 'aria-describedby': [control.props['aria-describedby'], describedBy].filter(Boolean).join(' ') } : {}),
      })
    : children;

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <Label htmlFor={id}>{label}</Label>
      {content}
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
