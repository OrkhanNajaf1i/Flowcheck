import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { connect, type Socket } from 'node:net';
import { type EnvironmentSnapshot, type ErrorCode, effectiveAllowedOrigins } from '@flowcheck/shared';
import type { BrowserContext } from 'playwright';
import { StepError } from './errors.ts';
import { allowedAddresses, type TargetPolicy } from './url-policy.ts';

export interface BlockedRequest {
  url: string;
  code: ErrorCode;
  reason: string;
  at: number;
}

export interface TargetGuard {
  /** Everything the guard refused, in order; shown as step evidence. */
  blocked: BlockedRequest[];
  /** Pass to browser.newContext(): sends all browser traffic of the context through the guard. */
  contextOptions: { proxy: { server: string; bypass: string } };
  /** Adds the request-level check to the context (clear errors for the first request of a chain). */
  install(context: BrowserContext): Promise<void>;
  close(): Promise<void>;
}

export function targetPolicy(
  environment: Pick<EnvironmentSnapshot, 'frontendBaseUrl' | 'apiBaseUrl' | 'allowedOrigins' | 'allowPrivateNetwork'>,
): TargetPolicy {
  return { allowedOrigins: effectiveAllowedOrigins(environment), allowPrivateNetwork: environment.allowPrivateNetwork };
}

const HOP_BY_HOP = new Set(['proxy-connection', 'proxy-authorization', 'connection', 'keep-alive']);

/**
 * Enforces the target policy (PROJECT_RULES §17) on every request a test browser makes.
 *
 * Two layers:
 * - A local proxy that all browser traffic of the context goes through, including loopback and
 *   every redirect hop (Playwright's route handler sees only the first URL of a redirect chain).
 *   It checks origin and resolved IPs and then connects to the checked IP itself, so DNS cannot
 *   change between the check and the connection.
 * - A route handler for the first request of each chain, which aborts with a clear
 *   "blocked by client" error before anything leaves the browser.
 * Service workers are blocked at context creation, so they cannot bypass either layer.
 */
export async function startTargetGuard(policy: TargetPolicy): Promise<TargetGuard> {
  const blocked: BlockedRequest[] = [];
  const block = (url: string, error: { code: ErrorCode; message: string }, prefix = '') =>
    blocked.push({ url, code: error.code, reason: `${prefix}${error.message}`, at: Date.now() });

  /** One DNS answer per host for the guard's lifetime (one run): checks and connections agree. */
  const hostVerdicts = new Map<string, Promise<{ address: string } | { error: StepError }>>();

  /** Checked address to connect to, or the reason the target is refused. */
  async function check(url: URL): Promise<{ address: string } | { error: StepError }> {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { error: new StepError('ORIGIN_NOT_ALLOWED', `Scheme ${url.protocol} is not allowed`) };
    }
    if (!policy.allowedOrigins.includes(url.origin)) {
      return { error: new StepError('ORIGIN_NOT_ALLOWED', `Origin ${url.origin} is not allowed`) };
    }
    let verdict = hostVerdicts.get(url.hostname);
    if (verdict === undefined) {
      verdict = allowedAddresses(url, policy).then(
        ([address]) => (address ? { address } : { error: new StepError('NETWORK_ERROR', `Host ${url.hostname} did not resolve`) }),
        (error: unknown) => ({ error: error instanceof StepError ? error : new StepError('INTERNAL_ERROR', String(error)) }),
      );
      hostVerdicts.set(url.hostname, verdict);
    }
    return verdict;
  }

  // ---- Proxy ----

  const sockets = new Set<Socket>();
  const track = (socket: Socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  };

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    let url: URL;
    try {
      url = new URL(req.url ?? '');
    } catch {
      res.writeHead(400).end();
      return;
    }
    const verdict = await check(url);
    if ('error' in verdict) {
      block(url.href, verdict.error, 'Proxy: ');
      // No response page: the browser sees a failed request, never content from a refused target.
      req.socket.destroy();
      return;
    }
    const headers = Object.fromEntries(Object.entries(req.headers).filter(([name]) => !HOP_BY_HOP.has(name)));
    const upstream = httpRequest(
      {
        host: verdict.address,
        port: url.port || 80,
        method: req.method,
        path: `${url.pathname}${url.search}`,
        headers,
        setHost: false,
      },
      (response) => {
        const raw: string[] = [];
        for (let i = 0; i < response.rawHeaders.length; i += 2) {
          const name = response.rawHeaders[i] ?? '';
          if (!HOP_BY_HOP.has(name.toLowerCase())) raw.push(name, response.rawHeaders[i + 1] ?? '');
        }
        res.writeHead(response.statusCode ?? 502, response.statusMessage, raw);
        response.pipe(res);
      },
    );
    upstream.on('error', () => req.socket.destroy());
    req.pipe(upstream);
  });

  // HTTPS and secure WebSockets: CONNECT host:port. The scheme is not visible, so either
  // https:// or http:// at that host:port must be allowed.
  server.on('connect', async (req: IncomingMessage, client: Socket, head: Buffer) => {
    track(client);
    const target = req.url ?? '';
    let verdict: Awaited<ReturnType<typeof check>> = { error: new StepError('ORIGIN_NOT_ALLOWED', `Invalid tunnel target ${target}`) };
    let shown = target;
    for (const scheme of ['https:', 'http:']) {
      try {
        const url = new URL(`${scheme}//${target}`);
        shown = url.origin;
        verdict = await check(url);
        if (!('error' in verdict)) break;
      } catch {
        // invalid host:port; keep the error
      }
    }
    if ('error' in verdict) {
      block(shown, verdict.error, 'Proxy: ');
      client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    const port = Number(target.slice(target.lastIndexOf(':') + 1)) || 443;
    const upstream = connect(port, verdict.address, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    track(upstream);
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
  });

  // Plain ws:// upgrades sent to the proxy in absolute form.
  server.on('upgrade', async (req: IncomingMessage, client: Socket, head: Buffer) => {
    track(client);
    let url: URL;
    try {
      url = new URL(req.url ?? '');
    } catch {
      client.destroy();
      return;
    }
    const verdict = await check(new URL(`http://${url.host}`));
    if ('error' in verdict) {
      block(url.href, verdict.error, 'Proxy: ');
      client.destroy();
      return;
    }
    const upstream = connect(Number(url.port) || 80, verdict.address, () => {
      const lines = [`${req.method} ${url.pathname}${url.search} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const name = req.rawHeaders[i] ?? '';
        if (!['proxy-connection', 'proxy-authorization'].includes(name.toLowerCase()))
          lines.push(`${name}: ${req.rawHeaders[i + 1] ?? ''}`);
      }
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head.length > 0) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    track(upstream);
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
  });
  server.on('connection', track);

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };

  return {
    blocked,
    // "<-loopback>" removes Chromium's implicit bypass for localhost/127.0.0.1: those go through the proxy too.
    contextOptions: { proxy: { server: `http://127.0.0.1:${port}`, bypass: '<-loopback>' } },
    async install(context) {
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        const verdict = await check(url);
        if ('error' in verdict) {
          block(url.href, verdict.error);
          return route.abort('blockedbyclient');
        }
        return route.continue();
      });
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
