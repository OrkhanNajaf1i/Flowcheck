/**
 * Runs before `pnpm start` / `pnpm dev` and makes a first start work on a fresh machine:
 * - Node.js version (plain JavaScript on purpose: older Node versions cannot run the .ts scripts);
 * - dependencies installed;
 * - the Chromium build of the pinned Playwright version (downloaded automatically when missing).
 * Every problem ends with one sentence saying what to do.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const fail = (message) => {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
};

const [major, minor] = process.versions.node.split('.').map(Number);
if (major !== 24 || minor < 11) {
  fail(
    `FlowCheck needs Node.js 24 (24.11 or newer); this is ${process.versions.node}.\n` +
      '  Install Node.js 24 LTS from https://nodejs.org (or run "nvm install 24" / "nvm use 24") and start again.',
  );
}

const runnerDir = resolve(root, 'apps/runner');
if (!existsSync(resolve(root, 'node_modules')) || !existsSync(resolve(runnerDir, 'node_modules/playwright'))) {
  fail('Dependencies are not installed yet. Run "pnpm install" in the FlowCheck folder, then start again.');
}

const require = createRequire(resolve(runnerDir, 'package.json'));
const { chromium } = require('playwright');
if (!existsSync(chromium.executablePath())) {
  console.log('Chromium for FlowCheck is not installed yet; downloading it once (about 150 MB)…');
  const cli = resolve(runnerDir, 'node_modules/playwright/cli.js');
  const result = spawnSync(process.execPath, [cli, 'install', 'chromium'], { stdio: 'inherit' });
  if (result.status !== 0) {
    fail('Chromium could not be downloaded. Check the internet connection and run "pnpm playwright:install", then start again.');
  }
}
