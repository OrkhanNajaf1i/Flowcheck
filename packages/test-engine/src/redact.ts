/**
 * Redaction of persisted evidence (PROJECT_RULES §11, §16).
 * This covers known header names and known secret values (plain, URL-encoded, base64).
 * It is not a guarantee: transformed or partial secrets can still leak, and screenshots/traces
 * are not redacted at all.
 */

export const REDACTED = '[REDACTED]';

export const SENSITIVE_HEADERS: ReadonlySet<string> = new Set(['authorization', 'proxy-authorization', 'cookie', 'set-cookie']);

export const PERSISTED_BODY_LIMIT_BYTES = 256 * 1024;
export const PARSE_BODY_LIMIT_BYTES = 1024 * 1024;

export function redactHeaders(headers: Record<string, string>, secrets: readonly string[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name] = SENSITIVE_HEADERS.has(name.toLowerCase()) ? REDACTED : redactText(value, secrets);
  }
  return out;
}

export function redactText(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length === 0) continue;
    for (const form of new Set([secret, encodeURIComponent(secret), Buffer.from(secret).toString('base64')])) {
      out = out.split(form).join(REDACTED);
    }
  }
  return out;
}

export interface PersistedBody {
  kind: 'text' | 'binary' | 'empty';
  text?: string;
  size: number;
  truncated: boolean;
}

const TEXT_CONTENT_TYPE = /^(text\/|application\/(json|[\w.+-]*\+json|xml|[\w.+-]*\+xml|x-www-form-urlencoded|javascript))/i;

/** Body as it may be stored: text only, at most 256 KB, secrets redacted. Binary bodies are not stored. */
export function toPersistedBody(body: Buffer, contentType: string | undefined, secrets: readonly string[]): PersistedBody {
  if (body.length === 0) return { kind: 'empty', size: 0, truncated: false };
  if (contentType !== undefined && !TEXT_CONTENT_TYPE.test(contentType)) {
    return { kind: 'binary', size: body.length, truncated: true };
  }
  const truncated = body.length > PERSISTED_BODY_LIMIT_BYTES;
  const text = body.subarray(0, PERSISTED_BODY_LIMIT_BYTES).toString('utf8');
  return { kind: 'text', text: redactText(text, secrets), size: body.length, truncated };
}

/** Deep-redacts string leaves of a JSON-like value. */
export function redactJson(value: unknown, secrets: readonly string[]): unknown {
  if (secrets.length === 0) return value;
  if (typeof value === 'string') return redactText(value, secrets);
  if (Array.isArray(value)) return value.map((item) => redactJson(item, secrets));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactJson(v, secrets)]));
  }
  return value;
}
