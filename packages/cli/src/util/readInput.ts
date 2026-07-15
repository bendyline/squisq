/**
 * readInput
 *
 * Unified input reader for the CLI. Accepts a path to a markdown file, a JSON
 * Doc file, a `.zip`/`.dbk` container, a folder, or any importable binary
 * format (`.docx`/`.pptx`/`.pdf`/`.xlsx`/`.csv`/`.html`/`.htm`) and always
 * resolves it to a fully-populated {@link ReadInputResult}: a `Doc`, a
 * `ContentContainer` holding the document + any bundled media, the parsed
 * `MarkdownDocument` when the source was markdown-shaped, and the detected
 * `sourceFormat`.
 *
 * Binary formats are dispatched through the shared format registry's importer
 * (preferring `importContainer`, falling back to `importDoc`); every path
 * derives the `Doc` via `markdownToDoc()` when the source is markdown-shaped.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { parseMarkdown, stringifyMarkdown } from '@bendyline/squisq/markdown';
import type { MarkdownDocument } from '@bendyline/squisq/markdown';
import { markdownToDoc, resolveAudioMapping } from '@bendyline/squisq/doc';
import type { Doc } from '@bendyline/squisq/schemas';
import type { ContentContainer } from '@bendyline/squisq/storage';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import { zipToContainer } from '@bendyline/squisq-formats/container';
import { defaultRegistry } from '@bendyline/squisq-formats';
import type { FormatId } from '@bendyline/squisq-formats';

export interface ReadInputResult {
  /** The resolved document. Always present. */
  doc: Doc;
  /** Virtual file system holding the document plus any bundled media. */
  container: ContentContainer;
  /**
   * The parsed markdown document. Present when the source was markdown-shaped
   * (`.md`, container/folder markdown, or a binary format imported as
   * markdown); absent for JSON-Doc input.
   */
  markdownDoc?: MarkdownDocument;
  /** Detected source format id (registry id, or `md`/`json`/`dbk`/`folder`). */
  sourceFormat: FormatId;
}

export interface ReadInputOptions {
  /** Cancel filesystem traversal, import, or audio resolution at a bounded boundary. */
  signal?: AbortSignal;
  /**
   * Infer a Squisq theme from an OOXML source's theme part (PPTX today).
   * Default true — the importer carries it as frontmatter.
   */
  inferTheme?: boolean;
  /** Derive custom layout templates from PPTX slide layouts. Default true. */
  inferLayouts?: boolean;
}

/** MIME type lookup by extension (common content types) */
const MIME_TYPES: Record<string, string> = {
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

/**
 * Binary extensions dispatched through the registry importer. `.md`, `.zip`,
 * `.dbk`, and `.json` are intentionally excluded — they have dedicated paths
 * that also detect bundled media / doc.json.
 */
const IMPORTER_EXTS = ['.docx', '.pptx', '.pdf', '.xlsx', '.csv', '.html', '.htm'];

function mimeFromExt(filePath: string): string {
  return MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Recursively walk a directory and return all file paths (relative to root).
 */
async function walkDir(root: string, prefix = '', signal?: AbortSignal): Promise<string[]> {
  throwIfAborted(signal);
  const entries = await readdir(root, { withFileTypes: true });
  throwIfAborted(signal);
  const paths: string[] = [];

  for (const entry of entries) {
    throwIfAborted(signal);
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      paths.push(...(await walkDir(join(root, entry.name), relPath, signal)));
    } else if (entry.isFile()) {
      paths.push(relPath);
    }
  }

  return paths;
}

/**
 * Read input from a file path (markdown, JSON Doc, ZIP/DBK container, folder,
 * or an importable binary format) and resolve it to a populated
 * {@link ReadInputResult}.
 */
export async function readInput(
  inputPath: string,
  options?: ReadInputOptions,
): Promise<ReadInputResult> {
  throwIfAborted(options?.signal);
  const result = await readInputRaw(inputPath, options);
  throwIfAborted(options?.signal);
  // Audio rides in the container: a document-anchored narration take
  // (`{[audio src=… anchor=document]}` + timing sidecar) re-times the
  // block timeline, and per-block audio files map into segments — so
  // `squisq convert`/`video` exports pace exactly like the editor preview.
  const doc = await resolveAudioMapping(result.doc, result.container);
  throwIfAborted(options?.signal);
  return doc === result.doc ? result : { ...result, doc };
}

async function readInputRaw(
  inputPath: string,
  options?: ReadInputOptions,
): Promise<ReadInputResult> {
  throwIfAborted(options?.signal);
  const info = await stat(inputPath);
  throwIfAborted(options?.signal);

  if (info.isDirectory()) {
    return readFolder(inputPath, options?.signal);
  }

  const ext = extname(inputPath).toLowerCase();
  if (ext === '.zip' || ext === '.dbk') {
    return readContainer(inputPath, options?.signal);
  }

  if (ext === '.json') {
    return readDocJsonFile(inputPath, options?.signal);
  }

  if (IMPORTER_EXTS.includes(ext)) {
    const def = defaultRegistry().byExtension(ext);
    if (def && (def.importContainer || def.importDoc)) {
      return readViaImporter(inputPath, def, options);
    }
  }

  // Default: treat as a markdown file
  return readMarkdownFile(inputPath, options?.signal);
}

/** Read a file into an ArrayBuffer (a fresh copy, not a Buffer view). */
async function readArrayBuffer(filePath: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const data = await readBinaryFile(filePath, signal);
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

async function readBinaryFile(filePath: string, signal?: AbortSignal): Promise<Uint8Array> {
  throwIfAborted(signal);
  try {
    const data = await readFile(filePath, { signal });
    throwIfAborted(signal);
    return data;
  } catch (error: unknown) {
    throwIfAborted(signal);
    throw error;
  }
}

async function readUtf8File(filePath: string, signal?: AbortSignal): Promise<string> {
  throwIfAborted(signal);
  try {
    const content = await readFile(filePath, { encoding: 'utf-8', signal });
    throwIfAborted(signal);
    return content;
  } catch (error: unknown) {
    throwIfAborted(signal);
    throw error;
  }
}

async function readMarkdownFile(filePath: string, signal?: AbortSignal): Promise<ReadInputResult> {
  const content = await readUtf8File(filePath, signal);
  const container = new MemoryContentContainer();
  await container.writeDocument(content);
  throwIfAborted(signal);
  const markdownDoc = parseMarkdown(content);
  return { doc: markdownToDoc(markdownDoc), container, markdownDoc, sourceFormat: 'md' };
}

/**
 * Parse and validate a Doc JSON payload.
 *
 * Without this, `JSON.parse(...) as Doc` let any shape through and the failure
 * surfaced far downstream as `Cannot read properties of undefined (reading
 * 'blocks')` — useless to the user. A malformed `duration` was worse than
 * useless: a NaN/string duration propagates into the audio timeline and reaches
 * ffmpeg as `adelay=NaN`.
 *
 * Deliberately a focused structural guard, not a full schema validation: it
 * checks the fields the CLI pipeline dereferences, and names the offending
 * field plus the file so the message is actionable.
 *
 * @param content - Raw JSON text.
 * @param source - Path/label used in error messages.
 */
export function parseDocJson(content: string, source: string): Doc {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${source} is not valid JSON: ${detail}`);
  }

  const fail = (detail: string): never => {
    throw new Error(`${source} is not a valid squisq Doc: ${detail}`);
  };

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    fail(`expected a JSON object, got ${Array.isArray(parsed) ? 'an array' : typeof parsed}`);
  }
  const doc = parsed as Partial<Doc>;

  if (!Array.isArray(doc.blocks)) {
    fail(`"blocks" must be an array${doc.blocks === undefined ? ' (field is missing)' : ''}`);
  }
  for (const [index, block] of doc.blocks!.entries()) {
    if (typeof block !== 'object' || block === null || Array.isArray(block)) {
      fail(`"blocks[${index}]" must be an object`);
    }
  }

  if (doc.duration !== undefined && !isFiniteNumber(doc.duration)) {
    fail(`"duration" must be a finite number, got ${describe(doc.duration)}`);
  }

  if (doc.audio !== undefined) {
    if (typeof doc.audio !== 'object' || doc.audio === null || Array.isArray(doc.audio)) {
      fail('"audio" must be an object');
    }
    const segments = (doc.audio as Partial<Doc['audio']>).segments;
    if (segments !== undefined) {
      if (!Array.isArray(segments)) fail('"audio.segments" must be an array');
      for (const [index, segment] of segments.entries()) {
        if (typeof segment !== 'object' || segment === null) {
          fail(`"audio.segments[${index}]" must be an object`);
        }
        if (!isFiniteNumber(segment.duration)) {
          fail(
            `"audio.segments[${index}].duration" must be a finite number, ` +
              `got ${describe(segment.duration)}`,
          );
        }
      }
    }
  }

  // Normalize the optional-but-dereferenced fields so downstream code (and the
  // audio timeline) never sees a missing track.
  return {
    ...(doc as Doc),
    audio: doc.audio ?? { segments: [] },
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function describe(value: unknown): string {
  if (typeof value === 'number') return Number.isNaN(value) ? 'NaN' : String(value);
  if (typeof value === 'string') return JSON.stringify(value);
  return value === null ? 'null' : typeof value;
}

/**
 * Read a standalone Doc JSON file. The container is empty (no media bundled);
 * callers should populate it or set basePath for media resolution.
 */
async function readDocJsonFile(filePath: string, signal?: AbortSignal): Promise<ReadInputResult> {
  const content = await readUtf8File(filePath, signal);
  const doc = parseDocJson(content, filePath);
  const container = new MemoryContentContainer();
  return { doc, container, sourceFormat: 'json' };
}

/**
 * Dispatch an importable binary format (docx/pptx/pdf/…) through the registry
 * importer. Prefers `importContainer` (extracts media alongside the markdown),
 * falling back to `importDoc` wrapped in a fresh container.
 */
async function readViaImporter(
  filePath: string,
  def: import('@bendyline/squisq-formats').FormatDefinition,
  options?: ReadInputOptions,
): Promise<ReadInputResult> {
  const signal = options?.signal;
  throwIfAborted(signal);
  const buffer = await readArrayBuffer(filePath, signal);
  const convertOptions = {
    signal,
    formatOptions: {
      [def.id]: {
        inferTheme: options?.inferTheme !== false,
        inferLayouts: options?.inferLayouts !== false,
      },
    },
  };

  let container: ContentContainer;
  let markdownDoc: MarkdownDocument;
  if (def.importContainer) {
    throwIfAborted(signal);
    container = await def.importContainer(buffer, convertOptions);
    throwIfAborted(signal);
    const text = await container.readDocument();
    throwIfAborted(signal);
    markdownDoc = text ? parseMarkdown(text) : { type: 'document', children: [] };
  } else {
    // importDoc is guaranteed present by the caller's guard.
    throwIfAborted(signal);
    markdownDoc = await def.importDoc!(buffer, convertOptions);
    throwIfAborted(signal);
    const mem = new MemoryContentContainer();
    await mem.writeDocument(stringifyMarkdown(markdownDoc));
    throwIfAborted(signal);
    container = mem;
  }

  return { doc: markdownToDoc(markdownDoc), container, markdownDoc, sourceFormat: def.id };
}

/**
 * Known filenames for Doc JSON inside containers and folders.
 * Checked in priority order before falling back to markdown discovery.
 */
const DOC_JSON_NAMES = ['doc.json', 'story.json'];

/** Resolve a container that may hold either a doc.json or a markdown document. */
async function resolveContainer(
  container: ContentContainer,
  sourceFormat: FormatId,
  missingMessage: string,
  signal?: AbortSignal,
): Promise<ReadInputResult> {
  // Check for Doc JSON first.
  for (const name of DOC_JSON_NAMES) {
    throwIfAborted(signal);
    const jsonData = await container.readFile(name);
    throwIfAborted(signal);
    if (jsonData) {
      const doc = parseDocJson(new TextDecoder().decode(jsonData), name);
      return { doc, container, sourceFormat };
    }
  }

  throwIfAborted(signal);
  const markdown = await container.readDocument();
  throwIfAborted(signal);
  if (!markdown) {
    throw new Error(missingMessage);
  }

  const markdownDoc = parseMarkdown(markdown);
  return { doc: markdownToDoc(markdownDoc), container, markdownDoc, sourceFormat };
}

async function readContainer(filePath: string, signal?: AbortSignal): Promise<ReadInputResult> {
  throwIfAborted(signal);
  const container = await zipToContainer(await readArrayBuffer(filePath, signal));
  throwIfAborted(signal);
  return resolveContainer(
    container,
    'dbk',
    `No markdown document or doc.json found in container: ${filePath}`,
    signal,
  );
}

async function readFolder(dirPath: string, signal?: AbortSignal): Promise<ReadInputResult> {
  throwIfAborted(signal);
  const container = new MemoryContentContainer();
  const files = await walkDir(dirPath, '', signal);
  throwIfAborted(signal);

  for (const relPath of files) {
    throwIfAborted(signal);
    const absPath = join(dirPath, relPath);
    const data = await readBinaryFile(absPath, signal);
    throwIfAborted(signal);
    await container.writeFile(
      relPath,
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      mimeFromExt(relPath),
    );
    throwIfAborted(signal);
  }

  return resolveContainer(
    container,
    'folder',
    `No markdown document or doc.json found in folder: ${dirPath}`,
    signal,
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason !== undefined) throw signal.reason;
  const error = new Error('Input reading was cancelled');
  error.name = 'AbortError';
  throw error;
}
