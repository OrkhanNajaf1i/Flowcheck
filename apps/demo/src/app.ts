import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';

/**
 * Local demo shop used as a deterministic test target. Not production code.
 * Bug modes are controlled only through this app's own config (env or loopback endpoint).
 */

export const BUG_MODES = ['success', 'create-order-500', 'ui-success-but-no-order', 'cart-not-cleared'] as const;
export type BugMode = (typeof BUG_MODES)[number];

interface Product {
  id: string;
  name: string;
  price: number;
}

interface CartItem {
  productId: string;
  quantity: number;
}

interface Order {
  id: string;
  items: (CartItem & { name: string; price: number })[];
  total: number;
  status: 'created';
  createdAt: string;
}

const PRODUCTS: readonly Product[] = [
  { id: 'p-1', name: 'Blue Mug', price: 12 },
  { id: 'p-2', name: 'Green Notebook', price: 7 },
  { id: 'p-3', name: 'Red Pen', price: 2 },
];

const PAGES = {
  '/': 'index.html',
  '/cart': 'cart.html',
  '/order': 'order.html',
  '/form': 'form.html',
  '/done': 'done.html',
  '/login': 'login.html',
  '/account': 'account.html',
  '/spa': 'spa.html',
  '/spa/settings': 'spa.html',
  '/sw': 'sw.html',
} as const;

const SESSION_COOKIE = 'demo_session';
const AUTH_COOKIE = 'demo_auth';
/** The only accepted demo password (any user name). */
export const DEMO_PASSWORD = 'demo-password';

export function buildDemoApp(options: { bugMode?: BugMode } = {}): FastifyInstance & { bugMode: () => BugMode } {
  let bugMode: BugMode = options.bugMode ?? 'success';
  const carts = new Map<string, CartItem[]>();
  const orders = new Map<string, Order>();

  const app = Fastify({ logger: false });
  void app.register(cookie);

  const pageHtml = new Map(
    Object.entries(PAGES).map(([path, file]) => [path, readFileSync(new URL(`../public/${file}`, import.meta.url), 'utf8')]),
  );
  const serviceWorker = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  for (const path of Object.keys(PAGES)) {
    app.get(path, async (_req, reply) => reply.type('text/html; charset=utf-8').send(pageHtml.get(path)));
  }

  function sessionCart(req: FastifyRequest, reply: FastifyReply): CartItem[] {
    let sid = req.cookies[SESSION_COOKIE];
    if (!sid || !carts.has(sid)) {
      sid = randomBytes(16).toString('hex');
      carts.set(sid, []);
      reply.setCookie(SESSION_COOKIE, sid, { path: '/', httpOnly: true, sameSite: 'lax' });
    }
    return carts.get(sid) as CartItem[];
  }

  app.get('/api/products', async () => PRODUCTS);

  app.get('/api/cart', async (req, reply) => ({ items: sessionCart(req, reply) }));

  app.post<{ Body: { productId?: unknown; quantity?: unknown } }>('/api/cart/items', async (req, reply) => {
    const { productId, quantity = 1 } = req.body ?? {};
    const product = PRODUCTS.find((p) => p.id === productId);
    if (!product || typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1) {
      return reply.code(400).send({ error: 'invalid_item' });
    }
    const cart = sessionCart(req, reply);
    const existing = cart.find((item) => item.productId === product.id);
    if (existing) existing.quantity += quantity;
    else cart.push({ productId: product.id, quantity });
    return reply.code(201).send({ items: cart });
  });

  app.delete('/api/cart', async (req, reply) => {
    sessionCart(req, reply).length = 0;
    return reply.code(204).send();
  });

  app.post('/api/orders', async (req, reply) => {
    const cart = sessionCart(req, reply);
    if (cart.length === 0) return reply.code(400).send({ error: 'cart_empty' });
    if (bugMode === 'create-order-500') return reply.code(500).send({ error: 'internal_error' });
    const items = cart.map((item) => {
      const product = PRODUCTS.find((p) => p.id === item.productId) as Product;
      return { ...item, name: product.name, price: product.price };
    });
    const order: Order = {
      id: randomUUID(),
      items,
      total: items.reduce((sum, item) => sum + item.price * item.quantity, 0),
      status: 'created',
      createdAt: new Date().toISOString(),
    };
    // Bug: claims success but never stores the order.
    if (bugMode !== 'ui-success-but-no-order') orders.set(order.id, order);
    // Bug: order is created but the cart keeps its items.
    if (bugMode !== 'cart-not-cleared') cart.length = 0;
    return reply.code(201).send(order);
  });

  app.get<{ Params: { id: string } }>('/api/orders/:id', async (req, reply) => {
    const order = orders.get(req.params.id);
    return order ? order : reply.code(404).send({ error: 'not_found' });
  });

  app.delete<{ Params: { id: string } }>('/api/orders/:id', async (req, reply) => {
    return orders.delete(req.params.id) ? reply.code(204).send() : reply.code(404).send({ error: 'not_found' });
  });

  app.get('/api/admin-only', async (_req, reply) => reply.code(403).send({ error: 'forbidden' }));

  // ---- Login (cookie session), used for login-session tests ----
  const logins = new Map<string, string>();
  const startLogin = (reply: FastifyReply, username: string) => {
    const token = randomBytes(16).toString('hex');
    logins.set(token, username);
    reply.setCookie(AUTH_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax' });
  };
  app.post<{ Body: { username?: unknown; password?: unknown } }>('/api/login', async (req, reply) => {
    const { username, password } = req.body ?? {};
    if (typeof username !== 'string' || !username || password !== DEMO_PASSWORD) {
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    startLogin(reply, username);
    return { username };
  });
  app.get('/api/me', async (req, reply) => {
    const username = logins.get(req.cookies[AUTH_COOKIE] ?? '');
    return username ? { username } : reply.code(401).send({ error: 'not_signed_in' });
  });
  // Test helper: lets an automated capture browser "log in" without a human.
  app.get<{ Params: { user: string } }>('/auto-login/:user', async (req, reply) => {
    startLogin(reply, req.params.user);
    return reply.redirect('/account');
  });

  app.get('/sw.js', async (_req, reply) => reply.type('text/javascript; charset=utf-8').send(serviceWorker));

  // Redirects to the same server under another origin (localhost instead of 127.0.0.1), which a
  // test environment does not allow; /__demo/hits shows whether the target was ever reached.
  let hits = 0;
  const redirectAway = async (req: FastifyRequest, reply: FastifyReply) => {
    const port = (req.headers.host ?? '').split(':')[1] ?? '80';
    return reply.redirect(`http://localhost:${port}/__demo/hit`, 302);
  };
  app.get('/redirect-away', redirectAway);
  // Allowed chains: same origin, and a chain whose second hop leaves the allowlist.
  app.get('/redirect-home', async (_req, reply) => reply.redirect('/form', 302));
  app.get('/redirect-twice', async (_req, reply) => reply.redirect('/redirect-away', 302));
  app.get('/api/redirect-away', redirectAway);
  app.get('/__demo/hit', async () => {
    hits += 1;
    return { hits };
  });
  app.get('/__demo/hits', async () => ({ hits }));

  // Demo control endpoints, loopback only.
  app.get('/__demo/mode', async () => ({ mode: bugMode }));
  app.post<{ Body: { mode?: unknown } }>('/__demo/mode', async (req, reply) => {
    if (!isLoopback(req.ip)) return reply.code(403).send({ error: 'loopback_only' });
    const mode = req.body?.mode;
    if (!BUG_MODES.includes(mode as BugMode)) return reply.code(400).send({ error: 'invalid_mode', allowed: BUG_MODES });
    bugMode = mode as BugMode;
    return { mode: bugMode };
  });
  app.post('/__demo/reset', async (req, reply) => {
    if (!isLoopback(req.ip)) return reply.code(403).send({ error: 'loopback_only' });
    carts.clear();
    orders.clear();
    hits = 0;
    bugMode = options.bugMode ?? 'success';
    return { mode: bugMode };
  });

  return Object.assign(app, { bugMode: () => bugMode });
}

function isLoopback(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

export function parseBugMode(value: string | undefined): BugMode {
  if (value === undefined || value === '') return 'success';
  if (!BUG_MODES.includes(value as BugMode)) {
    throw new Error(`DEMO_BUG_MODE must be one of ${BUG_MODES.join(', ')}; got "${value}"`);
  }
  return value as BugMode;
}
