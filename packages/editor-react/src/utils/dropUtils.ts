/**
 * Drop Utilities
 *
 * File processing pipeline for dropped files. Classifies files by type,
 * processes media files into a MediaProvider, and converts text files
 * (.md, .txt, .docx) to markdown strings.
 */

import type { MediaProvider } from '@bendyline/squisq/schemas';
import { stringifyMarkdown } from '@bendyline/squisq/markdown';
import { classifyFile, type FileCategory } from '../hooks/useFileDrop';

export type { FileCategory };
export { classifyFile };

/**
 * Partition an array of files into media, text, and data categories.
 * Files with unknown type are skipped.
 */
export function partitionFiles(files: File[]): { media: File[]; text: File[]; data: File[] } {
  const media: File[] = [];
  const text: File[] = [];
  const data: File[] = [];

  for (const file of files) {
    const cat = classifyFile(file);
    if (cat === 'media') media.push(file);
    else if (cat === 'text') text.push(file);
    else if (cat === 'data') data.push(file);
  }

  return { media, text, data };
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

/** MIME by data extension, for File objects whose `type` is empty. */
const DATA_EXT_MIME: Record<string, string> = {
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  parquet: 'application/vnd.apache.parquet',
};

/**
 * Store data files (csv/tsv/xlsx/parquet) into the container behind a
 * MediaProvider, under a caller-supplied directory prefix — conventionally
 * `dataSidecarPrefix(docBasename)`, i.e. `<docbasename>_files/data/`.
 *
 * Same defensive read handling and index-aligned `null` slots as
 * {@link processMediaFiles}. Name collisions inside the prefix get a
 * ` -1`, `-2`, … suffix rather than overwriting an existing sidecar.
 */
export async function processDataFiles(
  files: File[],
  mediaProvider: MediaProvider,
  dataDirPrefix: string,
): Promise<(string | null)[]> {
  const paths: (string | null)[] = [];
  if (files.length === 0) return paths;

  let existing: Set<string>;
  try {
    existing = new Set((await mediaProvider.listMedia()).map((entry) => entry.name));
  } catch {
    existing = new Set();
  }

  for (const file of files) {
    let buffer: ArrayBuffer;
    try {
      buffer = await file.arrayBuffer();
    } catch (err: unknown) {
      console.warn(
        `[squisq-editor] Skipped dropped file "${file.name}" — could not read its contents.`,
        err instanceof Error ? err.message : err,
      );
      paths.push(null);
      continue;
    }

    if (buffer.byteLength === 0) {
      console.warn(
        `[squisq-editor] Skipped dropped file "${file.name}" — its contents read as 0 bytes.`,
      );
      paths.push(null);
      continue;
    }

    const baseName = file.name.split(/[\\/]/).pop() || 'data';
    const dot = baseName.lastIndexOf('.');
    const stem = dot > 0 ? baseName.slice(0, dot) : baseName;
    const ext = dot > 0 ? baseName.slice(dot) : '';
    const mimeType =
      file.type || DATA_EXT_MIME[ext.replace('.', '').toLowerCase()] || 'application/octet-stream';

    let candidate = `${dataDirPrefix}${baseName}`;
    for (let suffix = 1; existing.has(candidate); suffix++) {
      candidate = `${dataDirPrefix}${stem}-${suffix}${ext}`;
    }

    try {
      const path = await mediaProvider.addMedia(candidate, buffer, mimeType);
      existing.add(path);
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
    const { docxToMarkdownDoc } = await import('@bendyline/squisq-formats/docx');
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
