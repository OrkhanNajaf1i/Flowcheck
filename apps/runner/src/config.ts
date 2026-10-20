import { resolve } from 'node:path';

export interface RunnerConfig {
  dataDir: string;
  dbFile: string;
  artifactsDir: string;
  headed: boolean;
  /** Login-session capture browser; visible by default (tests set FLOWCHECK_CAPTURE_HEADLESS=1). */
  captureHeadless: boolean;
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
  /** Time a running step gets to finish after a cancel request before the browser is closed. */
  cancelGraceMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RunnerConfig {
  const dataDir = resolve(env.FLOWCHECK_DATA_DIR ?? resolve(import.meta.dirname, '../../../data'));
  return {
    dataDir,
    dbFile: resolve(dataDir, 'flowcheck.db'),
    artifactsDir: resolve(dataDir, 'artifacts'),
    headed: env.FLOWCHECK_HEADED === '1',
    captureHeadless: env.FLOWCHECK_CAPTURE_HEADLESS === '1',
    pollIntervalMs: 500,
    heartbeatIntervalMs: 2_000,
    cancelGraceMs: 5_000,
  };
}
