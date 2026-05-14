/**
 * Drop Utilities
 *
 * File processing pipeline for dropped files. Classifies files by type,
 * processes media files into a MediaProvider, and converts text files
 * (.md, .txt, .docx) to markdown strings.
 */

import type { MediaProvider } from '@bendyline/squisq/schemas';
import { stringifyMarkdown } from '@bendyline/squisq/markdown';
import { docxToMarkdownDoc } from '@bendyline/squisq-formats/docx';
import { classifyFile, type FileCategory } from '../hooks/useFileDrop';

export type { FileCategory };
export { classifyFile };

/**
 * Partition an array of files into media and text categories.
 * Files with unknown type are skipped.
 */
export function partitionFiles(files: File[]): { media: File[]; text: File[] } {
  const media: File[] = [];
  const text: File[] = [];

  for (const file of files) {
    const cat = classifyFile(file);
    if (cat === 'media') media.push(file);
    else if (cat === 'text') text.push(file);
  }

  return { media, text };
}

/**
 * Add media files to a MediaProvider. Returns the relative paths
 * assigned by the provider, with `null` slots where a file could not
 * be processed — keeping the result aligned with the input array so
 * callers can correlate indices.
 *
 * Two failure modes are handled defensively:
 *
 * 1. `file.arrayBuffer()` throws (`InvalidStateError` — "An operation
 *    that depends on state cached in an interface object was made but
 *    the state had changed since it was read from disk"). This happens
 *    with virtual drag sources whose File reference goes stale before
 *    the async read completes — Phone Link / iOS continuity / certain
 *    screenshot tools / etc.
 *
 * 2. `file.arrayBuffer()` returns a 0-byte buffer. Some virtual
 *    sources resolve the read successfully but with no payload,
 *    leaving an empty file in the media bin. We skip those so the
 *    bin doesn't accumulate placeholders.
 *
 * In both cases we warn via console rather than throwing, so a single
 * problematic file doesn't abort a multi-file drop.
 */
export async function processMediaFiles(
  files: File[],
  mediaProvider: MediaProvider,
): Promise<(string | null)[]> {
  const paths: (string | null)[] = [];

  for (const file of files) {
    let buffer: ArrayBuffer;
    try {
      buffer = await file.arrayBuffer();
    } catch (err: unknown) {
      console.warn(
        `[squisq-editor] Skipped dropped file "${file.name}" — could not read its contents.`,
        'This is typical for drags from virtual sources (Phone Link, screenshot tools, cross-tab drags) whose File reference goes stale before the async read completes.',
        err instanceof Error ? err.message : err,
      );
      paths.push(null);
      continue;
    }

    if (buffer.byteLength === 0) {
      console.warn(
        `[squisq-editor] Skipped dropped file "${file.name}" — its contents read as 0 bytes. ` +
          'The drag source likely never materialized the file (try saving it to disk first, then dragging from there).',
      );
      paths.push(null);
      continue;
    }

    const mimeType = file.type || 'application/octet-stream';
    try {
      const path = await mediaProvider.addMedia(file.name, buffer, mimeType);
      paths.push(path);
    } catch (err: unknown) {
      console.warn(
        `[squisq-editor] Failed to save "${file.name}" via mediaProvider:`,
        err instanceof Error ? err.message : err,
      );
      paths.push(null);
    }
  }

  return paths;
}

/**
 * Read a text-content file and return its content as a markdown string.
 *
 * - `.md` and `.txt` files are read as UTF-8 text directly
 * - `.docx` files are converted to markdown via `@bendyline/squisq-formats/docx`
 */
export async function processTextFile(file: File): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';

  if (ext === 'md' || ext === 'txt') {
    return await file.text();
  }

  if (ext === 'docx') {
    const buffer = await file.arrayBuffer();
    const markdownDoc = await docxToMarkdownDoc(buffer);
    return stringifyMarkdown(markdownDoc);
  }

  return await file.text();
}

/**
 * Process multiple text files and concatenate their content.
 */
export async function processTextFiles(files: File[]): Promise<string> {
  const results: string[] = [];

  for (const file of files) {
    const content = await processTextFile(file);
    results.push(content);
  }

  return results.join('\n\n');
}
