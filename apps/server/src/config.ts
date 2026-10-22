import { resolve } from 'node:path';

export interface ServerConfig {
  host: '127.0.0.1';
  port: number;
  dataDir: string;
  dbFile: string;
  artifactsDir: string;
  /** Built web UI served at / (production-like mode); ignored when it does not exist. */
  webDistDir: string | undefined;
  /** Host header values accepted (DNS-rebinding defence). */
  allowedHosts: string[];
  /** Origin header values accepted on state-changing requests. */
  allowedOrigins: string[];
  /** Artifact retention (PROJECT_RULES §16): 30 days and 500 MB per project by default. */
  retention: { maxAgeMs: number; projectQuotaBytes: number };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = Number(env.FLOWCHECK_SERVER_PORT ?? 4310);
  const dataDir = resolve(env.FLOWCHECK_DATA_DIR ?? resolve(import.meta.dirname, '../../../data'));
  // The Vite dev server proxies /api with the browser's Host and Origin.
  const ports = [port, Number(env.FLOWCHECK_WEB_DEV_PORT ?? 5173)];
  const hosts = ports.flatMap((p) => [`127.0.0.1:${p}`, `localhost:${p}`]);
  return {
    host: '127.0.0.1',
    port,
    dataDir,
    dbFile: resolve(dataDir, 'flowcheck.db'),
    artifactsDir: resolve(dataDir, 'artifacts'),
    webDistDir: env.FLOWCHECK_SERVE_WEB === '0' ? undefined : resolve(import.meta.dirname, '../../web/dist'),
    allowedHosts: hosts,
    allowedOrigins: hosts.map((h) => `http://${h}`),
    retention: {
      maxAgeMs: positive(env.FLOWCHECK_ARTIFACT_RETENTION_DAYS, 30) * 24 * 60 * 60 * 1000,
      projectQuotaBytes: positive(env.FLOWCHECK_ARTIFACT_QUOTA_MB, 500) * 1024 * 1024,
    },
  };
}

/** A positive number from the environment, or the default (invalid values are not guessed at). */
function positive(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Expected a positive number, got "${raw}"`);
  return value;
}
