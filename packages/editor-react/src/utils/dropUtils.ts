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
 * assigned by the provider.
 */
export async function processMediaFiles(
  files: File[],
  mediaProvider: MediaProvider,
): Promise<string[]> {
  const paths: string[] = [];

  for (const file of files) {
    const buffer = await file.arrayBuffer();
    const mimeType = file.type || 'application/octet-stream';
    const path = await mediaProvider.addMedia(file.name, buffer, mimeType);
    paths.push(path);
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
