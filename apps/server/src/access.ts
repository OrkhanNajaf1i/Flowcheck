import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ServerConfig } from './config.ts';
import { errorBody } from './errors.ts';

/**
 * Local access token (PROJECT_RULES §17). Loopback is not treated as safe: any local process or
 * a page that gets past the Host/Origin checks could otherwise call the API. The server prints a
 * link with the token; opening it stores an HttpOnly, SameSite=Strict cookie, and every /api
 * request needs that cookie.
 */

const TOKEN_FILE = 'access.token';
const MIN_TOKEN_LENGTH = 32;
const COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60;
export const SESSION_PATH = '/api/session';

/** Token from FLOWCHECK_ACCESS_TOKEN, else data/access.token (created once; stays the same across restarts). */
export function loadAccessToken(dataDir: string, env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.FLOWCHECK_ACCESS_TOKEN;
  if (fromEnv !== undefined && fromEnv !== '') {
    if (fromEnv.length < MIN_TOKEN_LENGTH) throw new Error(`FLOWCHECK_ACCESS_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters`);
    return fromEnv;
  }
  const file = resolve(dataDir, TOKEN_FILE);
  if (existsSync(file)) {
    const token = readFileSync(file, 'utf8').trim();
    if (token.length >= MIN_TOKEN_LENGTH) return token;
  }
  const token = randomBytes(32).toString('base64url');
  // 0600 has no effect on Windows; data/ is protected by the user profile's NTFS permissions there.
  writeFileSync(file, `${token}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return token;
}

/** The cookie holds a value derived from the token, never the token itself. */
export function sessionValue(token: string): string {
  return createHmac('sha256', token).update('flowcheck-session').digest('base64url');
}

/** One cookie per server port, so two FlowCheck instances on 127.0.0.1 do not overwrite each other. */
export const sessionCookieName = (port: number) => `flowcheck_session_${port}`;

export function accessLink(baseUrl: string, token: string): string {
  return `${baseUrl}${SESSION_PATH}?token=${encodeURIComponent(token)}`;
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}

export function registerAccess(app: FastifyInstance, config: ServerConfig, token: string): void {
  const cookieName = sessionCookieName(config.port);
  const expected = sessionValue(token);

  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0] ?? '';
    if (!path.startsWith('/api/') || path === SESSION_PATH) return;
    const value = readCookie(request.headers.cookie, cookieName);
    if (value === undefined || !sameSecret(value, expected)) {
      return reply
        .code(401)
        .send(errorBody('UNAUTHORIZED', 'Open FlowCheck with the link printed in the terminal where FlowCheck was started (pnpm start).'));
    }
  });

  // Exchanges the token from the printed link for the cookie, then removes the token from the address bar.
  app.get(SESSION_PATH, { schema: { querystring: z.object({ token: z.string().max(200).optional() }) } }, async (request, reply) => {
    const given = (request.query as { token?: string }).token ?? '';
    if (!sameSecret(given, token)) {
      return reply.code(401).send(errorBody('UNAUTHORIZED', 'This link is not valid. Use the link printed in the terminal.'));
    }
    reply.header('set-cookie', `${cookieName}=${expected}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE_S}`);
    reply.header('cache-control', 'no-store');
    return reply.redirect('/', 302);
  });
}
