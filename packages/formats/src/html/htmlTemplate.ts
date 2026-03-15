/**
 * HTML Template Generation for SquisqPlayer Exports
 *
 * Generates complete, self-contained HTML documents that load the SquisqPlayer
 * IIFE bundle and render a Doc as either an interactive slideshow or a static
 * scrollable document.
 *
 * Two variants:
 * 1. **Inline** — All JS, CSS, and images are embedded in the HTML (single file).
 * 2. **External** — JS is referenced via `<script src>`, images via relative paths.
 */

import type { Doc, Layer, Block } from '@bendyline/squisq/schemas';
import { arrayBufferToBase64DataUrl, inferMimeType, extractFilename } from './imageUtils.js';

// ── Types ──────────────────────────────────────────────────────────

export interface HtmlExportOptions {
  /** The IIFE player bundle source code (from @bendyline/squisq-react/standalone-source) */
  playerScript: string;

  /**
   * Map of relative image paths (as they appear in the Doc) to binary image data.
   * For inline HTML export, these are converted to base64 data URIs.
   * For ZIP export, these are written as separate files.
   */
  images?: Map<string, ArrayBuffer>;

  /**
   * Map of audio segment identifiers to binary audio data.
   * Keys should match the audio segment `name` or `url` fields in the Doc.
   * Only used in ZIP exports — single HTML uses timer-based playback.
   */
  audio?: Map<string, ArrayBuffer>;

  /** Rendering mode: 'slideshow' (interactive, default) or 'static' (scrollable) */
  mode?: 'slideshow' | 'static';

  /** HTML page title (default: 'Squisq Document') */
  title?: string;

  /** Auto-play slideshow on load (default: false) */
  autoPlay?: boolean;
}

// ── Image Path Collection ──────────────────────────────────────────

/**
 * Collect all relative image paths referenced in a Doc's layers and template blocks.
 * Returns a Set of unique relative paths that need to be resolved.
 */
export function collectImagePaths(doc: Doc): Set<string> {
  const paths = new Set<string>();

  function addIfRelative(src: string | undefined) {
    if (
      !src ||
      src.startsWith('data:') ||
      src.startsWith('blob:') ||
      src.startsWith('http://') ||
      src.startsWith('https://')
    ) {
      return;
    }
    paths.add(src);
  }

  function scanLayers(layers: Layer[] | undefined) {
    if (!layers) return;
    for (const layer of layers) {
      if (layer.type === 'image') addIfRelative(layer.content.src);
      if (layer.type === 'video') {
        addIfRelative(layer.content.src);
        addIfRelative(layer.content.posterSrc);
      }
      if (layer.type === 'map') addIfRelative(layer.content.staticSrc);
    }
  }

  function scanBlock(block: Block) {
    scanLayers(block.layers);
    if (block.children) block.children.forEach(scanBlock);
  }

  // Scan all blocks
  doc.blocks.forEach(scanBlock);

  // Scan start block hero
  if (doc.startBlock?.heroSrc) addIfRelative(doc.startBlock.heroSrc);

  // Scan persistent layers
  if (doc.persistentLayers) {
    for (const pl of doc.persistentLayers.bottomLayers ?? []) {
      if ('src' in pl && typeof pl.src === 'string') addIfRelative(pl.src);
    }
    for (const pl of doc.persistentLayers.topLayers ?? []) {
      if ('src' in pl && typeof pl.src === 'string') addIfRelative(pl.src);
    }
  }

  // Scan template block fields that reference images
  for (const block of doc.blocks) {
    scanTemplateImageFields(block as unknown as Record<string, unknown>, paths);
  }

  return paths;
}

/**
 * Recursively scan any object for known image-bearing field names.
 */
function scanTemplateImageFields(obj: Record<string, unknown>, paths: Set<string>): void {
  if (!obj || typeof obj !== 'object') return;

  const imageFieldNames = [
    'imageSrc',
    'src',
    'heroSrc',
    'backgroundImage',
    'posterSrc',
    'staticSrc',
    'videoSrc',
    'thumbnailSrc',
  ];

  for (const key of imageFieldNames) {
    const val = obj[key];
    if (typeof val === 'string' && val && !val.startsWith('data:') && !val.startsWith('http')) {
      paths.add(val);
    }
    // Handle nested objects like { src: '...' }
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      scanTemplateImageFields(val as Record<string, unknown>, paths);
    }
  }

  // Handle arrays (e.g., images: [{ src: '...' }])
  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (item && typeof item === 'object') {
        scanTemplateImageFields(item as Record<string, unknown>, paths);
      }
    }
  }

  // Recurse into known array/object fields
  for (const key of ['images', 'accentImage', 'backgroundVideo', 'children', 'blocks']) {
    const val = obj[key];
    if (Array.isArray(val)) {
      for (const item of val) {
        if (item && typeof item === 'object') {
          scanTemplateImageFields(item as Record<string, unknown>, paths);
        }
      }
    } else if (val && typeof val === 'object') {
      scanTemplateImageFields(val as Record<string, unknown>, paths);
    }
  }
}

// ── HTML Generation ────────────────────────────────────────────────

/**
 * Escape a string for safe embedding in a `<script>` tag.
 * Prevents `</script>` from closing the tag prematurely.
 */
function escapeForScript(str: string): string {
  return str.replace(/<\/(script)/gi, '<\\/$1');
}

/**
 * Generate a complete inline HTML document with all JS and images embedded.
 *
 * @param doc - The Doc to render
 * @param options - Export options
 * @returns Complete HTML string
 */
export function generateInlineHtml(doc: Doc, options: HtmlExportOptions): string {
  const {
    playerScript,
    images,
    mode = 'slideshow',
    title = 'Squisq Document',
    autoPlay = false,
  } = options;

  // Build base64 image map
  const imageMap: Record<string, string> = {};
  if (images) {
    for (const [path, buffer] of images.entries()) {
      const mimeType = inferMimeType(path);
      imageMap[path] = arrayBufferToBase64DataUrl(buffer, mimeType);
    }
  }

  const docJson = escapeForScript(JSON.stringify(doc));
  const imageMapJson = escapeForScript(JSON.stringify(imageMap));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0;height:100%;background:#1a1a2e;color:#e0e0e0;font-family:system-ui,-apple-system,sans-serif}
#squisq-root{width:100%;height:100%;display:flex;align-items:center;justify-content:center}
${mode === 'static' ? '#squisq-root{align-items:flex-start;overflow-y:auto;background:#fff;color:#1f2937}' : ''}
</style>
</head>
<body>
<div id="squisq-root"></div>
<script>${escapeForScript(playerScript)}</script>
<script>
(function(){
  var doc = JSON.parse(${JSON.stringify(docJson)});
  var images = JSON.parse(${JSON.stringify(imageMapJson)});
  SquisqPlayer.mount(document.getElementById("squisq-root"), doc, {
    mode: ${JSON.stringify(mode)},
    images: images,
    autoPlay: ${JSON.stringify(autoPlay)},
    basePath: "."
  });
})();
</script>
</body>
</html>`;
}

/**
 * Generate an HTML document that references external JS and image files.
 * Used for ZIP exports where files sit alongside the HTML.
 *
 * @param doc - The Doc to render (image/audio paths should already be rewritten to relative)
 * @param options - Export options (playerScript is not embedded, referenced via src)
 * @returns Complete HTML string
 */
export function generateExternalHtml(
  doc: Doc,
  options: Pick<HtmlExportOptions, 'mode' | 'title' | 'autoPlay'> & {
    /** Relative path to the player JS file (e.g., 'squisq-player.js') */
    playerScriptPath: string;
    /** Map of original image paths to their rewritten relative paths in the ZIP */
    imagePathMap?: Record<string, string>;
    /** Map of audio segment IDs to their rewritten relative paths in the ZIP */
    audioPathMap?: Record<string, string>;
  },
): string {
  const {
    playerScriptPath,
    imagePathMap,
    audioPathMap,
    mode = 'slideshow',
    title = 'Squisq Document',
    autoPlay = false,
  } = options;

  const docJson = escapeForScript(JSON.stringify(doc));
  const imageMapJson = imagePathMap ? escapeForScript(JSON.stringify(imagePathMap)) : '{}';
  const audioMapJson = audioPathMap ? escapeForScript(JSON.stringify(audioPathMap)) : 'null';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0;height:100%;background:#1a1a2e;color:#e0e0e0;font-family:system-ui,-apple-system,sans-serif}
#squisq-root{width:100%;height:100%;display:flex;align-items:center;justify-content:center}
${mode === 'static' ? '#squisq-root{align-items:flex-start;overflow-y:auto;background:#fff;color:#1f2937}' : ''}
</style>
</head>
<body>
<div id="squisq-root"></div>
<script src="${escapeHtml(playerScriptPath)}"></script>
<script>
(function(){
  var doc = JSON.parse(${JSON.stringify(docJson)});
  var images = JSON.parse(${JSON.stringify(imageMapJson)});
  var audio = ${audioMapJson};
  SquisqPlayer.mount(document.getElementById("squisq-root"), doc, {
    mode: ${JSON.stringify(mode)},
    images: images,
    audio: audio,
    autoPlay: ${JSON.stringify(autoPlay)},
    basePath: "."
  });
})();
</script>
</body>
</html>`;
}

/**
 * Escape HTML special characters to prevent injection.
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
