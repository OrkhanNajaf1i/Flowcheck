import { openDatabase } from '@flowcheck/db';
import { buildServer } from './app.ts';
import { loadConfig } from './config.ts';

const config = loadConfig();
const handle = openDatabase(config.dbFile);
const app = await buildServer(handle.db, config, { logger: true });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    handle.close();
    process.exit(0);
  });
}

// Loopback only. FlowCheck never listens on external interfaces.
await app.listen({ host: config.host, port: config.port });
