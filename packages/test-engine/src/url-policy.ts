import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { StepError } from './errors.ts';

/**
 * Target policy for everything a run touches (PROJECT_RULES §17).
 * Residual risk: Chromium and Playwright's request client resolve DNS themselves, so a host could
 * resolve differently between our check and the real connection (TOCTOU). This is documented,
 * not hidden.
 */

export interface TargetPolicy {
  allowedOrigins: readonly string[];
  allowPrivateNetwork: boolean;
}

/** Always blocked, even with allowPrivateNetwork. */
const METADATA_IPS: ReadonlySet<string> = new Set(['169.254.169.254', 'fd00:ec2::254', '100.100.100.200']);
const METADATA_HOSTNAMES: ReadonlySet<string> = new Set(['metadata.google.internal', 'metadata']);

/** ipaddr.js range names that count as non-public. */
const PRIVATE_RANGES: ReadonlySet<string> = new Set([
  'unspecified',
  'loopback',
  'private',
  'linkLocal',
  'carrierGradeNat',
  'uniqueLocal',
  'reserved',
  'broadcast',
  'multicast',
]);

export type IpClass = 'metadata' | 'private' | 'public';

export function classifyIp(address: string): IpClass {
  let parsed = ipaddr.parse(address);
  if (parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
    parsed = (parsed as ipaddr.IPv6).toIPv4Address();
  }
  const normalized = parsed.toNormalizedString();
  if (METADATA_IPS.has(normalized) || METADATA_IPS.has(parsed.toString())) return 'metadata';
  return PRIVATE_RANGES.has(parsed.range()) ? 'private' : 'public';
}

/** Throws ORIGIN_NOT_ALLOWED for non-http(s) URLs or origins outside the allowlist. */
export function assertOriginAllowed(url: URL, policy: TargetPolicy): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new StepError('ORIGIN_NOT_ALLOWED', `Only http and https targets are allowed, got ${url.protocol}`);
  }
  if (!policy.allowedOrigins.includes(url.origin)) {
    throw new StepError('ORIGIN_NOT_ALLOWED', `Origin ${url.origin} is not in this environment's allowed origins`, {
      origin: url.origin,
    });
  }
}

/** Resolves the host and checks every resulting IP (DNS-rebinding defence at check time). */
export async function assertHostAllowed(
  url: URL,
  policy: TargetPolicy,
  resolve: (host: string) => Promise<string[]> = defaultResolve,
): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (METADATA_HOSTNAMES.has(host)) {
    throw new StepError('SSRF_BLOCKED', `Host ${host} is a cloud metadata endpoint and is always blocked`);
  }
  const addresses = ipaddr.isValid(host) ? [host] : await resolve(host);
  if (addresses.length === 0) throw new StepError('NETWORK_ERROR', `Host ${host} did not resolve`);
  for (const address of addresses) {
    const cls = classifyIp(address);
    if (cls === 'metadata') {
      throw new StepError('SSRF_BLOCKED', `Host ${host} resolves to cloud metadata address ${address}`);
    }
    if (cls === 'private' && !policy.allowPrivateNetwork) {
      throw new StepError(
        'SSRF_BLOCKED',
        `Host ${host} resolves to non-public address ${address}; enable "Allow private network" on the environment to permit it`,
        { address },
      );
    }
  }
}

async function defaultResolve(host: string): Promise<string[]> {
  try {
    const results = await lookup(host, { all: true, verbatim: true });
    return results.map((r) => r.address);
  } catch (error) {
    throw new StepError('NETWORK_ERROR', `DNS lookup failed for ${host}: ${(error as Error).message}`);
  }
}

export async function assertTargetAllowed(url: URL, policy: TargetPolicy): Promise<void> {
  assertOriginAllowed(url, policy);
  await assertHostAllowed(url, policy);
}

/**
 * Joins apiBaseUrl's path with a step path by concatenation, not URL resolution, so a base of
 * https://api.example/v1 and "/orders" gives /v1/orders. Rejects anything that could change origin.
 */
export function buildApiUrl(apiBaseUrl: string, path: string, query: Record<string, string> = {}): URL {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
    throw new StepError('ORIGIN_NOT_ALLOWED', `API path must start with a single "/": ${path}`);
  }
  const base = new URL(apiBaseUrl);
  const [pathname = '', search] = splitOnce(path, '?');
  if (pathname.split('/').some((segment) => segment === '..' || segment === '.')) {
    throw new StepError('ORIGIN_NOT_ALLOWED', `API path must not contain "." or ".." segments: ${path}`);
  }
  const url = new URL(base.origin);
  url.pathname = base.pathname.replace(/\/+$/, '') + pathname;
  if (search !== undefined) url.search = search;
  for (const [key, value] of Object.entries(query)) url.searchParams.append(key, value);
  if (url.origin !== base.origin) throw new StepError('ORIGIN_NOT_ALLOWED', `API path escapes the API origin: ${path}`);
  return url;
}

/** Resolves a navigate target: "/path" against frontendBaseUrl, or an absolute http(s) URL. */
export function buildNavigateUrl(frontendBaseUrl: string, target: string): URL {
  if (target.startsWith('/') && !target.startsWith('//') && !target.includes('\\')) {
    const base = new URL(frontendBaseUrl);
    const url = new URL(base.pathname.replace(/\/+$/, '') + target, base.origin);
    if (url.origin !== base.origin) throw new StepError('ORIGIN_NOT_ALLOWED', `Path escapes the frontend origin: ${target}`);
    return url;
  }
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    throw new StepError('VALIDATION_ERROR', `Navigate target must be a path starting with "/" or an absolute URL: ${target}`);
  }
  return url;
}

function splitOnce(value: string, separator: string): [string, string | undefined] {
  const index = value.indexOf(separator);
  return index === -1 ? [value, undefined] : [value.slice(0, index), value.slice(index + 1)];
}
