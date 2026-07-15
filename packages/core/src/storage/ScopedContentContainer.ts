/**
 * ScopedContentContainer
 *
 * Wraps a parent {@link ContentContainer} and prefixes every path with a
 * fixed subfolder, presenting that subfolder as the root. Useful for
 * sidecar folders (e.g. `<imagebasename>_files/`) where a component
 * should be able to read/write/list files relative to its own root
 * without knowing where it lives in the parent tree.
 *
 * Scopes nest: `scopeContainer(scopeContainer(parent, 'a'), 'b')` is
 * equivalent to `scopeContainer(parent, 'a/b')`.
 *
 * `getDocumentPath()` always returns `null` for scoped sidecars — they
 * are not document roots.
 */

import type { ContentContainer, ContentEntry } from './ContentContainer.js';

interface NormalizePathOptions {
  allowEmpty?: boolean;
  preserveTrailingSlash?: boolean;
}

/**
 * Normalize a container-relative path without ever resolving traversal.
 * Backslashes are rejected rather than translated because a filesystem-backed
 * parent may interpret them as separators even when an in-memory parent does
 * not. Dot segments are similarly rejected instead of collapsed so an invalid
 * caller path can never escape after a later platform-specific normalization.
 */
function normalizeRelativePath(
  path: string,
  label: 'prefix' | 'path',
  options: NormalizePathOptions = {},
): string {
  const original = path;
  let normalized = label === 'prefix' ? path.trim() : path;
  if (normalized.includes('\\')) {
    throw new Error(`ScopedContentContainer: ${label} must use forward slashes: ${original}`);
  }

  const hadTrailingSlash = normalized.endsWith('/');
  normalized = normalized.replace(/^\/+|\/+$/g, '');
  const segments = normalized === '' ? [] : normalized.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error(
      `ScopedContentContainer: ${label} must not contain '.' or '..' segments: ${original}`,
    );
  }
  if (segments.length === 0 && !options.allowEmpty) {
    throw new Error(`ScopedContentContainer: ${label} must not be empty`);
  }

  const result = segments.join('/');
  return options.preserveTrailingSlash && hadTrailingSlash && result ? `${result}/` : result;
}

/** Normalize a prefix: strip leading/trailing slashes, ensure no `..` segments. */
function normalizePrefix(prefix: string): string {
  return normalizeRelativePath(prefix, 'prefix');
}

/**
 * A ContentContainer view rooted at a subfolder of a parent container.
 * All paths passed to / returned from this container are relative to
 * the subfolder; the parent never sees an unprefixed path.
 */
export class ScopedContentContainer implements ContentContainer {
  private readonly parent: ContentContainer;
  /** Prefix without trailing slash. */
  readonly prefix: string;
  /** Prefix with trailing slash. */
  private readonly prefixSlash: string;
  readonly mutationLock: object;
  readonly writeFileExclusive?: (
    path: string,
    data: ArrayBuffer | Uint8Array,
    mimeType?: string,
  ) => Promise<boolean>;

  constructor(parent: ContentContainer, prefix: string) {
    this.parent = parent;
    this.prefix = normalizePrefix(prefix);
    this.prefixSlash = `${this.prefix}/`;
    this.mutationLock = parent.mutationLock ?? parent;
    if (parent.writeFileExclusive) {
      this.writeFileExclusive = (path, data, mimeType) =>
        parent.writeFileExclusive!(this.toParent(path), data, mimeType);
    }
  }

  private toParent(path: string, options: NormalizePathOptions = {}): string {
    const normalized = normalizeRelativePath(path, 'path', options);
    return this.prefixSlash + normalized;
  }

  /** Strip the prefix from a parent-space path. Returns null if the path is outside the scope. */
  private fromParent(parentPath: string): string | null {
    if (!parentPath.startsWith(this.prefixSlash)) return null;
    return parentPath.slice(this.prefixSlash.length);
  }

  readFile(path: string): Promise<ArrayBuffer | null> {
    return this.parent.readFile(this.toParent(path));
  }

  writeFile(path: string, data: ArrayBuffer | Uint8Array, mimeType?: string): Promise<void> {
    return this.parent.writeFile(this.toParent(path), data, mimeType);
  }

  removeFile(path: string): Promise<void> {
    return this.parent.removeFile(this.toParent(path));
  }

  async listFiles(prefix?: string): Promise<ContentEntry[]> {
    const parentPrefix =
      prefix == null
        ? this.prefixSlash
        : this.toParent(prefix, { allowEmpty: true, preserveTrailingSlash: true });
    const entries = await this.parent.listFiles(parentPrefix);
    const out: ContentEntry[] = [];
    for (const e of entries) {
      const local = this.fromParent(e.path);
      if (local === null) continue;
      out.push({ path: local, mimeType: e.mimeType, size: e.size });
    }
    return out;
  }

  exists(path: string): Promise<boolean> {
    return this.parent.exists(this.toParent(path));
  }

  /** Sidecars are not document roots. */
  async getDocumentPath(): Promise<string | null> {
    return null;
  }

  async readDocument(): Promise<string | null> {
    return null;
  }

  async writeDocument(): Promise<void> {
    throw new Error(
      'ScopedContentContainer is a sidecar view and does not support writeDocument(). ' +
        'Write to a specific path with writeFile() instead.',
    );
  }
}

/** Factory: convenience wrapper for `new ScopedContentContainer(parent, prefix)`. */
export function scopeContainer(parent: ContentContainer, prefix: string): ScopedContentContainer {
  return new ScopedContentContainer(parent, prefix);
}
