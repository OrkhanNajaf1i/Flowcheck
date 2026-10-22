import { describe, expect, it } from 'vitest';
import { requestMatches, resolveNetworkOrigin } from '../src/network.ts';
import { extractOutputs } from '../src/outputs.ts';

const env = { apiBaseUrl: 'https://api.shop.test/v1', frontendBaseUrl: 'https://shop.test' };
const matcher = { origin: 'https://api.shop.test', method: 'POST', pathname: '/v1/orders', query: {} };

describe('network matcher', () => {
  it('resolves origins from the environment or takes an explicit one', () => {
    expect(resolveNetworkOrigin('api', env)).toBe('https://api.shop.test');
    expect(resolveNetworkOrigin('frontend', env)).toBe('https://shop.test');
    expect(resolveNetworkOrigin('https://cdn.shop.test', env)).toBe('https://cdn.shop.test');
  });

  it('matches origin, method and exact pathname, never status', () => {
    expect(requestMatches('https://api.shop.test/v1/orders', 'post', matcher)).toBe(true);
    expect(requestMatches('https://api.shop.test/v1/orders?x=1', 'POST', matcher)).toBe(true);
    expect(requestMatches('https://api.shop.test/v1/orders/', 'POST', matcher)).toBe(false);
    expect(requestMatches('https://api.shop.test/v1/orders/1', 'POST', matcher)).toBe(false);
    expect(requestMatches('https://api.shop.test/v1/orders', 'GET', matcher)).toBe(false);
    expect(requestMatches('https://evil.test/v1/orders', 'POST', matcher)).toBe(false);
  });

  it('requires the selected query parameters', () => {
    const withQuery = { ...matcher, query: { draft: 'false' } };
    expect(requestMatches('https://api.shop.test/v1/orders?draft=false&x=1', 'POST', withQuery)).toBe(true);
    expect(requestMatches('https://api.shop.test/v1/orders?draft=true', 'POST', withQuery)).toBe(false);
    expect(requestMatches('https://api.shop.test/v1/orders', 'POST', withQuery)).toBe(false);
  });
});

describe('extractOutputs', () => {
  const json = (body: unknown, headers: Record<string, string> = {}) => ({
    status: 201,
    headers: { 'content-type': 'application/json', ...headers },
    body: Buffer.from(JSON.stringify(body)),
  });

  it('reads primitives from JSON and headers', () => {
    expect(
      extractOutputs(
        [
          { name: 'id', from: 'json', pointer: '/id' },
          { name: 'total', from: 'json', pointer: '/total' },
          { name: 'loc', from: 'header', header: 'Location' },
        ],
        json({ id: 'o-1', total: 12 }, { location: '/orders/o-1' }),
      ),
    ).toEqual({ id: 'o-1', total: 12, loc: '/orders/o-1' });
  });

  it('fails clearly for missing values, objects and non-JSON bodies', () => {
    expect(() => extractOutputs([{ name: 'id', from: 'json', pointer: '/id' }], json({}))).toThrow(
      expect.objectContaining({ code: 'ASSERTION_FAILED' }),
    );
    expect(() => extractOutputs([{ name: 'items', from: 'json', pointer: '/items' }], json({ items: [1] }))).toThrow(/an array/);
    expect(() =>
      extractOutputs([{ name: 'id', from: 'json', pointer: '/id' }], {
        status: 200,
        headers: { 'content-type': 'text/html' },
        body: Buffer.from('<p>'),
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_RESPONSE_FORMAT' }));
  });
});
