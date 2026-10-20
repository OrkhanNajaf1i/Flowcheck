import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  completeStep,
  createPendingSteps,
  type FlowDb,
  finishRun,
  getEnvironment,
  getRevision,
  getTestCase,
  heartbeatRun,
  insertArtifact,
  loadMasterKey,
  markStepRunning,
  newId,
  newSuffix,
  RepoError,
  type RunRow,
  revealAuthProfile,
  revealSecrets,
} from '@flowcheck/db';
import { allSteps, type FailureSummary, type FinalRunStatus, parseDefinition, referencedSecrets, resolveInputs } from '@flowcheck/shared';
import { type AbortReason, computeRunStatus, effectiveRunTimeout, runDefinition } from '@flowcheck/test-engine';
import type { Logger } from 'pino';
import { type Browser, type BrowserContext, chromium } from 'playwright';
import type { RunnerConfig } from './config.ts';

const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;

export interface ExecuteRunDeps {
  db: FlowDb;
  config: RunnerConfig;
  log: Logger;
  /** Aborted when the runner process shuts down. */
  shutdown: AbortSignal;
}

/**
 * Executes one claimed run end to end and always finishes it with a final status.
 * Never throws: unexpected failures end the run as "error".
 */
export async function executeRun(run: RunRow, deps: ExecuteRunDeps): Promise<FinalRunStatus> {
  const { db, log } = deps;
  const runLog = log.child({ runId: run.id });
  try {
    const outcome = await execute(run, { ...deps, log: runLog });
    finishRun(db, run.id, outcome.status, outcome.failureSummary);
    runLog.info({ status: outcome.status }, 'run finished');
    return outcome.status;
  } catch (error) {
    runLog.error({ err: error }, 'runner failed while executing run');
    finishRun(db, run.id, 'error', { code: 'INTERNAL_ERROR', message: `Runner error: ${(error as Error).message}` });
    return 'error';
  }
}

async function execute(
  run: RunRow,
  { db, config, log, shutdown }: ExecuteRunDeps,
): Promise<{ status: FinalRunStatus; failureSummary: FailureSummary | null }> {
  const revision = getRevision(db, run.revisionId);
  const parsed = parseDefinition(revision.definition);
  if (!parsed.ok) {
    const message = parsed.code === 'UNSUPPORTED_SCHEMA_VERSION' ? parsed.message : 'Stored definition is invalid';
    return { status: 'error', failureSummary: { code: parsed.code, message } };
  }
  const definition = parsed.definition;

  const inputs = resolveInputs(definition, run.inputsSnapshot);
  if (!inputs.ok) {
    return { status: 'error', failureSummary: { code: 'VALIDATION_ERROR', message: inputs.issues.map((i) => i.message).join('; ') } };
  }
  // Secrets are decrypted only now, only those the test uses, and never written to the run.
  const projectIdForSecrets = getTestCase(db, run.testCaseId).projectId;
  let secrets: Record<string, string>;
  try {
    secrets = revealSecrets(db, loadMasterKey(config.dataDir), projectIdForSecrets, referencedSecrets(definition));
  } catch (error) {
    if (error instanceof RepoError && error.code === 'SECRET_NOT_FOUND') {
      return { status: 'error', failureSummary: { code: 'SECRET_NOT_FOUND', message: error.message } };
    }
    return {
      status: 'error',
      failureSummary: {
        code: 'INTERNAL_ERROR',
        message: 'Secrets could not be decrypted (is the master key the same as when they were saved?)',
      },
    };
  }
  // The snapshot decides targets; the live environment only decides whether running is allowed.
  if (!getEnvironment(db, run.environmentId).enabled) {
    return {
      status: 'error',
      failureSummary: { code: 'ENVIRONMENT_DISABLED', message: 'The environment was disabled before the run started' },
    };
  }

  const projectId = getTestCase(db, run.testCaseId).projectId;
  const planned = allSteps(definition).map(({ phase, step }, order) => ({
    stepId: step.id,
    name: step.name,
    type: step.type,
    phase,
    order,
  }));
  createPendingSteps(db, run.id, planned);

  const abort = new AbortController();
  const abortWith = (reason: AbortReason) => {
    if (!abort.signal.aborted) abort.abort(reason);
  };

  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  const forceClose = () => {
    void context?.close().catch(() => undefined);
  };

  const onShutdown = () => {
    abortWith({ kind: 'interrupted', code: 'PROCESS_INTERRUPTED' });
    forceClose();
  };
  shutdown.addEventListener('abort', onShutdown, { once: true });

  const runTimeoutMs = effectiveRunTimeout(definition);
  const runTimer = setTimeout(() => {
    log.warn({ runTimeoutMs }, 'run timeout reached');
    abortWith({ kind: 'interrupted', code: 'RUN_TIMEOUT' });
    forceClose();
  }, runTimeoutMs);

  let graceTimer: NodeJS.Timeout | undefined;
  const heartbeat = setInterval(() => {
    try {
      const { cancellationRequestedAt } = heartbeatRun(db, run.id);
      if (cancellationRequestedAt !== null && !abort.signal.aborted) {
        log.info('cancellation requested');
        abortWith({ kind: 'cancelled' });
        graceTimer = setTimeout(forceClose, config.cancelGraceMs);
      }
    } catch (error) {
      log.error({ err: error }, 'heartbeat failed');
    }
  }, config.heartbeatIntervalMs);

  try {
    browser = await chromium.launch({ headless: !config.headed });
    // A saved login session is loaded into the new context; it is never written back.
    let storageState: Exclude<Parameters<Browser['newContext']>[0], undefined>['storageState'];
    if (definition.authProfileId) {
      const { profile, storageState: state } = revealAuthProfile(db, loadMasterKey(config.dataDir), definition.authProfileId);
      if (profile.environmentId !== run.environmentId) {
        return {
          status: 'error',
          failureSummary: {
            code: 'AUTH_PROFILE_ENVIRONMENT_MISMATCH',
            message: `The login session "${profile.name}" belongs to another website`,
          },
        };
      }
      storageState = state as typeof storageState;
    }
    context = await browser.newContext({
      ...(storageState ? { storageState } : {}),
      // Service workers could bypass request interception and the target guard.
      serviceWorkers: 'block',
      acceptDownloads: false,
    });

    const startedAt = new Date(run.startedAt ?? Date.now()).toISOString();
    const result = await runDefinition({
      context,
      definition,
      environment: run.environmentSnapshot,
      inputs: inputs.values,
      secrets,
      run: { id: run.id, startedAt, suffix: newSuffix() },
      signal: abort.signal,
      reporter: {
        async stepStarted(ref, at) {
          markStepRunning(db, run.id, ref.order, at.getTime());
        },
        async stepFinished(ref, report) {
          const row = completeStep(db, run.id, ref.order, {
            status: report.status,
            startedAt: report.startedAt?.getTime() ?? null,
            finishedAt: report.finishedAt?.getTime() ?? null,
            expected: report.expected,
            actual: report.actual,
            errorCode: report.errorCode,
            errorMessage: report.errorMessage,
            skipReason: report.skipReason,
          });
          if (report.screenshot && report.screenshot.length <= MAX_ARTIFACT_BYTES) {
            const relativePath = join(projectId, run.id, `${newId()}.png`);
            const absolute = join(config.artifactsDir, relativePath);
            mkdirSync(dirname(absolute), { recursive: true });
            writeFileSync(absolute, report.screenshot);
            insertArtifact(db, {
              runId: run.id,
              stepRunId: row.id,
              type: 'screenshot',
              relativePath,
              mimeType: 'image/png',
              size: report.screenshot.length,
              // Screenshots are never redacted and may show personal data.
              sensitive: true,
            });
          }
        },
      },
    });

    const status = computeRunStatus(result.steps, {
      cancelled: result.abort?.kind === 'cancelled',
      interrupted: result.abort?.kind === 'interrupted',
    });
    return { status, failureSummary: summarize(status, result) };
  } catch (error) {
    if (abort.signal.aborted) {
      const reason = abort.signal.reason as AbortReason;
      return reason.kind === 'cancelled'
        ? { status: 'cancelled', failureSummary: null }
        : { status: 'interrupted', failureSummary: { code: reason.code, message: interruptMessage(reason.code) } };
    }
    return {
      status: 'error',
      failureSummary: { code: 'BROWSER_ERROR', message: `Browser could not be started or failed: ${(error as Error).message}` },
    };
  } finally {
    clearTimeout(runTimer);
    clearTimeout(graceTimer);
    clearInterval(heartbeat);
    shutdown.removeEventListener('abort', onShutdown);
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}

function summarize(status: FinalRunStatus, result: Awaited<ReturnType<typeof runDefinition>>): FailureSummary | null {
  if (status === 'passed' || status === 'cancelled') return null;
  if (result.abort?.kind === 'interrupted') return { code: result.abort.code, message: interruptMessage(result.abort.code) };
  if (result.primaryFailure) return result.primaryFailure;
  return { code: 'INTERNAL_ERROR', message: 'The run did not complete all required steps' };
}

function interruptMessage(code: 'RUN_TIMEOUT' | 'PROCESS_INTERRUPTED'): string {
  return code === 'RUN_TIMEOUT'
    ? 'The run exceeded its run timeout and was stopped; results are incomplete'
    : 'The runner stopped before the run completed; results are incomplete';
}
