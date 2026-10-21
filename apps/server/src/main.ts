import { openDatabase } from '@flowcheck/db';
import { accessLink, loadAccessToken } from './access.ts';
import { buildServer } from './app.ts';
import { loadConfig } from './config.ts';
import { scheduleArtifactRetention } from './retention.ts';

const config = loadConfig();
const handle = openDatabase(config.dbFile);
const accessToken = loadAccessToken(config.dataDir);
const app = await buildServer(handle.db, config, { logger: true, accessToken });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    handle.close();
    process.exit(0);
  });
}

const stopRetention = scheduleArtifactRetention(handle.db, config, app.log);
app.addHook('onClose', async () => stopRetention());

// Loopback only. FlowCheck never listens on external interfaces.
await app.listen({ host: config.host, port: config.port });

// The UI port differs in dev mode (Vite proxies /api); scripts/run.ts passes it.
const uiPort = process.env.FLOWCHECK_UI_PORT ?? String(config.port);
console.log(`\nOpen FlowCheck: ${accessLink(`http://127.0.0.1:${uiPort}`, accessToken)}\n`);
