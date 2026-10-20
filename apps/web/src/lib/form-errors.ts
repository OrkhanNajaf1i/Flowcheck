import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from './api';

/**
 * Puts backend validation issues on the matching form fields; anything that does not map to a
 * field (or any other error) is shown as a form-level error. The backend stays the authority.
 */
export function applyServerErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  mapPath: (path: (string | number)[]) => string | null = (path) => path.join('.'),
): void {
  if (error instanceof ApiError && error.issues.length > 0) {
    const unmapped: string[] = [];
    for (const issue of error.issues) {
      const field = mapPath(issue.path);
      if (field) setError(field as Path<T>, { type: 'server', message: issue.message });
      else unmapped.push(issue.message);
    }
    if (unmapped.length > 0) setError('root' as Path<T>, { type: 'server', message: unmapped.join('; ') });
    return;
  }
  const message = error instanceof ApiError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : String(error);
  setError('root' as Path<T>, { type: 'server', message });
}
