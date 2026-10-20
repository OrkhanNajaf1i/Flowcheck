import type { ErrorCode } from '@flowcheck/shared';

/**
 * Outcome category of a failed step:
 * - "failed": the system under test did not meet an expectation.
 * - "error": FlowCheck itself could not evaluate the step reliably.
 */
export type StepFailureKind = 'failed' | 'error';

const ERROR_KIND_BY_CODE: Partial<Record<ErrorCode, StepFailureKind>> = {
  INTERNAL_ERROR: 'error',
  BROWSER_ERROR: 'error',
  MISSING_VARIABLE: 'error',
  VALIDATION_ERROR: 'error',
  SECRET_NOT_FOUND: 'error',
};

export class StepError extends Error {
  readonly code: ErrorCode;
  readonly kind: StepFailureKind;
  readonly details: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details: Record<string, unknown> = {}, kind?: StepFailureKind) {
    super(message);
    this.name = 'StepError';
    this.code = code;
    this.kind = kind ?? ERROR_KIND_BY_CODE[code] ?? 'failed';
    this.details = details;
  }
}

/** Evidence of a step that ran: what it looked for and what it observed. */
export interface StepExecution {
  expected: unknown;
  actual: unknown;
}

/** Thrown by a step that ran but did not meet expectations; carries its evidence. */
export class StepFailure extends StepError {
  readonly execution: StepExecution;

  constructor(error: StepError, execution: StepExecution) {
    super(error.code, error.message, error.details, error.kind);
    this.execution = execution;
  }
}
