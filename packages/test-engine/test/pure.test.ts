import { describe, expect, it } from 'vitest';
import { strictJsonEquals } from '../src/compare.ts';
import { getByPointer, parsePointer } from '../src/json-pointer.ts';
import { redactHeaders, redactText, toPersistedBody } from '../src/redact.ts';
import { evaluateResponseAssertions } from '../src/response-assertions.ts';
import { computeRunStatus, effectiveRunTimeout, effectiveStepTimeout } from '../src/status.ts';
import { normalizeText, textMatches, urlMatches } from '../src/ui-steps.ts';
import { assertHostAllowed, assertOriginAllowed, buildApiUrl, classifyIp } from '../src/url-policy.ts';
import { resolveJson, resolveTemplate, VariableScope } from '../src/variables.ts';

describe('JSON Pointer (RFC 6901)', () => {
  const doc = { id: 7, 'a/b': 1, 'm~n': 2, items: [{ sku: 'x' }], nothing: null, '': 'empty-key' };

  it('reads root, properties, arrays and escaped keys', () => {
    expect(getByPointer(doc, '')).toEqual({ found: true, value: doc });
    expect(getByPointer(doc, '/id')).toEqual({ found: true, value: 7 });
    expect(getByPointer(doc, '/items/0/sku')).toEqual({ found: true, value: 'x' });
    expect(getByPointer(doc, '/a~1b')).toEqual({ found: true, value: 1 });
    expect(getByPointer(doc, '/m~0n')).toEqual({ found: true, value: 2 });
    expect(getByPointer(doc, '/')).toEqual({ found: true, value: 'empty-key' });
  });

  it('unescapes ~1 before ~0', () => {
    expect(parsePointer('/~01')).toEqual(['~1']);
  });

  it('distinguishes null from missing', () => {
    expect(getByPointer(doc, '/nothing')).toEqual({ found: true, value: null });
    expect(getByPointer(doc, '/missing').found).toBe(false);
  });

  it('rejects invalid array indexes and prototype access', () => {
    expect(getByPointer(doc, '/items/01').found).toBe(false);
    expect(getByPointer(doc, '/items/-').found).toBe(false);
    expect(getByPointer(doc, '/items/5').found).toBe(false);
    expect(getByPointer({}, '/__proto__').found).toBe(false);
    expect(getByPointer({}, '/constructor').found).toBe(false);
  });
});

describe('strictJsonEquals', () => {
  it('never coerces types', () => {
    expect(strictJsonEquals('1', 1)).toBe(false);
    expect(strictJsonEquals(null, undefined)).toBe(false);
    expect(strictJsonEquals(false, '')).toBe(false);
    expect(strictJsonEquals(0, false)).toBe(false);
    expect(strictJsonEquals([], {})).toBe(false);
  });

  it('compares objects deeply regardless of key order', () => {
    expect(strictJsonEquals({ a: 1, b: [1, { c: null }] }, { b: [1, { c: null }], a: 1 })).toBe(true);
    expect(strictJsonEquals({ a: 1 }, { a: 1, b: undefined })).toBe(false);
  });
});

describe('variable resolver', () => {
  const scope = new VariableScope();
  scope.set('inputs', 'count', 3);
  scope.set('inputs', 'email', 'qa@example.test');
  scope.set('run', 'id', 'run-1');

  it('keeps the primitive type for a single reference and stringifies interpolation', () => {
    expect(resolveTemplate('{{inputs.count}}', scope)).toBe(3);
    expect(resolveTemplate('n={{inputs.count}}', scope)).toBe('n=3');
    expect(resolveTemplate('{{ inputs.email }}', scope)).toBe('qa@example.test');
  });

  it('throws MISSING_VARIABLE instead of using an empty string', () => {
    expect(() => resolveTemplate('{{inputs.nope}}', scope)).toThrow(expect.objectContaining({ code: 'MISSING_VARIABLE' }));
  });

  it('cannot reach prototype properties', () => {
    expect(() => resolveTemplate('{{inputs.toString}}', scope)).toThrow(expect.objectContaining({ code: 'MISSING_VARIABLE' }));
  });

  it('resolves JSON leaves without templating keys', () => {
    expect(resolveJson({ '{{run.id}}': '{{run.id}}', n: ['{{inputs.count}}'] }, scope)).toEqual({ '{{run.id}}': 'run-1', n: [3] });
  });
});

describe('URL policy', () => {
  const policy = { allowedOrigins: ['http://127.0.0.1:4320'], allowPrivateNetwork: false };

  it('joins the base path instead of resolving', () => {
    expect(buildApiUrl('http://h.test/api', '/orders/1', { a: 'b' }).href).toBe('http://h.test/api/orders/1?a=b');
    expect(buildApiUrl('http://h.test/api/', '/orders').pathname).toBe('/api/orders');
  });

  it('rejects protocol-relative and traversal paths', () => {
    expect(() => buildApiUrl('http://h.test', '//evil.example/x')).toThrow(expect.objectContaining({ code: 'ORIGIN_NOT_ALLOWED' }));
    expect(() => buildApiUrl('http://h.test', '/\\evil.example')).toThrow(expect.objectContaining({ code: 'ORIGIN_NOT_ALLOWED' }));
    expect(() => buildApiUrl('http://h.test/api', '/../admin')).toThrow(expect.objectContaining({ code: 'ORIGIN_NOT_ALLOWED' }));
  });

  it('enforces the origin allowlist and scheme', () => {
    expect(() => assertOriginAllowed(new URL('http://127.0.0.1:4320/x'), policy)).not.toThrow();
    expect(() => assertOriginAllowed(new URL('http://127.0.0.1:9999/x'), policy)).toThrow(
      expect.objectContaining({ code: 'ORIGIN_NOT_ALLOWED' }),
    );
    expect(() => assertOriginAllowed(new URL('file:///etc/passwd'), policy)).toThrow(
      expect.objectContaining({ code: 'ORIGIN_NOT_ALLOWED' }),
    );
  });

  it('classifies IPv4, IPv6 and IPv4-mapped addresses', () => {
    expect(classifyIp('169.254.169.254')).toBe('metadata');
    expect(classifyIp('::ffff:169.254.169.254')).toBe('metadata');
    expect(classifyIp('fd00:ec2::254')).toBe('metadata');
    expect(classifyIp('127.0.0.1')).toBe('private');
    expect(classifyIp('10.1.2.3')).toBe('private');
    expect(classifyIp('172.16.0.1')).toBe('private');
    expect(classifyIp('192.168.1.1')).toBe('private');
    expect(classifyIp('169.254.1.1')).toBe('private');
    expect(classifyIp('100.64.0.1')).toBe('private');
    expect(classifyIp('::1')).toBe('private');
    expect(classifyIp('fe80::1')).toBe('private');
    expect(classifyIp('fc00::1')).toBe('private');
    expect(classifyIp('::ffff:127.0.0.1')).toBe('private');
    expect(classifyIp('8.8.8.8')).toBe('public');
  });

  it('blocks metadata even with allowPrivateNetwork, private only without it', async () => {
    const open = { ...policy, allowPrivateNetwork: true };
    await expect(assertHostAllowed(new URL('http://169.254.169.254/'), open)).rejects.toMatchObject({ code: 'SSRF_BLOCKED' });
    await expect(assertHostAllowed(new URL('http://metadata.google.internal/'), open)).rejects.toMatchObject({ code: 'SSRF_BLOCKED' });
    await expect(assertHostAllowed(new URL('http://127.0.0.1/'), policy)).rejects.toMatchObject({ code: 'SSRF_BLOCKED' });
    await expect(assertHostAllowed(new URL('http://127.0.0.1/'), open)).resolves.toBeUndefined();
  });

  it('checks every resolved IP (DNS rebinding)', async () => {
    const resolve = async () => ['8.8.8.8', '10.0.0.5'];
    await expect(assertHostAllowed(new URL('http://rebind.test/'), policy, resolve)).rejects.toMatchObject({ code: 'SSRF_BLOCKED' });
  });
});

describe('run status', () => {
  const s = (phase: 'setup' | 'main' | 'cleanup', status: 'passed' | 'failed' | 'error' | 'skipped' | 'pending') => ({ phase, status });

  it('applies priority cancelled > interrupted > error > failed > passed', () => {
    const failing = [s('main', 'failed'), s('main', 'error')];
    expect(computeRunStatus(failing, { cancelled: true, interrupted: true })).toBe('cancelled');
    expect(computeRunStatus(failing, { cancelled: false, interrupted: true })).toBe('interrupted');
    expect(computeRunStatus(failing, { cancelled: false, interrupted: false })).toBe('error');
    expect(computeRunStatus([s('main', 'failed'), s('main', 'skipped')], { cancelled: false, interrupted: false })).toBe('failed');
  });

  it('never reports passed for unexecuted or missing main steps', () => {
    const none = { cancelled: false, interrupted: false };
    expect(computeRunStatus([s('main', 'passed')], none)).toBe('passed');
    expect(computeRunStatus([s('main', 'passed'), s('main', 'pending')], none)).toBe('error');
    expect(computeRunStatus([s('main', 'skipped')], none)).toBe('error');
    expect(computeRunStatus([], none)).toBe('error');
  });

  it('lets a cleanup failure fail an otherwise passing run', () => {
    const none = { cancelled: false, interrupted: false };
    expect(computeRunStatus([s('main', 'passed'), s('cleanup', 'failed')], none)).toBe('failed');
    expect(computeRunStatus([s('main', 'passed'), s('cleanup', 'error')], none)).toBe('error');
    expect(computeRunStatus([s('main', 'passed'), s('cleanup', 'skipped')], none)).toBe('passed');
  });

  it('resolves the timeout hierarchy', () => {
    expect(effectiveStepTimeout({ timeoutMs: 5000 }, { defaultTimeoutMs: 10000 })).toBe(5000);
    expect(effectiveStepTimeout({}, { defaultTimeoutMs: 10000 })).toBe(10000);
    expect(effectiveStepTimeout({}, {})).toBe(30000);
    expect(effectiveRunTimeout({})).toBe(300000);
  });
});

describe('response assertions', () => {
  const scope = new VariableScope();
  const json = (body: unknown, status = 200) => ({
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: Buffer.from(JSON.stringify(body)),
  });

  it('treats 4xx as a normal response that can pass', () => {
    const [result] = evaluateResponseAssertions([{ kind: 'statusEquals', expected: 403 }], json({}, 403), scope);
    expect(result?.passed).toBe(true);
  });

  it('reports INVALID_RESPONSE_FORMAT for JSON assertions on non-JSON bodies', () => {
    const response = { status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from('<p>hi</p>') };
    const [result] = evaluateResponseAssertions([{ kind: 'jsonExists', pointer: '/id' }], response, scope);
    expect(result?.errorCode).toBe('INVALID_RESPONSE_FORMAT');
  });

  it('compares JSON values strictly', () => {
    const results = evaluateResponseAssertions(
      [
        { kind: 'jsonEquals', pointer: '/id', expected: '1' },
        { kind: 'jsonType', pointer: '/id', expected: 'number' },
        { kind: 'jsonArrayLength', pointer: '/items', expected: 2 },
      ],
      json({ id: 1, items: [1, 2] }),
      scope,
    );
    expect(results.map((r) => r.passed)).toEqual([false, true, true]);
  });
});

describe('redaction', () => {
  it('redacts sensitive headers and known secret values in several encodings', () => {
    expect(redactHeaders({ Authorization: 'Bearer x', 'X-Other': 'tok-12345678' }, ['tok-12345678'])).toEqual({
      Authorization: '[REDACTED]',
      'X-Other': '[REDACTED]',
    });
    expect(redactText(`a=${encodeURIComponent('p@ss word!')}`, ['p@ss word!'])).toBe('a=[REDACTED]');
    expect(redactText(Buffer.from('supersecret').toString('base64'), ['supersecret'])).toBe('[REDACTED]');
  });

  it('truncates large bodies and does not store binary bodies', () => {
    const big = toPersistedBody(Buffer.alloc(300 * 1024, 'a'), 'text/plain', []);
    expect(big.truncated).toBe(true);
    expect(big.text?.length).toBe(256 * 1024);
    expect(toPersistedBody(Buffer.from([1, 2, 3]), 'image/png', [])).toEqual({ kind: 'binary', size: 3, truncated: true });
  });
});

describe('text and URL matching', () => {
  it('normalizes whitespace only when asked and keeps empty text distinct', () => {
    expect(normalizeText('  Hello \n  world ', true)).toBe('Hello world');
    expect(normalizeText('  Hello \n  world ', false)).toBe('  Hello \n  world ');
    expect(textMatches('', '', 'exact')).toBe(true);
    expect(textMatches('', 'x', 'contains')).toBe(false);
    expect(textMatches('Thanks, Orkhan!', 'Thanks', 'exact')).toBe(false);
    expect(textMatches('Thanks, Orkhan!', 'Thanks', 'contains')).toBe(true);
  });

  it('compares pathname by default and ignores the hash', () => {
    expect(urlMatches('https://a.test/done?x=1#top', '/done', 'pathname', 'ignore')).toBe(true);
    expect(urlMatches('https://a.test/done/', '/done', 'pathname', 'ignore')).toBe(false);
  });

  it('compares query parameters as a set when included', () => {
    expect(urlMatches('https://a.test/done?b=2&a=1', '/done?a=1&b=2', 'pathname', 'include')).toBe(true);
    expect(urlMatches('https://a.test/done?a=1', '/done?a=1&b=2', 'pathname', 'include')).toBe(false);
  });

  it('checks the origin for full URL comparison', () => {
    expect(urlMatches('https://a.test/done', 'https://a.test/done', 'fullUrl', 'ignore')).toBe(true);
    expect(urlMatches('https://a.test/done', 'https://b.test/done', 'fullUrl', 'ignore')).toBe(false);
  });
});
