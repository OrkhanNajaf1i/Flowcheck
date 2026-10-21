import { createHmac } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

/**
 * Acceptance tests against the real stack: demo shop, FlowCheck server and runner run as
 * separate processes with a throwaway data directory. Nothing in the engine is mocked.
 * Ports differ from the dev defaults so a running dev instance does not interfere.
 */
export const SERVER_PORT = 4410;
export const DEMO_PORT = 4420;
export const RECORDER_CDP_PORT = 4430;

/** Fixed access token for the test server; requests carry its session cookie (PROJECT_RULES §17). */
export const ACCESS_TOKEN = 'e2e-access-token-0123456789abcdefghijkl';
export const SESSION_COOKIE = {
  name: `flowcheck_session_${SERVER_PORT}`,
  // Same derivation as apps/server/src/access.ts sessionValue().
  value: createHmac('sha256', ACCESS_TOKEN).update('flowcheck-session').digest('base64url'),
};

const dataDir = process.env.FLOWCHECK_E2E_DATA_DIR ?? mkdtempSync(join(tmpdir(), 'flowcheck-e2e-'));
process.env.FLOWCHECK_E2E_DATA_DIR = dataDir;

const env = {
  FLOWCHECK_DATA_DIR: dataDir,
  FLOWCHECK_SERVER_PORT: String(SERVER_PORT),
  FLOWCHECK_ACCESS_TOKEN: ACCESS_TOKEN,
  DEMO_PORT: String(DEMO_PORT),
  // The login-session capture browser is visible for real users; tests run it headless.
  FLOWCHECK_CAPTURE_HEADLESS: '1',
  // Same for the recorder; tests act in its browser over CDP like a tester would (real, trusted events).
  FLOWCHECK_RECORDER_HEADLESS: '1',
  FLOWCHECK_RECORDER_DEBUG_PORT: String(RECORDER_CDP_PORT),
};

export default defineConfig({
  testDir: './tests',
  // Shared demo state, one runner and one execution lock: tests run one at a time.
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  reporter: [['list']],
  // Every test browser is already signed in to the test server (as after opening the printed link).
  use: {
    storageState: {
      cookies: [{ ...SESSION_COOKIE, domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Strict' }],
      origins: [],
    },
  },
  webServer: [
    {
      command: 'node ../apps/demo/src/main.ts',
      url: `http://127.0.0.1:${DEMO_PORT}/api/products`,
      env,
      reuseExistingServer: false,
    },
    {
      command: 'node ../apps/server/src/main.ts',
      wait: { stdout: /Server listening/ },
      env,
      reuseExistingServer: false,
    },
    {
      command: 'node ../apps/runner/src/main.ts',
      wait: { stdout: /runner started/ },
      env,
      reuseExistingServer: false,
    },
  ],
});
