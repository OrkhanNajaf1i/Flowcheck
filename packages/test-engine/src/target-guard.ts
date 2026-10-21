import type { ErrorCode } from '@flowcheck/shared';
import type { BrowserContext } from 'playwright';
import { StepError } from './errors.ts';
import { assertHostAllowed, type TargetPolicy } from './url-policy.ts';

export interface BlockedRequest {
  url: string;
  code: ErrorCode;
  reason: string;
  at: number;
}

/**
 * Enforces the target policy on every browser request (main document, subresources, redirects —
 * each redirect hop is a new routed request). Service workers are blocked at context creation,
 * so they cannot bypass this route.
 */
export async function installTargetGuard(context: BrowserContext, policy: TargetPolicy): Promise<BlockedRequest[]> {
  const blocked: BlockedRequest[] = [];
  const hostVerdicts = new Map<string, Promise<StepError | null>>();

  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      blocked.push({ url: url.href, code: 'ORIGIN_NOT_ALLOWED', reason: `Scheme ${url.protocol} is not allowed`, at: Date.now() });
      return route.abort('blockedbyclient');
    }
    if (!policy.allowedOrigins.includes(url.origin)) {
      blocked.push({ url: url.href, code: 'ORIGIN_NOT_ALLOWED', reason: `Origin ${url.origin} is not allowed`, at: Date.now() });
      return route.abort('blockedbyclient');
    }
    let verdict = hostVerdicts.get(url.hostname);
    if (verdict === undefined) {
      verdict = assertHostAllowed(url, policy).then(
        () => null,
        (error: unknown) => (error instanceof StepError ? error : new StepError('INTERNAL_ERROR', String(error))),
      );
      hostVerdicts.set(url.hostname, verdict);
    }
    const error = await verdict;
    if (error) {
      blocked.push({ url: url.href, code: error.code, reason: error.message, at: Date.now() });
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });

  return blocked;
}
