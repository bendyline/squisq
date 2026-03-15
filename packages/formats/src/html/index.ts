/**
 * HTML Export Module — @bendyline/squisq-formats/html
 *
 * Exports squisq documents as self-contained HTML files or ZIP archives.
 *
 * Two export modes:
 *
 * 1. **Single HTML** (`docToHtml`) — Everything embedded in one file:
 *    - SquisqPlayer IIFE bundle inlined in `<script>`
 *    - Images base64-encoded as data URIs
 *    - Timer-based playback (no audio — too large for inline)
 *
 * 2. **ZIP Archive** (`docToHtmlZip`) — Multi-file package:
 *    - `index.html` referencing external `squisq-player.js`
 *    - `squisq-player.js` — the IIFE bundle
 *    - `images/` — extracted image files
 *    - `audio/` — optional audio segment files (enables full playback)
 *
 * @example
 * ```ts
 * import { PLAYER_BUNDLE } from '@bendyline/squisq-react/standalone-source';
 * import { docToHtml, docToHtmlZip } from '@bendyline/squisq-formats/html';
 *
 * // Single HTML file
 * const html = docToHtml(doc, { playerScript: PLAYER_BUNDLE, images });
 *
 * // ZIP archive
 * const zipBlob = await docToHtmlZip(doc, { playerScript: PLAYER_BUNDLE, images, audio });
 * ```
 */

import type { Doc } from '@bendyline/squisq/schemas';
import JSZip from 'jszip';
import {
  generateInlineHtml,
  generateExternalHtml,
  collectImagePaths,
  type HtmlExportOptions,
} from './htmlTemplate.js';
import { inferMimeType, extractFilename } from './imageUtils.js';

// ── Public Types ───────────────────────────────────────────────────

export type { HtmlExportOptions };

export interface HtmlZipExportOptions extends HtmlExportOptions {
  /**
   * Map of audio segment identifiers to binary audio data.
   * Keys should match the audio segment `name` or `url` fields in the Doc.
   * When provided, audio files are included in the ZIP and full playback is enabled.
   */
  audio?: Map<string, ArrayBuffer>;
}

// ── Single HTML Export ─────────────────────────────────────────────

/**
 * Export a Doc as a single, self-contained HTML file.
 *
 * The player JS is embedded inline, images are base64-encoded as data URIs,
 * and playback uses a timer (no audio) for compact file size.
 *
 * @param doc - The Doc to export
 * @param options - Export options (must include `playerScript`)
 * @returns Complete HTML document as a string
 *
 * @example
 * ```ts
 * const html = docToHtml(myDoc, {
 *   playerScript: PLAYER_BUNDLE,
 *   images: imageMap,
 *   title: 'My Document',
 *   mode: 'slideshow',
 * });
 * const blob = new Blob([html], { type: 'text/html' });
 * ```
 */
export function docToHtml(doc: Doc, options: HtmlExportOptions): string {
  return generateInlineHtml(doc, options);
}

// ── ZIP Archive Export ─────────────────────────────────────────────

/**
 * Export a Doc as a ZIP archive containing HTML, JS, images, and optionally audio.
 *
 * The archive structure:
 * ```
 * document.zip
 * ├── index.html           # HTML page referencing squisq-player.js
 * ├── squisq-player.js     # Standalone IIFE bundle
 * ├── images/              # Extracted image files
 * │   ├── hero.jpg
 * │   └── ...
 * └── audio/               # Optional audio segment files
 *     ├── intro.mp3
 *     └── ...
 * ```
 *
 * @param doc - The Doc to export
 * @param options - Export options (must include `playerScript`)
 * @returns A Promise resolving to a ZIP Blob
 *
 * @example
 * ```ts
 * const blob = await docToHtmlZip(myDoc, {
 *   playerScript: PLAYER_BUNDLE,
 *   images: imageMap,
 *   audio: audioMap,
 * });
 * // Trigger browser download
 * const url = URL.createObjectURL(blob);
 * ```
 */
export async function docToHtmlZip(doc: Doc, options: HtmlZipExportOptions): Promise<Blob> {
  const { playerScript, images, audio, mode = 'slideshow', title, autoPlay } = options;

  const zip = new JSZip();

  // 1. Add player JS as a separate file
  zip.file('squisq-player.js', playerScript);

  // 2. Add images to images/ folder and build path mapping
  const imagePathMap: Record<string, string> = {};
  if (images) {
    for (const [originalPath, buffer] of images.entries()) {
      const filename = extractFilename(originalPath);
      const zipPath = `images/${filename}`;
      zip.file(zipPath, buffer);
      imagePathMap[originalPath] = zipPath;
    }
  }

  // 3. Add audio to audio/ folder and build path mapping
  const audioPathMap: Record<string, string> = {};
  if (audio) {
    for (const [segmentKey, buffer] of audio.entries()) {
      const filename = extractFilename(segmentKey);
      // Ensure .mp3 extension
      const finalName = filename.includes('.') ? filename : `${filename}.mp3`;
      const zipPath = `audio/${finalName}`;
      zip.file(zipPath, buffer);
      audioPathMap[segmentKey] = zipPath;
    }
  }

  // 4. Generate HTML that references external files
  const html = generateExternalHtml(doc, {
    playerScriptPath: 'squisq-player.js',
    imagePathMap: Object.keys(imagePathMap).length > 0 ? imagePathMap : undefined,
    audioPathMap: Object.keys(audioPathMap).length > 0 ? audioPathMap : undefined,
    mode,
    title,
    autoPlay,
  });
  zip.file('index.html', html);

  // 5. Generate ZIP blob
  return zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

// ── Re-exports ─────────────────────────────────────────────────────

export { collectImagePaths } from './htmlTemplate.js';
export { inferMimeType, arrayBufferToBase64DataUrl, extractFilename } from './imageUtils.js';
