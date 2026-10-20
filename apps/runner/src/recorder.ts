import { readFileSync } from 'node:fs';
import {
  appendRecordingEvent,
  type FlowDb,
  finishRecording,
  getEnvironment,
  heartbeatRecording,
  markRecordingStopping,
  RECORDING_MAX_EVENTS,
  RECORDING_MAX_MS,
  type RecordingRow,
} from '@flowcheck/db';
import {
  ARIA_ROLES,
  effectiveAllowedOrigins,
  looksGeneratedId,
  pageEventSchema,
  type RecordedEvent,
  type RUNNER_NOTICES,
} from '@flowcheck/shared';
import { buildNavigateUrl, installTargetGuard } from '@flowcheck/test-engine';
import type { Logger } from 'pino';
import { type Browser, type BrowserContext, chromium, type Page } from 'playwright';
import type { RunnerConfig } from './config.ts';

const POLL_MS = 300;
const BINDING = '__flowcheckRecord';
/** A main-frame navigation this soon after a recorded action is its result, not a separate step. */
const ACTION_NAVIGATION_GRACE_MS = 3_000;
const FLUSH_TIMEOUT_MS = 2_000;

/**
 * The page script plus a bootstrap that passes it its configuration. `looksGeneratedId` is the
 * shared implementation (its source, after Node's type stripping, is plain JavaScript).
 */
function recorderInitScript(): string {
  const source = readFileSync(new URL('./recorder-page.js', import.meta.url), 'utf8');
  return `${source}
flowcheckRecorder({ binding: ${JSON.stringify(BINDING)}, roles: ${JSON.stringify(ARIA_ROLES)}, looksGeneratedId: ${looksGeneratedId.toString()} });`;
}

/**
 * Opens a visible browser and records what the tester does (PROJECT_RULES §8). Events are
 * validated and stored in order; the draft steps are derived from them by the server. Stopping
 * flushes pending typing first. Closing the window stops the recording (draft kept, warning).
 * Always finishes the recording and releases the execution lock.
 */
export async function runRecording(
  recording: RecordingRow,
  { db, config, log, shutdown }: { db: FlowDb; config: RunnerConfig; log: Logger; shutdown: AbortSignal },
): Promise<void> {
  const recLog = log.child({ recordingId: recording.id });
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let windowClosed = false;
  let stopFromPage = false;
  let limitReached = false;
  let lastActionAt = 0;
  let ready = false;
  let lastUrl = '';
  let stored = 0;
  const noticed = new Set<string>();

  const record = (event: RecordedEvent) => {
    try {
      const result = appendRecordingEvent(db, recording.id, event);
      if (!result.duplicate && event.kind !== 'notice') stored += 1;
      if (stored >= RECORDING_MAX_EVENTS && !limitReached) {
        limitReached = true;
        notice('eventLimit');
      }
    } catch (error) {
      recLog.warn({ err: (error as Error).message }, 'recorded event not stored');
    }
  };
  const notice = (code: (typeof RUNNER_NOTICES)[number]) => {
    if (noticed.has(code)) return;
    noticed.add(code);
    record({ kind: 'notice', code });
  };

  try {
    const env = getEnvironment(db, recording.environmentId);
    const frontend = new URL(env.frontendBaseUrl);
    const frontendPrefix = `${frontend.origin}${frontend.pathname.replace(/\/+$/, '')}`;
    browser = await chromium.launch({
      headless: config.recorderHeadless,
      args: [
        // Exposes element.computedRole / computedName: the browser's own accessible role and name.
        '--enable-blink-features=ComputedAccessibilityInfo',
        ...(config.recorderDebugPort ? [`--remote-debugging-port=${config.recorderDebugPort}`] : []),
      ],
    });
    browser.on('disconnected', () => {
      windowClosed = true;
    });
    context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
    await installTargetGuard(context, { allowedOrigins: effectiveAllowedOrigins(env), allowPrivateNetwork: env.allowPrivateNetwork });

    await context.exposeBinding(BINDING, (source, payload: unknown) => {
      if (limitReached || !page || source.page !== page) return; // popups are reported, not recorded
      const parsed = pageEventSchema.safeParse(payload);
      if (!parsed.success) {
        notice('invalidEvent');
        return;
      }
      const event = parsed.data;
      if (event.kind === 'stop') {
        stopFromPage = true;
        return;
      }
      if (source.frame !== page.mainFrame() && event.kind !== 'unsupported') {
        notice('iframe');
        return;
      }
      lastActionAt = Date.now();
      record(event);
    });
    await context.addInitScript({ content: recorderInitScript() });
    context.on('page', (other) => {
      if (page && other !== page) notice('popup');
    });

    page = await context.newPage();
    const main = page;
    main.on('close', () => {
      windowClosed = true;
    });
    main.on('framenavigated', (frame) => {
      if (!ready || frame !== main.mainFrame()) return;
      const url = frame.url();
      if (url === lastUrl) return;
      lastUrl = url;
      if (Date.now() - lastActionAt < ACTION_NAVIGATION_GRACE_MS) return;
      // A navigation the tester made directly: keep it as an "Open page" step.
      if (url === frontendPrefix || url.startsWith(`${frontendPrefix}/`)) {
        record({ kind: 'navigate', url: url.slice(frontendPrefix.length) || '/' });
      } else if (/^https?:/.test(url)) {
        record({ kind: 'navigate', url });
      } else {
        notice('offsiteNavigation');
      }
    });

    await main.goto(buildNavigateUrl(env.frontendBaseUrl, recording.startPath).href).catch((error: Error) => {
      recLog.warn({ err: error.message }, 'start page did not load');
    });
    lastUrl = main.url();
    ready = true;
    recLog.info('recording');

    const deadline = recording.createdAt + RECORDING_MAX_MS;
    for (;;) {
      const row = heartbeatRecording(db, recording.id);
      if (windowClosed) {
        notice('browserClosed');
        finishRecording(db, recording.id, 'stopped');
        return;
      }
      if (shutdown.aborted) {
        notice('runnerStopped');
        finishRecording(db, recording.id, 'stopped');
        return;
      }
      const timeUp = Date.now() > deadline;
      if (row.stopRequestedAt !== null || stopFromPage || limitReached || timeUp) {
        if (timeUp) notice('timeLimit');
        markRecordingStopping(db, recording.id);
        // Typing that has not been sent yet becomes the last fill.
        await Promise.race([
          main.evaluate(() => (globalThis as { __flowcheckRecorderFlush?: () => void }).__flowcheckRecorderFlush?.()),
          new Promise((resolve) => setTimeout(resolve, FLUSH_TIMEOUT_MS)),
        ]).catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, 200));
        finishRecording(db, recording.id, 'stopped');
        recLog.info({ events: stored }, 'recording stopped');
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  } catch (error) {
    recLog.error({ err: error }, 'recording failed');
    finishRecording(db, recording.id, 'failed', `The browser could not be used: ${(error as Error).message.split('\n')[0]}`);
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}
