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
  };
}
