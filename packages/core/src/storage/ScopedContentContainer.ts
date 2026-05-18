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

/** Normalize a prefix: strip leading/trailing slashes, ensure no `..` segments. */
function normalizePrefix(prefix: string): string {
  let p = prefix.trim();
  while (p.startsWith('/')) p = p.slice(1);
  while (p.endsWith('/')) p = p.slice(0, -1);
  if (p.length === 0) {
    throw new Error('ScopedContentContainer: prefix must not be empty');
  }
  if (p.split('/').some((seg) => seg === '..' || seg === '.')) {
    throw new Error(
      `ScopedContentContainer: prefix must not contain '.' or '..' segments: ${prefix}`,
    );
  }
  return p;
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

  constructor(parent: ContentContainer, prefix: string) {
    this.parent = parent;
    this.prefix = normalizePrefix(prefix);
    this.prefixSlash = `${this.prefix}/`;
  }

  private toParent(path: string): string {
    let p = path;
    while (p.startsWith('/')) p = p.slice(1);
    return this.prefixSlash + p;
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
    const parentPrefix = prefix ? this.toParent(prefix) : this.prefixSlash;
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
