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
  type HTTP_METHODS,
  looksGeneratedId,
  MUTATING_HTTP_METHODS,
  pageEventSchema,
  type RecordedEvent,
  type RUNNER_NOTICES,
} from '@flowcheck/shared';
import { buildNavigateUrl, startTargetGuard, type TargetGuard, targetPolicy } from '@flowcheck/test-engine';
import type { Logger } from 'pino';
import { type Browser, type BrowserContext, chromium, type Page, type Response } from 'playwright';
import type { RunnerConfig } from './config.ts';

const POLL_MS = 300;
const BINDING = '__flowcheckRecord';
/** A main-frame navigation this soon after a recorded action is its result, not a separate step. */
const ACTION_NAVIGATION_GRACE_MS = 3_000;
const FLUSH_TIMEOUT_MS = 2_000;
/** Requests this soon after an action are attributed to it. */
const REQUEST_WINDOW_MS = 3_000;
/** A page-announced navigation commits within this time (redirects included). */
const PAGE_NAVIGATION_WINDOW_MS = 15_000;
const ACTION_KINDS: ReadonlySet<string> = new Set(['click', 'select', 'check', 'uncheck', 'press']);
const MUTATING: ReadonlySet<string> = new Set(MUTATING_HTTP_METHODS);
const ID_LIKE = /^\d{2,}$|^[0-9a-f]{8}-[0-9a-f]{4}-|^[0-9a-f]{24,}$/i;

/** A JSON response whose top level has a primitive "id" (bodies over 256 KB are not read). */
async function hasTopLevelId(response: Response): Promise<boolean> {
  if (!(response.headers()['content-type'] ?? '').includes('json')) return false;
  if (Number(response.headers()['content-length'] ?? 0) > 256 * 1024) return false;
  try {
    const body: unknown = await response.json();
    const id = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>).id : undefined;
    return typeof id === 'string' || typeof id === 'number';
  } catch {
    return false;
  }
}

/**
 * The page script plus a bootstrap that passes it its configuration. `looksGeneratedId` is the
 * shared implementation (its source, after Node's type stripping, is plain JavaScript).
 */
function recorderInitScript(language: RecordingRow['language']): string {
  const source = readFileSync(new URL('./recorder-page.js', import.meta.url), 'utf8');
  const config = `{ binding: ${JSON.stringify(BINDING)}, roles: ${JSON.stringify(ARIA_ROLES)}, texts: ${JSON.stringify(TOOLBAR_TEXTS[language])}, looksGeneratedId: ${looksGeneratedId.toString()} }`;
  return `${source}\nflowcheckRecorder(${config});`;
}

/** Texts of the in-page toolbar, in the language of the FlowCheck UI that started the recording. */
const TOOLBAR_TEXTS = {
  en: {
    recording: 'FlowCheck is recording',
    checkVisible: 'Check it is shown',
    checkText: 'Check text',
    stop: 'Stop',
    pickHint: 'Click the element to check (Esc cancels). The click does not reach the page.',
  },
  az: {
    recording: 'FlowCheck qeyd edir',
    checkVisible: 'Göründüyünü yoxla',
    checkText: 'Mətni yoxla',
    stop: 'Dayandır',
    pickHint: 'Yoxlanacaq elementə klikləyin (Esc — ləğv). Bu klik səhifəyə çatmır.',
  },
} as const;

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
  let guard: TargetGuard | undefined;
  let page: Page | undefined;
  let windowClosed = false;
  let stopFromPage = false;
  let limitReached = false;
  let lastActionAt = 0;
  /** The last recorded action: requests and page changes right after it become suggested checks. */
  let lastAction: { id: string; at: number } | null = null;
  /** When the page last announced a navigation it started itself; null when none is pending. */
  let pageNavigationAt: number | null = null;
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
    guard = await startTargetGuard(targetPolicy(env));
    context = await browser.newContext({ ...guard.contextOptions, serviceWorkers: 'block', acceptDownloads: false });
    await guard.install(context);

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
      if (event.kind === 'pageNavigation') {
        if (source.frame === page.mainFrame()) pageNavigationAt = Date.now();
        return;
      }
      if (source.frame !== page.mainFrame() && event.kind !== 'unsupported') {
        notice('iframe');
        return;
      }
      lastActionAt = Date.now();
      if (ACTION_KINDS.has(event.kind)) lastAction = { id: event.clientEventId, at: lastActionAt };
      record(event);
    });
    await context.addInitScript({ content: recorderInitScript(recording.language) });
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
      // The page announces navigations it starts itself (links, forms, scripts, pushState). Without
      // that announcement the tester navigated in the browser (address bar): never an action's result.
      const fromPage = pageNavigationAt !== null && Date.now() - pageNavigationAt < PAGE_NAVIGATION_WINDOW_MS;
      pageNavigationAt = null;
      if (fromPage && Date.now() - lastActionAt < ACTION_NAVIGATION_GRACE_MS) {
        // The result of an action: suggest checking the new address.
        if (lastAction && (url === frontendPrefix || url.startsWith(`${frontendPrefix}/`))) {
          record({ kind: 'observedUrl', after: lastAction.id, path: url.slice(frontendPrefix.length) || '/' });
        }
        return;
      }
      // A navigation the tester made directly: keep it as an "Open page" step.
      if (url === frontendPrefix || url.startsWith(`${frontendPrefix}/`)) {
        record({ kind: 'navigate', url: url.slice(frontendPrefix.length) || '/' });
      } else if (/^https?:/.test(url)) {
        record({ kind: 'navigate', url });
      } else {
        notice('offsiteNavigation');
      }
    });

    const apiOrigin = new URL(env.apiBaseUrl).origin;
    main.on('response', (response) => {
      const request = response.request();
      const action = lastAction;
      if (!ready || !action || Date.now() - action.at > REQUEST_WINDOW_MS) return;
      if (!['fetch', 'xhr'].includes(request.resourceType()) || !MUTATING.has(request.method())) return;
      const url = new URL(request.url());
      // Paths with ids differ on every run; a check pinned to one would fail next time.
      if (url.pathname.split('/').some((segment) => ID_LIKE.test(segment))) return;
      const origin = url.origin === frontend.origin ? 'frontend' : url.origin === apiOrigin ? 'api' : url.origin;
      void hasTopLevelId(response).then((hasId) =>
        record({
          kind: 'observedRequest',
          after: action.id,
          method: request.method() as (typeof HTTP_METHODS)[number],
          origin,
          pathname: url.pathname,
          status: response.status(),
          hasId,
        }),
      );
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
    await guard?.close().catch(() => undefined);
  }
}
