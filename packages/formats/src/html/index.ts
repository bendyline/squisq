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
  type HtmlExportOptions,
} from './htmlTemplate.js';
import { extractFilename } from './imageUtils.js';

// ── Public Types ───────────────────────────────────────────────────

export type { HtmlExportOptions };

/**
 * Normalize a doc-referenced path for use as a zip entry name. Strips
 * leading slashes and rejects any path that tries to escape the archive
 * root via `..` segments (a malicious or malformed doc shouldn't be able
 * to write outside the zip when extracted). Backslashes are folded to
 * forward slashes so Windows-authored paths still produce a consistent
 * tree across extractors.
 */
function sanitizeZipPath(path: string): string | null {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized) return null;
  if (normalized.split('/').some((seg) => seg === '..')) return null;
  return normalized;
}

/**
 * Return a basename that does not collide with a prior archive member.
 *
 * Audio is flattened into a single `audio/` folder, so two segments from
 * different source directories can arrive with the same basename (e.g.
 * `takes/1/narration.webm` and `takes/2/narration.webm`). Without this,
 * the second write silently clobbers the first AND both map entries point
 * at the same bytes — the doc plays the wrong take with no error anywhere.
 */
function uniqueFilename(filename: string, used: ReadonlySet<string>): string {
  if (!used.has(filename)) return filename;
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : '';
  let suffix = 2;
  while (used.has(`${base}-${suffix}${ext}`)) suffix++;
  return `${base}-${suffix}${ext}`;
}

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
  options.signal?.throwIfAborted();
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
  options.signal?.throwIfAborted();
  const {
    playerScript,
    images,
    audio,
    mode = 'slideshow',
    title,
    autoPlay,
    themeId,
    themeRegistry,
  } = options;

  const zip = new JSZip();

  // 1. Add player JS as a separate file
  zip.file('squisq-player.js', playerScript);

  // 2. Add images preserving their original relative paths.
  //
  // We used to flatten everything into `images/<basename>`, but that
  // requires the player to rewrite every `<img src>` at render time using
  // the path map — and the static (non-slideshow) renderer doesn't do
  // that, so its emitted `<img>` tags 404'd against the renamed assets.
  // Keeping the original layout means direct `src="folder/file.png"`
  // references just work, and the exported zip mirrors how the source
  // folder is organized (e.g. pandoc-style `notes_files/` sidecars).
  const imagePathMap: Record<string, string> = {};
  if (images) {
    let imageIndex = 0;
    for (const [originalPath, buffer] of images.entries()) {
      if ((imageIndex++ & 63) === 0) options.signal?.throwIfAborted();
      const zipPath = sanitizeZipPath(originalPath);
      if (!zipPath) {
        // The doc still references this image, so dropping it silently
        // leaves a broken reference in an otherwise "successful" export.
        console.warn(
          `[squisq] docToHtmlZip: skipped image with unsafe path "${originalPath}" — ` +
            'the exported document will have a broken reference to it.',
        );
        continue;
      }
      zip.file(zipPath, buffer);
      imagePathMap[originalPath] = zipPath;
    }
  }

  // 3. Add audio to audio/ folder and build path mapping
  const audioPathMap: Record<string, string> = {};
  if (audio) {
    let audioIndex = 0;
    const usedAudioNames = new Set<string>();
    for (const [segmentKey, buffer] of audio.entries()) {
      if ((audioIndex++ & 63) === 0) options.signal?.throwIfAborted();
      const filename = extractFilename(segmentKey);
      // Ensure .mp3 extension
      const named = filename.includes('.') ? filename : `${filename}.mp3`;
      // Flattening to audio/<basename> can collide across source folders —
      // disambiguate rather than let the later segment win.
      const finalName = uniqueFilename(named, usedAudioNames);
      usedAudioNames.add(finalName);
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
    themeId,
    themeRegistry,
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

export { collectImagePaths, generateExternalHtml } from './htmlTemplate.js';
export { inferMimeType, arrayBufferToBase64DataUrl, extractFilename } from './imageUtils.js';
export { markdownDocToPlainHtml } from './plainHtml.js';
export type { PlainHtmlExportOptions } from './plainHtml.js';
export { markdownDocsToPlainHtmlBundle, collectLinkRefs } from './plainHtmlBundle.js';
export type { PlainHtmlBundleOptions } from './plainHtmlBundle.js';
export { markdownDocsToHtmlBundle } from './docsHtmlBundle.js';
export type { HtmlBundleOptions } from './docsHtmlBundle.js';

// ── Import (HTML → MarkdownDocument) ────────────────────────────────
export { htmlToMarkdown, htmlToMarkdownDoc, htmlToMarkdownDocSync } from './import.js';
export type { HtmlImportOptions } from './import.js';
