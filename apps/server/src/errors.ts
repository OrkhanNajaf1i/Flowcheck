import { RepoError } from '@flowcheck/db';
import type { ApiError, ErrorCode, ValidationIssue } from '@flowcheck/shared';
import type { FastifyError, FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

const STATUS_BY_CODE: Partial<Record<ErrorCode, number>> = {
  VALIDATION_ERROR: 400,
  UNSUPPORTED_SCHEMA_VERSION: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN_ORIGIN: 403,
  HOST_NOT_ALLOWED: 403,
  NOT_FOUND: 404,
  REVISION_CONFLICT: 409,
  EXECUTION_LOCK_BUSY: 409,
  PROJECT_HAS_ACTIVE_RUNS: 409,
  ENVIRONMENT_DISABLED: 409,
  AUTH_PROFILE_ENVIRONMENT_MISMATCH: 400,
  INTERNAL_ERROR: 500,
};

/** Error thrown by route handlers; rendered in the standard error format. */
export class HttpError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export function validationError(message: string, issues: ValidationIssue[]): HttpError {
  return new HttpError('VALIDATION_ERROR', message, { issues });
}

export function errorBody(code: ErrorCode, message: string, details: Record<string, unknown> = {}): ApiError {
  return { error: { code, message, details } };
}

export function registerErrorHandling(app: FastifyInstance, options: { spaFallback?: boolean } = {}): void {
  app.setErrorHandler((error: FastifyError | Error, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      const issues: ValidationIssue[] = error.validation.map((v) => ({
        path: v.instancePath.split('/').filter(Boolean),
        code: v.keyword,
        message: v.message ?? 'Invalid value',
      }));
      return reply.code(400).send(errorBody('VALIDATION_ERROR', 'Request validation failed', { issues }));
    }
    if (error instanceof HttpError || error instanceof RepoError) {
      return reply.code(STATUS_BY_CODE[error.code] ?? 400).send(errorBody(error.code, error.message, error.details));
    }
    const status = (error as FastifyError).statusCode;
    if (status !== undefined && status >= 400 && status < 500) {
      // Malformed JSON, unsupported content type, body too large, ...
      return reply.code(status).send(errorBody('VALIDATION_ERROR', error.message));
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.code(500).send(errorBody('INTERNAL_ERROR', 'Internal server error'));
  });

  app.setNotFoundHandler((request, reply) => {
    // SPA fallback: client-side routes render the UI; unknown API routes stay JSON 404s.
    if (options.spaFallback && request.method === 'GET' && !request.url.startsWith('/api/')) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send(errorBody('NOT_FOUND', `Route ${request.method} ${request.url.split('?')[0]} not found`));
  });
}
