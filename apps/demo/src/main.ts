import { buildDemoApp, parseBugMode } from './app.ts';

const port = Number(process.env.DEMO_PORT ?? 4320);
const app = buildDemoApp({ bugMode: parseBugMode(process.env.DEMO_BUG_MODE) });
await app.listen({ host: '127.0.0.1', port });
console.log(`Demo shop listening on http://127.0.0.1:${port} (bug mode: ${app.bugMode()})`);
