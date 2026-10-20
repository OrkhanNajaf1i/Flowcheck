import { z } from 'zod';

/**
 * Every error code FlowCheck can emit, in API responses and in step/run results.
 * See docs/PROJECT_RULES.md §18.
 */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'MISSING_VARIABLE',
  'AMBIGUOUS_LOCATOR',
  'LOCATOR_NOT_FOUND',
  'UNSUPPORTED_KEYBOARD_COMBINATION',
  'UNSUPPORTED_FRAME_TARGET',
  'UNSUPPORTED_SHADOW_DOM_TARGET',
  'INVALID_RESPONSE_FORMAT',
  'RESPONSE_TOO_LARGE',
  'AMBIGUOUS_NETWORK_MATCH',
  'NETWORK_TIMEOUT',
  'NETWORK_ERROR',
  'ORIGIN_NOT_ALLOWED',
  'SSRF_BLOCKED',
  'SECRET_NOT_FOUND',
  'SECRET_TOO_SHORT',
  'ENVIRONMENT_DISABLED',
  'RUN_TIMEOUT',
  'PROCESS_INTERRUPTED',
  'QUEUE_CLAIM_CONFLICT',
  'ASSERTION_FAILED',
  'ACTION_FAILED',
  'BROWSER_ERROR',
  'UNSUPPORTED_ACTION',
  'UNSUPPORTED_SCHEMA_VERSION',
  'AUTH_PROFILE_ENVIRONMENT_MISMATCH',
  'DUPLICATE_EVENT',
  'EXECUTION_LOCK_BUSY',
  'PROJECT_HAS_ACTIVE_RUNS',
  'REVISION_CONFLICT',
  'NOT_FOUND',
  'UNAUTHORIZED',
  'FORBIDDEN_ORIGIN',
  'HOST_NOT_ALLOWED',
  'INTERNAL_ERROR',
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** Wire format of every API error response. `details` must never contain secret values. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    details: z.record(z.string(), z.unknown()),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/** Field-level validation issue, placed in `details.issues` of a VALIDATION_ERROR. */
export interface ValidationIssue {
  path: (string | number)[];
  code: string;
  message: string;
}

export function zodIssuesToValidationIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map((p) => (typeof p === 'symbol' ? String(p) : p)),
    code: issue.code,
    message: issue.message,
  }));
}
