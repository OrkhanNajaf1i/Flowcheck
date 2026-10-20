import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

/**
 * Serves the built web UI (apps/web/dist) from the same origin as the API, so no CORS is needed.
 * Only used when the build exists (production-like start). In development Vite serves the UI.
 * Run artifacts are never served from here. The SPA fallback lives in the not-found handler.
 */
export async function registerWebUi(app: FastifyInstance, distDir: string | undefined): Promise<boolean> {
  if (distDir === undefined || !existsSync(distDir)) return false;
  await app.register(fastifyStatic, { root: distDir, prefix: '/', wildcard: false, index: ['index.html'] });
  return true;
}
