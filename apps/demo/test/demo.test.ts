import { afterEach, describe, expect, it } from 'vitest';
import { type BugMode, buildDemoApp } from '../src/app.ts';

let app: ReturnType<typeof buildDemoApp> | undefined;
afterEach(async () => {
  await app?.close();
});

async function placeOrder(mode: BugMode) {
  app = buildDemoApp({ bugMode: mode });
  const add = await app.inject({ method: 'POST', url: '/api/cart/items', payload: { productId: 'p-1', quantity: 1 } });
  const cookie = `demo_session=${add.cookies.find((c) => c.name === 'demo_session')?.value}`;
  const order = await app.inject({ method: 'POST', url: '/api/orders', headers: { cookie } });
  const cart = await app.inject({ method: 'GET', url: '/api/cart', headers: { cookie } });
  const id = order.statusCode === 201 ? order.json().id : 'none';
  const read = await app.inject({ method: 'GET', url: `/api/orders/${id}` });
  return { order, cart: cart.json().items, read };
}

describe('demo bug modes', () => {
  it('success: order stored, cart cleared', async () => {
    const { order, cart, read } = await placeOrder('success');
    expect(order.statusCode).toBe(201);
    expect(read.statusCode).toBe(200);
    expect(cart).toEqual([]);
  });

  it('create-order-500', async () => {
    const { order } = await placeOrder('create-order-500');
    expect(order.statusCode).toBe(500);
  });

  it('ui-success-but-no-order: 201 but not readable', async () => {
    const { order, read } = await placeOrder('ui-success-but-no-order');
    expect(order.statusCode).toBe(201);
    expect(read.statusCode).toBe(404);
  });

  it('cart-not-cleared', async () => {
    const { order, cart } = await placeOrder('cart-not-cleared');
    expect(order.statusCode).toBe(201);
    expect(cart).toHaveLength(1);
  });

  it('admin endpoint returns 403', async () => {
    app = buildDemoApp();
    expect((await app.inject({ method: 'GET', url: '/api/admin-only' })).statusCode).toBe(403);
  });
});
