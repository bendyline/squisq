/**
 * Caller-owned policy for resources referenced by a document.
 *
 * The core package deliberately does not decide whether a document is trusted.
 * Interactive hosts can keep the browser-compatible default, restrict remote
 * hosts, or provide a local-only policy. Headless/server callers should use the
 * local-only policy unless they have an explicit, audited allow-list.
 */
export interface ResourcePolicy {
  /** Permit http(s) and protocol-relative URLs. Default: true. */
  allowRemote?: boolean;
  /** Permit relative and root-relative URLs. Default: true. */
  allowRelative?: boolean;
  /** Permit blob: URLs. Default: true. */
  allowBlob?: boolean;
  /** Permit image/audio/video data: URLs. Default: true. */
  allowData?: boolean;
  /** Exact hosts or `*.example.com` suffixes allowed for remote URLs. */
  allowedHosts?: readonly string[];
  /** Maximum bytes read by one bounded fetch. Default: 64 MiB. */
  maxBytes?: number;
  /** Maximum time for one bounded fetch. Default: 15 seconds. */
  timeoutMs?: number;
}

export const DEFAULT_RESOURCE_MAX_BYTES = 64 * 1024 * 1024;
export const DEFAULT_RESOURCE_TIMEOUT_MS = 15_000;

export const DEFAULT_INTERACTIVE_RESOURCE_POLICY: Readonly<Required<ResourcePolicy>> =
  Object.freeze({
    allowRemote: true,
    allowRelative: true,
    allowBlob: true,
    allowData: true,
    allowedHosts: Object.freeze([]) as unknown as readonly string[],
    maxBytes: DEFAULT_RESOURCE_MAX_BYTES,
    timeoutMs: DEFAULT_RESOURCE_TIMEOUT_MS,
  });

export const LOCAL_ONLY_RESOURCE_POLICY: Readonly<Required<ResourcePolicy>> = Object.freeze({
  allowRemote: false,
  allowRelative: true,
  allowBlob: true,
  allowData: true,
  allowedHosts: Object.freeze([]) as unknown as readonly string[],
  maxBytes: DEFAULT_RESOURCE_MAX_BYTES,
  timeoutMs: DEFAULT_RESOURCE_TIMEOUT_MS,
});

export class ResourcePolicyError extends Error {
  readonly code: 'RESOURCE_BLOCKED' | 'RESOURCE_TOO_LARGE' | 'RESOURCE_TIMEOUT';

  constructor(code: ResourcePolicyError['code'], message: string) {
    super(message);
    this.name = 'ResourcePolicyError';
    this.code = code;
  }
}

export interface FetchResourceBytesOptions {
  policy?: ResourcePolicy;
  signal?: AbortSignal;
  /** Optional fetch implementation for tests or non-browser runtimes. */
  fetch?: typeof globalThis.fetch;
  /** Reject successful responses whose Content-Type does not match a prefix. */
  contentTypePrefixes?: readonly string[];
}

export interface FetchedResource {
  bytes: Uint8Array;
  contentType: string;
  finalUrl: string;
}

/** Return whether a document resource URL is admitted by a policy. */
export function isResourceUrlAllowed(
  input: string | null | undefined,
  policy: ResourcePolicy = DEFAULT_INTERACTIVE_RESOURCE_POLICY,
): boolean {
  if (typeof input !== 'string') return false;
  const value = input.trim();
  if (!value || hasUrlControlCharacters(value)) return false;

  const resolved = resolvePolicy(policy);
  if (value.startsWith('\\\\')) return false;
  if (value.startsWith('//')) {
    if (!resolved.allowRemote) return false;
    return hostAllowed(parseUrl(`https:${value}`), resolved.allowedHosts);
  }

  const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(value);
  if (!schemeMatch) return resolved.allowRelative;

  const scheme = schemeMatch[1].toLowerCase();
  if (scheme === 'blob') return resolved.allowBlob;
  if (scheme === 'data') return resolved.allowData && isSafeMediaDataUrl(value);
  if (scheme !== 'http' && scheme !== 'https') return false;
  if (!resolved.allowRemote) return false;
  return hostAllowed(parseUrl(value), resolved.allowedHosts);
}

/**
 * Fetch a document-controlled resource without buffering unbounded data.
 * Redirect destinations are revalidated after fetch follows them.
 */
export async function fetchResourceBytes(
  input: string,
  options: FetchResourceBytesOptions = {},
): Promise<FetchedResource> {
  const policy = resolvePolicy(options.policy);
  if (!isResourceUrlAllowed(input, policy)) {
    throw new ResourcePolicyError(
      'RESOURCE_BLOCKED',
      `Resource URL is blocked by policy: ${input}`,
    );
  }
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetchResourceBytes requires a fetch implementation');
  }

  const controller = new AbortController();
  let timedOut = false;
  const onAbort = (): void => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) onAbort();
  else options.signal?.addEventListener('abort', onAbort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, policy.timeoutMs);

  try {
    const response = await fetchImpl(input, {
      signal: controller.signal,
      credentials: 'omit',
      redirect: 'follow',
      referrerPolicy: 'no-referrer',
    });
    if (!response.ok) throw new Error(`Resource request failed with HTTP ${response.status}`);
    const finalUrl = response.url || input;
    if (!isResourceUrlAllowed(finalUrl, policy)) {
      throw new ResourcePolicyError(
        'RESOURCE_BLOCKED',
        `Resource redirect destination is blocked by policy: ${finalUrl}`,
      );
    }

    const contentType = response.headers?.get?.('content-type')?.split(';', 1)[0].trim() ?? '';
    if (
      contentType &&
      options.contentTypePrefixes?.length &&
      !options.contentTypePrefixes.some((prefix) => contentType.toLowerCase().startsWith(prefix))
    ) {
      throw new ResourcePolicyError(
        'RESOURCE_BLOCKED',
        `Resource Content-Type is not allowed: ${contentType || '(missing)'}`,
      );
    }

    const declaredLength = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > policy.maxBytes) {
      throw tooLarge(policy.maxBytes);
    }

    const bytes = await readResponseBounded(response, policy.maxBytes, controller.signal);
    return { bytes, contentType, finalUrl };
  } catch (error) {
    if (timedOut) {
      throw new ResourcePolicyError(
        'RESOURCE_TIMEOUT',
        `Resource request exceeded ${policy.timeoutMs} ms`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

function resolvePolicy(policy: ResourcePolicy | undefined): Required<ResourcePolicy> {
  return {
    ...DEFAULT_INTERACTIVE_RESOURCE_POLICY,
    ...policy,
    allowedHosts: policy?.allowedHosts ?? DEFAULT_INTERACTIVE_RESOURCE_POLICY.allowedHosts,
  };
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function hostAllowed(url: URL | null, allowedHosts: readonly string[]): boolean {
  if (!url || url.username || url.password) return false;
  if (allowedHosts.length === 0) return true;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  return allowedHosts.some((entry) => {
    const allowed = entry.trim().toLowerCase().replace(/\.$/, '');
    if (allowed.startsWith('*.')) {
      const suffix = allowed.slice(2);
      return host !== suffix && host.endsWith(`.${suffix}`);
    }
    return host === allowed;
  });
}

function isSafeMediaDataUrl(value: string): boolean {
  return /^data:(?:image\/(?!svg\+xml)[a-z0-9.+-]+|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+);/i.test(
    value,
  );
}

function hasUrlControlCharacters(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

async function readResponseBounded(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (!response.body) {
    const buffer = response.arrayBuffer
      ? await response.arrayBuffer()
      : await (await response.blob()).arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (bytes.byteLength > maxBytes) throw tooLarge(maxBytes);
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw tooLarge(maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function tooLarge(maxBytes: number): ResourcePolicyError {
  return new ResourcePolicyError(
    'RESOURCE_TOO_LARGE',
    `Resource exceeds the ${maxBytes}-byte policy limit`,
  );
}
