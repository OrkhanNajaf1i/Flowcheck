import { z } from 'zod';

export const RUN_STATUSES = ['queued', 'running', 'passed', 'failed', 'error', 'cancelled', 'interrupted'] as const;
export const runStatusSchema = z.enum(RUN_STATUSES);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const FINAL_RUN_STATUSES = ['passed', 'failed', 'error', 'cancelled', 'interrupted'] as const;
export type FinalRunStatus = (typeof FINAL_RUN_STATUSES)[number];

export function isFinalRunStatus(status: RunStatus): status is FinalRunStatus {
  return (FINAL_RUN_STATUSES as readonly string[]).includes(status);
}

export const STEP_STATUSES = ['pending', 'running', 'passed', 'failed', 'error', 'skipped', 'cancelled', 'interrupted'] as const;
export const stepStatusSchema = z.enum(STEP_STATUSES);
export type StepStatus = z.infer<typeof stepStatusSchema>;

export const STEP_PHASES = ['setup', 'main', 'cleanup'] as const;
export const stepPhaseSchema = z.enum(STEP_PHASES);
export type StepPhase = z.infer<typeof stepPhaseSchema>;

export const ENVIRONMENT_KINDS = ['local', 'staging'] as const;
export const environmentKindSchema = z.enum(ENVIRONMENT_KINDS);
export type EnvironmentKind = z.infer<typeof environmentKindSchema>;
