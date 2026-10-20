import type { FastifyInstance } from 'fastify';
import type { ServerConfig } from './config.ts';
import { errorBody } from './errors.ts';

const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Local-server hardening (PROJECT_RULES §17). Being on loopback is not treated as safe:
 * - Host header must be a known loopback host:port (blocks DNS rebinding).
 * - State-changing requests must carry an Origin from the app itself (blocks cross-site
 *   requests from any page the user has open). Requests without Origin are rejected too.
 * - No CORS headers are ever sent.
 */
export function registerLocalSecurity(app: FastifyInstance, config: ServerConfig): void {
  app.addHook('onRequest', async (request, reply) => {
    const host = request.headers.host;
    if (host === undefined || !config.allowedHosts.includes(host.toLowerCase())) {
      return reply.code(403).send(errorBody('HOST_NOT_ALLOWED', 'Host header is not allowed'));
    }
    if (!SAFE_METHODS.has(request.method)) {
      const origin = request.headers.origin;
      if (origin === undefined || !config.allowedOrigins.includes(origin.toLowerCase())) {
        return reply.code(403).send(errorBody('FORBIDDEN_ORIGIN', 'State-changing requests must come from the FlowCheck UI'));
      }
    }
  });
}
