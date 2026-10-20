import type { FinalRunStatus, StepPhase, StepStatus, TestDefinition } from '@flowcheck/shared';
import { TIMEOUT_DEFAULTS } from '@flowcheck/shared';

export interface StepOutcome {
  phase: StepPhase;
  status: StepStatus;
}

export interface RunConditions {
  cancelled: boolean;
  /** Process loss or run timeout. */
  interrupted: boolean;
}

/**
 * Final run status (PROJECT_RULES §13). Priority: cancelled > interrupted > error > failed > passed.
 * "passed" requires every setup and main step to have passed and no failed/error cleanup step.
 * Anything not executed (pending/running/skipped in setup or main) can never produce "passed".
 */
export function computeRunStatus(steps: readonly StepOutcome[], conditions: RunConditions): FinalRunStatus {
  if (conditions.cancelled) return 'cancelled';
  if (conditions.interrupted) return 'interrupted';
  if (steps.some((s) => s.status === 'interrupted')) return 'interrupted';
  if (steps.some((s) => s.status === 'error')) return 'error';
  if (steps.some((s) => s.status === 'failed')) return 'failed';
  const required = steps.filter((s) => s.phase !== 'cleanup');
  if (required.length === 0 || !steps.some((s) => s.phase === 'main')) return 'error';
  if (required.every((s) => s.status === 'passed')) return 'passed';
  // A required step was not executed without an explicit failure: never report success.
  return 'error';
}

/** Effective step timeout: step override > definition default > global default. */
export function effectiveStepTimeout(step: { timeoutMs?: number | undefined }, def: Pick<TestDefinition, 'defaultTimeoutMs'>): number {
  return step.timeoutMs ?? def.defaultTimeoutMs ?? TIMEOUT_DEFAULTS.stepMs;
}

/** Run timeout is a hard cap, independent of step timeouts. */
export function effectiveRunTimeout(def: Pick<TestDefinition, 'runTimeoutMs'>): number {
  return def.runTimeoutMs ?? TIMEOUT_DEFAULTS.runMs;
}

/** Editor warning: step timeouts may add up to more than the run timeout. Not an error. */
export function stepTimeoutsExceedRunTimeout(def: TestDefinition): boolean {
  const steps = [...def.setupSteps, ...def.steps, ...def.cleanupSteps];
  const total = steps.reduce((sum, step) => sum + effectiveStepTimeout(step, def), 0);
  return total > effectiveRunTimeout(def);
}
