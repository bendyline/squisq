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

import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
  win32,
} from 'node:path';
import { parseMarkdown, stringifyMarkdown } from '@bendyline/squisq/markdown';
import type { MarkdownDocument } from '@bendyline/squisq/markdown';
import { markdownToDoc, resolveAudioMapping } from '@bendyline/squisq/doc';
import { resolveMediaSchedule, validateDocSchema } from '@bendyline/squisq/schemas';
import type { Doc, DocDiagnostic, DocSchemaIssue } from '@bendyline/squisq/schemas';
import type { ContentContainer } from '@bendyline/squisq/storage';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import { zipToContainer } from '@bendyline/squisq-formats/container';
import { defaultRegistry } from '@bendyline/squisq-formats';
import type { FormatId } from '@bendyline/squisq-formats';
import {
  MAX_RENDER_MEDIA_FILES,
  MAX_RENDER_MEDIA_FILE_BYTES,
  MAX_RENDER_MEDIA_TOTAL_BYTES,
} from './mediaBudget.js';

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

/** Schema failure carrying diagnostics suitable for `squisq validate --json`. */
export class DocInputValidationError extends Error {
  readonly diagnostics: DocDiagnostic[];
  readonly issues: DocSchemaIssue[];

  constructor(source: string, issues: DocSchemaIssue[]) {
    const detail = issues.map(formatSchemaIssueForError).join('; ');
    super(`${source} is not a valid squisq Doc: ${detail}`);
    this.name = 'DocInputValidationError';
    this.issues = issues;
    this.diagnostics = issues.map((issue) => ({
      severity: 'error',
      code: 'invalid-doc-schema',
      message: `${issue.path} ${issue.message}`,
    }));
  }
}

function formatSchemaIssueForError(issue: DocSchemaIssue): string {
  if (issue.path === '$') {
    const got = /\(got ([^)]+)\)/.exec(issue.message)?.[1] ?? 'an invalid value';
    return `expected a JSON object, got ${got}`;
  }
  return `"${issue.path}" ${issue.message}`;
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
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
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
  assertValidDoc(result.doc, inputPath);
  // Audio rides in the container: a document-anchored narration take
  // (`{[audio src=… anchor=document]}` + timing sidecar) re-times the
  // block timeline, and per-block audio files map into segments — so
  // `squisq convert`/`video` exports pace exactly like the editor preview.
  const doc = await resolveAudioMapping(result.doc, result.container);
  throwIfAborted(options?.signal);
  assertValidDoc(doc, inputPath);
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
  const markdownDoc = parseMarkdown(content);
  const doc = markdownToDoc(markdownDoc, { fileName: basename(filePath) });
  const container = await buildBareMarkdownContainer(filePath, content, doc, signal);
  return { doc, container, markdownDoc, sourceFormat: 'md' };
}

const NARRATION_EXTENSIONS = new Set(['.aac', '.flac', '.m4a', '.mp3', '.ogg', '.wav']);

/**
 * Build the same useful container shape for a bare markdown file that folder
 * and DBK inputs already provide. Only authored references, conventional
 * timing sidecars, and immediate sibling narration files are admitted; this
 * avoids sweeping an arbitrary source directory (for example a repository
 * root) into memory.
 */
async function buildBareMarkdownContainer(
  filePath: string,
  content: string,
  doc: Doc,
  signal?: AbortSignal,
): Promise<MemoryContentContainer> {
  const container = new MemoryContentContainer();
  await container.writeDocument(content, basename(filePath));
  throwIfAborted(signal);

  const refs = collectAuthoredAssetRefs(content, doc);
  const root = dirname(resolve(filePath));

  // Preserve the long-standing sibling-audio discovery behavior of folder
  // inputs without copying unrelated files from the whole directory tree.
  for (const entry of await readdir(root, { withFileTypes: true })) {
    throwIfAborted(signal);
    if (entry.isFile() && NARRATION_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      refs.add(entry.name);
    }
  }

  // Narration mapping recognizes both a consolidated timing.json and
  // per-file `<audio>.timing.json` sidecars.
  refs.add('timing.json');
  for (const ref of [...refs]) {
    if (NARRATION_EXTENSIONS.has(extname(stripUrlSuffix(ref)).toLowerCase())) {
      refs.add(`${stripUrlSuffix(ref)}.timing.json`);
    }
  }

  const rootReal = await realpath(root);
  let fileCount = 0;
  let totalBytes = 0;
  for (const authoredRef of refs) {
    throwIfAborted(signal);
    const safe = normalizeAssetReference(authoredRef);
    if (!safe) continue;

    const absolute = resolve(root, ...safe.split('/'));
    if (!isContainedPath(root, absolute)) continue;

    let assetReal: string;
    let info: Awaited<ReturnType<typeof stat>>;
    try {
      assetReal = await realpath(absolute);
      if (!isContainedPath(rootReal, assetReal)) continue;
      info = await stat(assetReal);
    } catch (error: unknown) {
      if (isMissingFileError(error)) continue;
      throw error;
    }
    if (!info.isFile()) continue;

    if (info.size > MAX_RENDER_MEDIA_FILE_BYTES) {
      throw new Error(
        `Sibling asset "${safe}" exceeds the ${formatMiB(MAX_RENDER_MEDIA_FILE_BYTES)} ` +
          'per-file input limit.',
      );
    }
    if (fileCount + 1 > MAX_RENDER_MEDIA_FILES) {
      throw new Error(
        `Bare markdown input references more than ${MAX_RENDER_MEDIA_FILES} sibling assets.`,
      );
    }
    if (totalBytes + info.size > MAX_RENDER_MEDIA_TOTAL_BYTES) {
      throw new Error(
        `Sibling assets exceed the ${formatMiB(MAX_RENDER_MEDIA_TOTAL_BYTES)} total input limit.`,
      );
    }

    const data = await readBinaryFile(assetReal, signal);
    // Recheck the bytes actually read in case the file changed after stat().
    if (data.byteLength > MAX_RENDER_MEDIA_FILE_BYTES) {
      throw new Error(
        `Sibling asset "${safe}" exceeds the ${formatMiB(MAX_RENDER_MEDIA_FILE_BYTES)} ` +
          'per-file input limit.',
      );
    }
    if (totalBytes + data.byteLength > MAX_RENDER_MEDIA_TOTAL_BYTES) {
      throw new Error(
        `Sibling assets exceed the ${formatMiB(MAX_RENDER_MEDIA_TOTAL_BYTES)} total input limit.`,
      );
    }
    await container.writeFile(safe, data, mimeFromExt(safe));
    fileCount += 1;
    totalBytes += data.byteLength;
  }

  return container;
}

function collectAuthoredAssetRefs(content: string, doc: Doc): Set<string> {
  const refs = new Set<string>();
  const add = (value: unknown): void => {
    if (typeof value === 'string' && value.trim()) refs.add(value.trim());
  };

  const scanObject = (value: unknown, seen = new Set<object>()): void => {
    if (!value || typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) scanObject(item, seen);
      return;
    }
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (
        typeof item === 'string' &&
        ['src', 'url', 'heroSrc', 'posterSrc', 'staticSrc', 'videoSrc', 'imageSrc'].includes(key)
      ) {
        add(item);
      } else {
        scanObject(item, seen);
      }
    }
  };
  scanObject(doc);

  for (const segment of doc.audio.segments) add(segment.src);
  for (const clip of resolveMediaSchedule(doc)) add(clip.src);

  // Raw HTML media, CSS font/image URLs, markdown destinations, and Squisq
  // annotations are all legal authoring paths. The filesystem confinement
  // check below remains authoritative for every extracted spelling.
  const patterns = [
    /\b(?:src|href)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi,
    /\b(?:src|audio|video|image|font)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s}\]]+))/gi,
    /\burl\(\s*(?:"([^"]+)"|'([^']+)'|([^\s)]+))\s*\)/gi,
    /!?\[[^\]]*\]\(\s*<?([^\s)>]+)>?/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content))) add(match.slice(1).find(Boolean));
  }

  return refs;
}

function normalizeAssetReference(authoredRef: string): string | null {
  let value = stripUrlSuffix(authoredRef.trim().replace(/^<|>$/g, ''));
  try {
    value = decodeURIComponent(value);
  } catch {
    return null;
  }
  if (
    !value ||
    value.includes('\0') ||
    /^[a-z][a-z\d+.-]*:/i.test(value) ||
    posix.isAbsolute(value) ||
    win32.isAbsolute(value) ||
    isAbsolute(value)
  ) {
    return null;
  }
  const parts = value.replace(/\\/g, '/').split('/');
  if (parts.some((part) => part === '..')) return null;
  const normalized = parts.filter((part) => part && part !== '.').join('/');
  return normalized || null;
}

function stripUrlSuffix(value: string): string {
  return value.split(/[?#]/, 1)[0] ?? value;
}

function isContainedPath(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    ((error as { code?: unknown }).code === 'ENOENT' ||
      (error as { code?: unknown }).code === 'ENOTDIR')
  );
}

function formatMiB(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function assertValidDoc(value: unknown, source: string): asserts value is Doc {
  const issues = validateDocSchema(value);
  if (issues.length > 0) throw new DocInputValidationError(source, issues);
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
 * Validation is delegated to the canonical runtime schema in
 * `@bendyline/squisq/schemas`, so JSON input receives the same structural
 * contract as every other normalized CLI input.
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

  assertValidDoc(parsed, source);
  return parsed;
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

  return {
    doc: markdownToDoc(markdownDoc, { fileName: basename(filePath) }),
    container,
    markdownDoc,
    sourceFormat: def.id,
  };
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
  coverFileName?: string,
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
  return {
    doc: markdownToDoc(markdownDoc, { fileName: coverFileName }),
    container,
    markdownDoc,
    sourceFormat,
  };
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
    basename(filePath),
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
    basename(dirPath),
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason !== undefined) throw signal.reason;
  const error = new Error('Input reading was cancelled');
  error.name = 'AbortError';
  throw error;
}
