/**
 * readInput
 *
 * Unified input reader for the CLI. Accepts a path to a .md file, .json file
 * (Doc schema), .zip/.dbk container, or a folder and returns a MemoryContentContainer
 * (virtual file system) plus either the parsed MarkdownDocument or a pre-built Doc.
 *
 * When a .json file or a container/folder containing doc.json is provided, the
 * Doc is returned directly and markdownDoc will be null. Callers should check
 * result.doc first; when present, skip markdownToDoc() and use it directly.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import type { MarkdownDocument } from '@bendyline/squisq/markdown';
import type { Doc } from '@bendyline/squisq/schemas';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import { zipToContainer } from '@bendyline/squisq-formats/container';

export interface ReadInputResult {
  container: MemoryContentContainer;
  /** Parsed markdown document. Null when input is a Doc JSON file. */
  markdownDoc: MarkdownDocument | null;
  /** Pre-built Doc from JSON input. Present when input is .json or contains doc.json. */
  doc?: Doc;
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
 * Read input from a file path (markdown, JSON Doc, ZIP/DBK container, or folder)
 * and return a populated ContentContainer + parsed MarkdownDocument or Doc.
 *
 * When the input is a .json file (or a container/folder containing doc.json),
 * the result will have `doc` populated and `markdownDoc` set to null.
 * Otherwise, `markdownDoc` is populated and `doc` is undefined.
 */
export async function readInput(inputPath: string): Promise<ReadInputResult> {
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

  // Default: treat as a markdown file
  return readMarkdownFile(inputPath);
}

async function readMarkdownFile(filePath: string): Promise<ReadInputResult> {
  const content = await readFile(filePath, 'utf-8');
  const container = new MemoryContentContainer();
  await container.writeDocument(content);
  const markdownDoc = parseMarkdown(content);
  return { container, markdownDoc };
}

/**
 * Read a standalone Doc JSON file. The container is empty (no media bundled);
 * callers should populate it or set basePath for media resolution.
 */
async function readDocJsonFile(filePath: string): Promise<ReadInputResult> {
  const content = await readFile(filePath, 'utf-8');
  const doc = JSON.parse(content) as Doc;
  const container = new MemoryContentContainer();
  return { container, markdownDoc: null, doc };
}

/**
 * Known filenames for Doc JSON inside containers and folders.
 * Checked in priority order before falling back to markdown discovery.
 */
const DOC_JSON_NAMES = ['doc.json', 'story.json'];

async function readContainer(filePath: string): Promise<ReadInputResult> {
  const data = await readFile(filePath);
  const container = await zipToContainer(
    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
  );

  // Check for Doc JSON inside the container first
  for (const name of DOC_JSON_NAMES) {
    const jsonData = await container.readFile(name);
    if (jsonData) {
      const decoder = new TextDecoder();
      const doc = JSON.parse(decoder.decode(jsonData)) as Doc;
      return { container, markdownDoc: null, doc };
    }
  }

  const markdown = await container.readDocument();
  if (!markdown) {
    throw new Error(`No markdown document or doc.json found in container: ${filePath}`);
  }

  const markdownDoc = parseMarkdown(markdown);
  return { container, markdownDoc };
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

  // Check for Doc JSON inside the folder first
  for (const name of DOC_JSON_NAMES) {
    const jsonData = await container.readFile(name);
    if (jsonData) {
      const decoder = new TextDecoder();
      const doc = JSON.parse(decoder.decode(jsonData)) as Doc;
      return { container, markdownDoc: null, doc };
    }
  }

  const markdown = await container.readDocument();
  if (!markdown) {
    throw new Error(`No markdown document or doc.json found in folder: ${dirPath}`);
  }

  const markdownDoc = parseMarkdown(markdown);
  return { container, markdownDoc };
}
