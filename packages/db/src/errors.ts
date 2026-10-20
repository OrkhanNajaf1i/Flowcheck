import type { ErrorCode } from '@flowcheck/shared';

/** Domain error raised by repositories; the server maps it to the API error format. */
export class RepoError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'RepoError';
    this.code = code;
    this.details = details;
  }
}

export function notFound(entity: string, id: string): RepoError {
  return new RepoError('NOT_FOUND', `${entity} ${id} was not found`, { entity, id });
}
