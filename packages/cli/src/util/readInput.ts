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
async function walkDir(root: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const paths: string[] = [];

  for (const entry of entries) {
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      paths.push(...(await walkDir(join(root, entry.name), relPath)));
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
  const result = await readInputRaw(inputPath, options);
  // Audio rides in the container: a document-anchored narration take
  // (`{[audio src=… anchor=document]}` + timing sidecar) re-times the
  // block timeline, and per-block audio files map into segments — so
  // `squisq convert`/`video` exports pace exactly like the editor preview.
  const doc = await resolveAudioMapping(result.doc, result.container);
  return doc === result.doc ? result : { ...result, doc };
}

async function readInputRaw(
  inputPath: string,
  options?: ReadInputOptions,
): Promise<ReadInputResult> {
  const info = await stat(inputPath);

  if (info.isDirectory()) {
    return readFolder(inputPath);
  }

  const ext = extname(inputPath).toLowerCase();
  if (ext === '.zip' || ext === '.dbk') {
    return readContainer(inputPath);
  }

  if (ext === '.json') {
    return readDocJsonFile(inputPath);
  }

  if (IMPORTER_EXTS.includes(ext)) {
    const def = defaultRegistry().byExtension(ext);
    if (def && (def.importContainer || def.importDoc)) {
      return readViaImporter(inputPath, def, options);
    }
  }

  // Default: treat as a markdown file
  return readMarkdownFile(inputPath);
}

/** Read a file into an ArrayBuffer (a fresh copy, not a Buffer view). */
async function readArrayBuffer(filePath: string): Promise<ArrayBuffer> {
  const data = await readFile(filePath);
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

async function readMarkdownFile(filePath: string): Promise<ReadInputResult> {
  const content = await readFile(filePath, 'utf-8');
  const container = new MemoryContentContainer();
  await container.writeDocument(content);
  const markdownDoc = parseMarkdown(content);
  return { doc: markdownToDoc(markdownDoc), container, markdownDoc, sourceFormat: 'md' };
}

/**
 * Read a standalone Doc JSON file. The container is empty (no media bundled);
 * callers should populate it or set basePath for media resolution.
 */
async function readDocJsonFile(filePath: string): Promise<ReadInputResult> {
  const content = await readFile(filePath, 'utf-8');
  const doc = JSON.parse(content) as Doc;
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
  const buffer = await readArrayBuffer(filePath);
  const convertOptions = {
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
    container = await def.importContainer(buffer, convertOptions);
    const text = await container.readDocument();
    markdownDoc = text ? parseMarkdown(text) : { type: 'document', children: [] };
  } else {
    // importDoc is guaranteed present by the caller's guard.
    markdownDoc = await def.importDoc!(buffer, convertOptions);
    const mem = new MemoryContentContainer();
    await mem.writeDocument(stringifyMarkdown(markdownDoc));
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
): Promise<ReadInputResult> {
  // Check for Doc JSON first.
  for (const name of DOC_JSON_NAMES) {
    const jsonData = await container.readFile(name);
    if (jsonData) {
      const doc = JSON.parse(new TextDecoder().decode(jsonData)) as Doc;
      return { doc, container, sourceFormat };
    }
  }

  const markdown = await container.readDocument();
  if (!markdown) {
    throw new Error(missingMessage);
  }

  const markdownDoc = parseMarkdown(markdown);
  return { doc: markdownToDoc(markdownDoc), container, markdownDoc, sourceFormat };
}

async function readContainer(filePath: string): Promise<ReadInputResult> {
  const container = await zipToContainer(await readArrayBuffer(filePath));
  return resolveContainer(
    container,
    'dbk',
    `No markdown document or doc.json found in container: ${filePath}`,
  );
}

async function readFolder(dirPath: string): Promise<ReadInputResult> {
  const container = new MemoryContentContainer();
  const files = await walkDir(dirPath);

  for (const relPath of files) {
    const absPath = join(dirPath, relPath);
    const data = await readFile(absPath);
    await container.writeFile(
      relPath,
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
      mimeFromExt(relPath),
    );
  }

  return resolveContainer(
    container,
    'folder',
    `No markdown document or doc.json found in folder: ${dirPath}`,
  );
}
