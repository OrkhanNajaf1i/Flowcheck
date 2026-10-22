import {
  type EnvironmentSnapshot,
  type ErrorCode,
  effectiveAllowedOrigins,
  type InputValue,
  type Step,
  type StepPhase,
  type StepStatus,
  type TestDefinition,
} from '@flowcheck/shared';
import type { BrowserContext, Page } from 'playwright';
import { StepError } from './errors.ts';
import { redactJson, redactText } from './redact.ts';
import { effectiveStepTimeout, type StepOutcome } from './status.ts';
import { executeStep, expectedOf, firstLine, StepFailure, UI_STEP_TYPES } from './steps.ts';
import type { TargetGuard } from './target-guard.ts';
import type { TargetPolicy } from './url-policy.ts';
import { VariableScope } from './variables.ts';

export interface StepReport {
  status: Exclude<StepStatus, 'pending' | 'running'>;
  expected: unknown;
  actual: unknown;
  errorCode: ErrorCode | null;
  errorMessage: string | null;
  skipReason: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  screenshot: Buffer | null;
}

export interface StepRef {
  phase: StepPhase;
  /** Position within the whole run (setup, then main, then cleanup). */
  order: number;
  step: Step;
}

export interface EngineReporter {
  stepStarted(ref: StepRef, startedAt: Date): Promise<void>;
  stepFinished(ref: StepRef, report: StepReport): Promise<void>;
}

/** Why a run was aborted from outside: user cancel, or interruption (run timeout, shutdown). */
export type AbortReason = { kind: 'cancelled' } | { kind: 'interrupted'; code: 'RUN_TIMEOUT' | 'PROCESS_INTERRUPTED' };

export interface RunDefinitionOptions {
  /** Created with guard.contextOptions, so all its traffic goes through the target guard. */
  context: BrowserContext;
  guard: TargetGuard;
  definition: TestDefinition;
  environment: EnvironmentSnapshot;
  inputs: Record<string, InputValue>;
  /** Decrypted values of the secrets the definition refers to; redacted from all evidence. */
  secrets?: Record<string, string>;
  run: { id: string; startedAt: string; suffix: string };
  reporter: EngineReporter;
  /** Aborted by the runner; `signal.reason` is an AbortReason. */
  signal: AbortSignal;
  /** After a cancel, the running step gets this long before its page is closed (default 5 s). */
  cancelGraceMs?: number;
}

/** Time cleanup steps get after a cancel, in total (PROJECT_RULES §13, best effort). */
export const CANCEL_CLEANUP_MS = 15_000;

export interface RunDefinitionResult {
  steps: StepOutcome[];
  abort: AbortReason | null;
  /** First failure in setup or main; cleanup never overwrites it. */
  primaryFailure: { stepId: string; code: ErrorCode; message: string } | null;
  browserCrashed: boolean;
  /** After a cancel: whether every cleanup step passed (null when not cancelled or no cleanup). */
  cleanupAfterCancelComplete: boolean | null;
}

/**
 * Executes setup -> main -> cleanup (PROJECT_RULES §13).
 * - A setup failure skips the rest of setup and all main steps; cleanup still runs.
 * - The first main failure skips the remaining main steps; cleanup still runs.
 * - A cleanup step whose variables are missing is skipped with a visible reason.
 * - Cancel: remaining setup/main steps are cancelled; a running step gets a grace period, then its
 *   page is closed (the context and its cookies stay). Cleanup still runs, best effort, on a fresh
 *   page within CANCEL_CLEANUP_MS. Timeouts and shutdowns skip cleanup.
 */
export async function runDefinition(options: RunDefinitionOptions): Promise<RunDefinitionResult> {
  const { context, definition, environment, reporter, signal } = options;
  const policy: TargetPolicy = {
    allowedOrigins: effectiveAllowedOrigins(environment),
    allowPrivateNetwork: environment.allowPrivateNetwork,
  };

  const scope = new VariableScope();
  for (const [name, value] of Object.entries(options.inputs)) scope.set('inputs', name, value);
  scope.set('run', 'id', options.run.id);
  scope.set('run', 'startedAt', options.run.startedAt);
  scope.set('run', 'suffix', options.run.suffix);
  for (const [name, value] of Object.entries(options.secrets ?? {})) scope.set('secrets', name, value);

  await options.guard.install(context);
  const blocked = options.guard.blocked;
  let browserCrashed = false;
  const openPage = async () => {
    const created = await context.newPage();
    created.on('crash', () => {
      browserCrashed = true;
    });
    return created;
  };
  let page: Page = await openPage();

  // A step that ignores the cancel is stopped by closing its page after the grace period.
  let stepRunning = false;
  let graceTimer: NodeJS.Timeout | undefined;
  signal.addEventListener(
    'abort',
    () => {
      if ((signal.reason as AbortReason).kind !== 'cancelled') return;
      graceTimer = setTimeout(() => {
        if (stepRunning) void page.close().catch(() => undefined);
      }, options.cancelGraceMs ?? 5_000);
    },
    { once: true },
  );

  const refs: StepRef[] = [];
  for (const [phase, steps] of [
    ['setup', definition.setupSteps],
    ['main', definition.steps],
    ['cleanup', definition.cleanupSteps],
  ] as const) {
    for (const step of steps) refs.push({ phase, order: refs.length, step });
  }

  const outcomes: StepOutcome[] = [];
  let primaryFailure: RunDefinitionResult['primaryFailure'] = null;
  let blockReason: string | null = null;

  const abortReason = (): AbortReason | null => (signal.aborted ? (signal.reason as AbortReason) : null);

  let cleanupDeadline: number | null = null;
  const cancelledCleanup: StepReport['status'][] = [];

  for (const ref of refs) {
    const abort = abortReason();
    const cleanupAfterCancel = abort?.kind === 'cancelled' && ref.phase === 'cleanup';
    if (abort && !cleanupAfterCancel) {
      const status = abort.kind === 'cancelled' ? 'cancelled' : 'interrupted';
      await finish(ref, skipped(status, abort.kind === 'cancelled' ? 'Run was cancelled' : 'Run was interrupted'));
      continue;
    }
    if (cleanupAfterCancel) {
      cleanupDeadline ??= Date.now() + CANCEL_CLEANUP_MS;
      if (Date.now() >= cleanupDeadline) {
        cancelledCleanup.push('skipped');
        await finish(ref, skipped('skipped', 'Cleanup after cancel ran out of time (15 s); test data may remain'));
        continue;
      }
      if (page.isClosed()) {
        try {
          page = await openPage();
        } catch {
          cancelledCleanup.push('error');
          await finish(ref, skipped('skipped', 'Cleanup after cancel could not open a page; test data may remain'));
          continue;
        }
      }
    }
    if (ref.phase !== 'cleanup' && blockReason) {
      await finish(ref, skipped('skipped', blockReason));
      continue;
    }

    const startedAt = new Date();
    await reporter.stepStarted(ref, startedAt);
    stepRunning = true;
    const report = await executeOne(ref, startedAt, cleanupAfterCancel ? cleanupDeadline : null);
    stepRunning = false;
    // Skipped for a missing variable: the data it would delete was never created.
    if (cleanupAfterCancel) cancelledCleanup.push(report.status === 'skipped' ? 'passed' : report.status);
    await finish(ref, report);

    if (report.status === 'failed' || report.status === 'error') {
      if (ref.phase !== 'cleanup' && primaryFailure === null) {
        primaryFailure = {
          stepId: ref.step.id,
          code: report.errorCode ?? 'INTERNAL_ERROR',
          message: report.errorMessage ?? 'Step failed',
        };
      }
      if (ref.phase === 'setup') blockReason = `Setup step "${ref.step.name}" did not pass`;
      if (ref.phase === 'main') blockReason = `Previous main step "${ref.step.name}" did not pass`;
    }
  }

  clearTimeout(graceTimer);
  const cleanupAfterCancelComplete =
    abortReason()?.kind === 'cancelled' && definition.cleanupSteps.length > 0
      ? cancelledCleanup.length === definition.cleanupSteps.length && cancelledCleanup.every((status) => status === 'passed')
      : null;
  return { steps: outcomes, abort: abortReason(), primaryFailure, browserCrashed, cleanupAfterCancelComplete };

  async function finish(ref: StepRef, report: StepReport) {
    outcomes.push({ phase: ref.phase, status: report.status });
    await reporter.stepFinished(ref, report);
  }

  /** `maxDeadline`: cleanup after a cancel shares one time budget. */
  async function executeOne(ref: StepRef, startedAt: Date, maxDeadline: number | null): Promise<StepReport> {
    const timeoutMs = effectiveStepTimeout(ref.step, definition);
    const cleanupAfterCancel = maxDeadline !== null;
    try {
      const execution = await executeStep(ref.step, {
        page,
        context,
        environment,
        policy,
        scope,
        blocked,
        deadline: Math.min(Date.now() + timeoutMs, maxDeadline ?? Number.POSITIVE_INFINITY),
      });
      // Outputs are published only now that the whole step (incl. network checks) has passed.
      for (const [name, value] of Object.entries(execution.outputs ?? {})) scope.set('outputs', name, value);
      // Optional visual evidence of a passed step (requested per step; never a check by itself).
      const screenshot = 'screenshot' in ref.step && ref.step.screenshot === true ? await captureScreenshot(page) : null;
      // Blocked requests are shown on passing steps too, so a missing CDN origin is visible.
      return {
        ...done('passed', startedAt),
        screenshot,
        expected: redactJson(execution.expected, scope.secretValues()),
        actual: redactJson(withBlocked(execution.actual, blocked, startedAt.getTime()), scope.secretValues()),
      };
    } catch (error) {
      const abort = abortReason();
      // Cleanup after a cancel reports its real outcome (it runs on purpose despite the cancel).
      if (abort && !cleanupAfterCancel) {
        if (abort.kind === 'cancelled') {
          return { ...done('cancelled', startedAt), errorMessage: 'Step stopped: run cancelled' };
        }
        return { ...done('interrupted', startedAt), errorCode: abort.code, errorMessage: 'Step stopped: run interrupted' };
      }
      const stepError = toStepError(error, browserCrashed);
      if (ref.phase === 'cleanup' && stepError.code === 'MISSING_VARIABLE') {
        return { ...skipped('skipped', `Cleanup skipped: ${stepError.message}`), startedAt, finishedAt: new Date() };
      }
      const screenshot = UI_STEP_TYPES.has(ref.step.type) && !browserCrashed ? await captureScreenshot(page) : null;
      // Without step-specific evidence, show what the step looked for and the facts the error observed.
      const execution =
        error instanceof StepFailure
          ? error.execution
          : { expected: expectedOf(ref.step), actual: Object.keys(stepError.details).length > 0 ? stepError.details : null };
      return {
        ...done(stepError.kind, startedAt),
        expected: redactJson(execution.expected, scope.secretValues()),
        actual: redactJson(withBlocked(execution.actual, blocked, startedAt.getTime()), scope.secretValues()),
        errorCode: stepError.code,
        // Error texts can echo what was typed; never let a secret value through.
        errorMessage: redactText(stepError.message, scope.secretValues()),
        screenshot,
      };
    }
  }
}

function done(status: StepReport['status'], startedAt: Date): StepReport {
  return {
    status,
    expected: null,
    actual: null,
    errorCode: null,
    errorMessage: null,
    skipReason: null,
    startedAt,
    finishedAt: new Date(),
    screenshot: null,
  };
}

function skipped(status: 'skipped' | 'cancelled' | 'interrupted', reason: string): StepReport {
  return { ...done(status, new Date()), startedAt: null, finishedAt: null, skipReason: reason };
}

function toStepError(error: unknown, browserCrashed: boolean): StepError {
  if (error instanceof StepError) return error;
  if (browserCrashed || /Target page, context or browser has been closed|Browser closed/i.test(String(error))) {
    return new StepError('BROWSER_ERROR', `Browser failed during the step: ${firstLine(error)}`);
  }
  return new StepError('INTERNAL_ERROR', `Unexpected error: ${firstLine(error)}`);
}

function withBlocked(actual: unknown, blocked: { at: number; url: string; reason: string }[], since: number): unknown {
  const during = blocked.filter((b) => b.at >= since).map(({ url, reason }) => ({ url, reason }));
  if (during.length === 0) return actual;
  return { ...(typeof actual === 'object' && actual !== null ? actual : {}), blockedRequests: during };
}

async function captureScreenshot(page: Page): Promise<Buffer | null> {
  try {
    return await page.screenshot({ timeout: 5_000 });
  } catch {
    return null;
  }
}
