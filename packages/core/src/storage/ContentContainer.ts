/**
 * ContentContainer — virtual file system for document containers.
 *
 * A Squisq document is more than just markdown: it's a container of files
 * including the primary markdown document, images, audio, timing data, and
 * other media. ContentContainer provides an abstract async file system
 * interface for reading, writing, and listing these files.
 *
 * Paths are forward-slash separated strings relative to the container root
 * (e.g., 'images/hero.jpg', 'index.md'). No leading slash.
 *
 * Implementations:
 * - MemoryContentContainer — in-memory Map (for zip import, tests, transient use)
 * - SlotContentContainer — backed by IndexedDB slot storage (in the site package)
 */

/**
 * Metadata about a file in a ContentContainer.
 */
export interface ContentEntry {
  /** Relative path within the container (e.g., 'images/hero.jpg') */
  path: string;
  /** MIME type (e.g., 'image/jpeg') */
  mimeType: string;
  /** File size in bytes */
  size: number;
}

/**
 * Abstract async file system for document containers.
 *
 * All paths are forward-slash separated, relative to the container root,
 * with no leading slash. Example: 'images/hero.jpg', 'index.md'.
 */
export interface ContentContainer {
  /** Read a file's binary content. Returns null if the file does not exist. */
  readFile(path: string): Promise<ArrayBuffer | null>;

  /** Write a file. Creates or overwrites. */
  writeFile(path: string, data: ArrayBuffer | Uint8Array, mimeType?: string): Promise<void>;

  /** Remove a file. No-op if the file does not exist. */
  removeFile(path: string): Promise<void>;

  /**
   * List files in the container.
   * @param prefix — Optional path prefix to filter by (e.g., 'images/')
   */
  listFiles(prefix?: string): Promise<ContentEntry[]>;

  /** Check whether a file exists. */
  exists(path: string): Promise<boolean>;

  /**
   * Find the primary markdown document path.
   *
   * Discovery order: index.md → doc.md → document.md → first *.md at root.
   * Returns null if no markdown file is found at the root level.
   */
  getDocumentPath(): Promise<string | null>;

  /**
   * Convenience: read the primary markdown document as a UTF-8 string.
   * Returns null if no markdown file is found.
   */
  readDocument(): Promise<string | null>;

  /**
   * Convenience: write a markdown document.
   * @param markdown — The markdown content
   * @param filename — Filename to use (defaults to 'index.md')
   */
  writeDocument(markdown: string, filename?: string): Promise<void>;
}

// ============================================
// Well-known markdown filenames in priority order
// ============================================

const MARKDOWN_PRIORITY = ['index.md', 'doc.md', 'document.md'];

/**
 * Find the primary markdown path from a list of file entries.
 * Exported for reuse by other ContentContainer implementations.
 */
export function findDocumentPath(entries: ContentEntry[]): string | null {
  // Only consider root-level files (no '/' in path)
  const rootFiles = entries.filter((e) => !e.path.includes('/'));

  for (const name of MARKDOWN_PRIORITY) {
    if (rootFiles.some((e) => e.path.toLowerCase() === name)) {
      return name;
    }
  }

  // Fallback: first .md file at root
  const firstMd = rootFiles.find((e) => e.path.toLowerCase().endsWith('.md'));
  return firstMd?.path ?? null;
}

// ============================================
// MemoryContentContainer
// ============================================

interface MemoryFile {
  data: ArrayBuffer;
  mimeType: string;
}

/**
 * In-memory ContentContainer backed by a Map.
 *
 * Used for zip import (deserialize into memory), tests, and transient operations.
 */
export class MemoryContentContainer implements ContentContainer {
  private files = new Map<string, MemoryFile>();

  async readFile(path: string): Promise<ArrayBuffer | null> {
    return this.files.get(path)?.data ?? null;
  }

  async writeFile(path: string, data: ArrayBuffer | Uint8Array, mimeType?: string): Promise<void> {
    const buffer = data instanceof ArrayBuffer ? data : data.slice().buffer;
    this.files.set(path, {
      data: buffer,
      mimeType: mimeType ?? guessMimeType(path),
    });
  }

  async removeFile(path: string): Promise<void> {
    this.files.delete(path);
  }

  async listFiles(prefix?: string): Promise<ContentEntry[]> {
    const entries: ContentEntry[] = [];
    for (const [path, file] of this.files) {
      if (prefix && !path.startsWith(prefix)) continue;
      entries.push({
        path,
        mimeType: file.mimeType,
        size: file.data.byteLength,
      });
    }
    return entries;
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async getDocumentPath(): Promise<string | null> {
    return findDocumentPath(await this.listFiles());
  }

  async readDocument(): Promise<string | null> {
    const docPath = await this.getDocumentPath();
    if (!docPath) return null;
    const data = await this.readFile(docPath);
    if (!data) return null;
    return new TextDecoder().decode(data);
  }

  async writeDocument(markdown: string, filename?: string): Promise<void> {
    const name = filename ?? 'index.md';
    const data = new TextEncoder().encode(markdown);
    await this.writeFile(name, data, 'text/markdown');
  }
}

// ============================================
// MIME type guessing
// ============================================

const EXTENSION_MIME_MAP: Record<string, string> = {
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'application/javascript',
};

function guessMimeType(path: string): string {
  const dot = path.lastIndexOf('.');
  if (dot === -1) return 'application/octet-stream';
  const ext = path.slice(dot).toLowerCase();
  return EXTENSION_MIME_MAP[ext] ?? 'application/octet-stream';
}
