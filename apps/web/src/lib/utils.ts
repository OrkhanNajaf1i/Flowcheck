import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatDateTime(iso: string | null): string {
  return iso === null ? '—' : new Date(iso).toLocaleString();
}

export function formatDuration(startIso: string | null, endIso: string | null): string {
  if (startIso === null) return '—';
  const ms = (endIso === null ? Date.now() : new Date(endIso).getTime()) - new Date(startIso).getTime();
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}
