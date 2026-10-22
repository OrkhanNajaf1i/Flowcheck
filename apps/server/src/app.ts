import helmet from '@fastify/helmet';
import type { FlowDb } from '@flowcheck/db';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { registerAccess } from './access.ts';
import type { ServerConfig } from './config.ts';
import { registerErrorHandling } from './errors.ts';
import { apiRoutes } from './routes.ts';
import { registerLocalSecurity } from './security.ts';
import { registerWebUi } from './web-ui.ts';

/** `accessToken`: the local access token (PROJECT_RULES §17); every /api request needs its session cookie. */
export async function buildServer(
  db: FlowDb,
  config: ServerConfig,
  options: { accessToken: string; logger?: boolean },
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  registerLocalSecurity(app, config);
  registerAccess(app, config, options.accessToken);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // Monaco and Radix set inline styles.
        styleSrc: ["'self'", "'unsafe-inline'"],
        // Monaco editor workers are loaded from blob: URLs.
        workerSrc: ["'self'", 'blob:'],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-origin' },
  });

  const servesUi = await registerWebUi(app, config.webDistDir);
  registerErrorHandling(app, { spaFallback: servesUi });
  await app.register(apiRoutes(db, config), { prefix: '/api' });
  return app;
}
