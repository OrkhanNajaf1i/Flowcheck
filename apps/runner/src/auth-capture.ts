import {
  type AuthCaptureRow,
  CAPTURE_MAX_MS,
  type FlowDb,
  finishAuthCapture,
  getEnvironment,
  heartbeatAuthCapture,
  loadMasterKey,
  markAuthCaptureSaving,
  saveAuthProfile,
} from '@flowcheck/db';
import { effectiveAllowedOrigins } from '@flowcheck/shared';
import { buildNavigateUrl, installTargetGuard } from '@flowcheck/test-engine';
import type { Logger } from 'pino';
import { type Browser, type BrowserContext, chromium } from 'playwright';
import type { RunnerConfig } from './config.ts';

const POLL_MS = 500;

/**
 * Opens a visible browser on the tester's machine so they can log in by hand (PROJECT_RULES §12).
 * The tester presses "Save session" in FlowCheck; the storage state (cookies, localStorage,
 * IndexedDB) is then stored encrypted. Closing the window cancels. Always finishes the capture
 * and releases the execution lock.
 */
export async function runAuthCapture(
  capture: AuthCaptureRow,
  { db, config, log, shutdown }: { db: FlowDb; config: RunnerConfig; log: Logger; shutdown: AbortSignal },
): Promise<void> {
  const captureLog = log.child({ captureId: capture.id });
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let windowClosed = false;
  try {
    const env = getEnvironment(db, capture.environmentId);
    browser = await chromium.launch({ headless: config.captureHeadless });
    browser.on('disconnected', () => {
      windowClosed = true;
    });
    // Same isolation and target policy as a run: no service workers, only allowed origins.
    context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
    await installTargetGuard(context, { allowedOrigins: effectiveAllowedOrigins(env), allowPrivateNetwork: env.allowPrivateNetwork });
    const page = await context.newPage();
    page.on('close', () => {
      if (context && context.pages().length === 0) windowClosed = true;
    });
    await page.goto(buildNavigateUrl(env.frontendBaseUrl, capture.startPath).href).catch((error: Error) => {
      // The tester can still navigate by hand; the reason is logged, not hidden.
      captureLog.warn({ err: error.message }, 'start page did not load');
    });
    captureLog.info('waiting for the tester to log in');

    const deadline = capture.createdAt + CAPTURE_MAX_MS;
    for (;;) {
      const row = heartbeatAuthCapture(db, capture.id);
      if (row.cancelRequestedAt !== null) {
        finishAuthCapture(db, capture.id, 'cancelled');
        return;
      }
      if (windowClosed) {
        finishAuthCapture(db, capture.id, 'cancelled', { error: 'The browser window was closed before the session was saved' });
        return;
      }
      if (shutdown.aborted) {
        finishAuthCapture(db, capture.id, 'failed', { error: 'FlowCheck stopped while the browser was open' });
        return;
      }
      if (Date.now() > deadline) {
        finishAuthCapture(db, capture.id, 'failed', { error: 'No session was saved within 15 minutes' });
        return;
      }
      if (row.saveRequestedAt !== null) {
        markAuthCaptureSaving(db, capture.id);
        const storageState = await context.storageState({ indexedDB: true });
        const profile = saveAuthProfile(db, loadMasterKey(config.dataDir), {
          projectId: capture.projectId,
          environmentId: capture.environmentId,
          name: capture.profileName,
          storageState,
        });
        finishAuthCapture(db, capture.id, 'saved', { authProfileId: profile.id });
        captureLog.info({ authProfileId: profile.id, cookies: storageState.cookies.length }, 'login session saved');
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  } catch (error) {
    captureLog.error({ err: error }, 'login session capture failed');
    finishAuthCapture(db, capture.id, 'failed', { error: `The browser could not be used: ${(error as Error).message.split('\n')[0]}` });
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}
