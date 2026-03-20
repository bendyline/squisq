/**
 * readInput
 *
 * Unified input reader for the CLI. Accepts a path to a .md file,
 * .zip/.dbk container, or a folder and returns a MemoryContentContainer
 * (virtual file system) plus the parsed MarkdownDocument.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import type { MarkdownDocument } from '@bendyline/squisq/markdown';
import { MemoryContentContainer } from '@bendyline/squisq/storage';
import { zipToContainer } from '@bendyline/squisq-formats/container';

export interface ReadInputResult {
  container: MemoryContentContainer;
  markdownDoc: MarkdownDocument;
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
 * Read input from a file path (markdown, ZIP/DBK container, or folder)
 * and return a populated ContentContainer + parsed MarkdownDocument.
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

async function readContainer(filePath: string): Promise<ReadInputResult> {
  const data = await readFile(filePath);
  const container = await zipToContainer(data.buffer as ArrayBuffer);

  const markdown = await container.readDocument();
  if (!markdown) {
    throw new Error(`No markdown document found in container: ${filePath}`);
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
      new Uint8Array(data.buffer as ArrayBuffer),
      mimeFromExt(relPath),
    );
  }

  const markdown = await container.readDocument();
  if (!markdown) {
    throw new Error(`No markdown document found in folder: ${dirPath}`);
  }

  const markdownDoc = parseMarkdown(markdown);
  return { container, markdownDoc };
}
