import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export const fieldClass =
  'w-full rounded-md border border-border bg-card px-3 py-1.5 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/30 aria-invalid:border-destructive disabled:opacity-50';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(fieldClass, 'h-9', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(fieldClass, 'min-h-20 font-mono text-xs', className)} {...props} />;
}

/** Native select: accessible and works with react-hook-form `register` without extra wiring. */
export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn(fieldClass, 'h-9', className)} {...props} />;
}
