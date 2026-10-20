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

const dataDir = process.env.FLOWCHECK_E2E_DATA_DIR ?? mkdtempSync(join(tmpdir(), 'flowcheck-e2e-'));
process.env.FLOWCHECK_E2E_DATA_DIR = dataDir;

const env = {
  FLOWCHECK_DATA_DIR: dataDir,
  FLOWCHECK_SERVER_PORT: String(SERVER_PORT),
  DEMO_PORT: String(DEMO_PORT),
};

export default defineConfig({
  testDir: './tests',
  // Shared demo state, one runner and one execution lock: tests run one at a time.
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  reporter: [['list']],
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
