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

import type { Doc, Layer, Block, ThemeRegistry } from '@bendyline/squisq/schemas';
import { readFrontmatterThemeId } from '@bendyline/squisq/markdown';
import { arrayBufferToBase64DataUrl, inferMimeType } from './imageUtils.js';

// ── Types ──────────────────────────────────────────────────────────

export interface HtmlExportOptions {
  /** Cancel before synchronous generation and during asset checkpoints. */
  signal?: AbortSignal;
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

  /** Show Copy controls on ordinary fenced code blocks (default: false). */
  showCodeCopyButton?: boolean;

  /**
   * Caption rendering for slideshow playback. Passed through to
   * `SquisqPlayer.mount` — 'social' shows the large centered 3-5 word
   * captions with the active word highlighted; 'standard' the classic
   * lower-third. Omitted = captions off (mount default).
   */
  captionStyle?: 'standard' | 'social';

  /**
   * Squisq theme ID to apply (e.g., 'documentary', 'cinematic').
   * When set, the theme is assigned to the Doc before rendering,
   * so the SquisqPlayer renders with that theme's colors and typography.
   */
  themeId?: string;
  /** Explicit caller-owned registry for non-document custom themes. */
  themeRegistry?: ThemeRegistry;
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
    if (block.contents) scanMarkdownNodes(block.contents, addIfRelative);
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
 * Walk markdown body nodes for image references. Catches both shorthand
 * `![alt](url)` (type `image`, `url` field) and raw HTML `<img src>` tags
 * (type `htmlBlock`/`htmlInline`, `htmlChildren` sub-tree) — the latter is
 * how the WYSIWYG editor round-trips resized images, since markdown
 * shorthand has no width syntax.
 */
function scanMarkdownNodes(nodes: unknown[], visit: (src: string | undefined) => void): void {
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const n = node as Record<string, unknown>;
    if (n.type === 'image' && typeof n.url === 'string') {
      visit(n.url);
    }
    if ((n.type === 'htmlBlock' || n.type === 'htmlInline') && Array.isArray(n.htmlChildren)) {
      scanHtmlNodes(n.htmlChildren, visit);
    }
    if (Array.isArray(n.children)) {
      scanMarkdownNodes(n.children, visit);
    }
  }
}

/** Walk a parsed HTML sub-tree for `<img>` src attributes. */
function scanHtmlNodes(nodes: unknown[], visit: (src: string | undefined) => void): void {
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const n = node as Record<string, unknown>;
    if (n.type !== 'htmlElement') continue;
    if (n.tagName === 'img') {
      const attrs = n.attributes as Record<string, string> | undefined;
      if (attrs && typeof attrs.src === 'string') visit(attrs.src);
    }
    if (Array.isArray(n.children)) {
      scanHtmlNodes(n.children, visit);
    }
  }
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
 *
 * Escaping only `</script` is NOT enough. The HTML tokenizer treats the
 * contents of a script element as a mini state machine: an opening `<!--`
 * switches it into "script data escaped" state, and a subsequent `<script`
 * pushes it into "script data DOUBLE escaped" state — where `</script>` no
 * longer closes the element. So doc text containing `<!--<script>` makes the
 * real closing tag inert and the parser swallows the REST OF THE PAGE as
 * script text, rendering blank.
 *
 * Neutralizing all three of `<!--`, `<script`, and `</script` keeps the
 * tokenizer in its normal state regardless of content.
 *
 * The `<` is replaced with a `<` escape rather than a `\`-prefix, which
 * matters because these values land in two different layers:
 *
 * - The doc / image JSON is emitted inside a JS string that is then
 *   `JSON.parse`d, so the escape must be valid JSON. `<` is; ad-hoc
 *   escapes like `\!` or `\s` are NOT and would make `JSON.parse` throw.
 * - The player bundle is emitted as raw JS. `<` means `<` inside both
 *   string and regex literals, whereas `\s` would silently become the
 *   whitespace class if `<script` ever appeared inside a bundled regex.
 *
 * Only the `<` of a dangerous sequence is escaped — a bare `<` in doc text is
 * inert in script data, so ordinary content pays nothing.
 */
function escapeForScript(str: string): string {
  return str.replace(/<(?=!--|\/?script)/gi, '\\u003c');
}

/**
 * Split an image map into base64 payloads plus an alias table.
 *
 * Callers key the same asset under BOTH its container path and its bare
 * basename (see `collectContainerImages`) because the resolver matches
 * against either. Emitting a data URL per key would embed every payload
 * TWICE in the JSON — ~2.66x the original bytes per image instead of the
 * ~1.33x base64 costs — which is brutal on multi-MB photo docs.
 *
 * So each distinct buffer is encoded exactly once under a canonical key,
 * and every additional key that shares that buffer becomes a cheap
 * `alias -> canonical` entry. The runtime re-expands the aliases into the
 * same flat `images` object the player already expects, so nothing
 * downstream has to know this happened.
 */
function buildInlineImageMaps(images: Map<string, ArrayBuffer> | undefined): {
  imageMap: Record<string, string>;
  imageAliases: Record<string, string>;
} {
  const imageMap: Record<string, string> = {};
  const imageAliases: Record<string, string> = {};
  if (!images) return { imageMap, imageAliases };

  // Keyed on buffer IDENTITY: two images that merely have equal bytes stay
  // separate entries, while the path/basename aliases of one asset (which
  // share a reference) collapse.
  const canonicalKeyFor = new Map<ArrayBuffer, string>();
  for (const [path, buffer] of images.entries()) {
    const canonical = canonicalKeyFor.get(buffer);
    if (canonical !== undefined) {
      imageAliases[path] = canonical;
      continue;
    }
    canonicalKeyFor.set(buffer, path);
    imageMap[path] = arrayBufferToBase64DataUrl(buffer, inferMimeType(path));
  }
  return { imageMap, imageAliases };
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
    showCodeCopyButton = false,
    captionStyle,
    themeId,
    themeRegistry,
  } = options;

  doc = applyThemeSelection(doc, themeId, themeRegistry);

  const { imageMap, imageAliases } = buildInlineImageMaps(images);

  const docJson = escapeForScript(JSON.stringify(doc));
  const imageMapJson = escapeForScript(JSON.stringify(imageMap));
  const imageAliasJson = escapeForScript(JSON.stringify(imageAliases));

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
${mode === 'static' ? '#squisq-root{display:block}' : ''}
</style>
</head>
<body>
<div id="squisq-root"></div>
<script type="application/json" id="squisq-doc" data-squisq-doc="1">${docJson}</script>
<script>${escapeForScript(playerScript)}</script>
<script>
(function(){
  var doc = JSON.parse(document.getElementById("squisq-doc").textContent);
  var images = JSON.parse(${JSON.stringify(imageMapJson)});
  // Re-expand path/basename aliases that share a payload (see
  // buildInlineImageMaps) so \`images\` has every key the resolver may ask for.
  var aliases = JSON.parse(${JSON.stringify(imageAliasJson)});
  for (var alias in aliases) {
    if (Object.prototype.hasOwnProperty.call(aliases, alias)) {
      images[alias] = images[aliases[alias]];
    }
  }
  SquisqPlayer.mount(document.getElementById("squisq-root"), doc, {
    mode: ${JSON.stringify(mode)},
    images: images,
    autoPlay: ${JSON.stringify(autoPlay)},${captionStyle ? `\n    captionStyle: ${JSON.stringify(captionStyle)},` : ''}
    showCodeCopyButton: ${JSON.stringify(showCodeCopyButton)},
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
  options: Pick<
    HtmlExportOptions,
    | 'mode'
    | 'title'
    | 'autoPlay'
    | 'showCodeCopyButton'
    | 'captionStyle'
    | 'themeId'
    | 'themeRegistry'
  > & {
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
    showCodeCopyButton = false,
    captionStyle,
    themeId,
    themeRegistry,
  } = options;

  doc = applyThemeSelection(doc, themeId, themeRegistry);

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
${mode === 'static' ? '#squisq-root{display:block}' : ''}
</style>
</head>
<body>
<div id="squisq-root"></div>
<script type="application/json" id="squisq-doc" data-squisq-doc="1">${docJson}</script>
<script src="${escapeHtml(playerScriptPath)}"></script>
<script>
(function(){
  var doc = JSON.parse(document.getElementById("squisq-doc").textContent);
  var images = JSON.parse(${JSON.stringify(imageMapJson)});
  var audio = ${audioMapJson};
  SquisqPlayer.mount(document.getElementById("squisq-root"), doc, {
    mode: ${JSON.stringify(mode)},
    images: images,
    audio: audio,
    autoPlay: ${JSON.stringify(autoPlay)},${captionStyle ? `\n    captionStyle: ${JSON.stringify(captionStyle)},` : ''}
    showCodeCopyButton: ${JSON.stringify(showCodeCopyButton)},
    basePath: "."
  });
})();
</script>
</body>
</html>`;
}

function applyThemeSelection(
  doc: Doc,
  themeId: string | undefined,
  registry: ThemeRegistry | undefined,
): Doc {
  const selectedId = themeId ?? doc.themeId ?? readFrontmatterThemeId(doc.frontmatter);
  if (!selectedId) return doc;
  const selectedDocTheme = doc.customThemes?.some((theme) => theme.id === selectedId);
  if (selectedDocTheme || !registry) {
    return selectedId === doc.themeId ? doc : { ...doc, themeId: selectedId };
  }
  const registered = registry.get(selectedId);
  if (!registered) return selectedId === doc.themeId ? doc : { ...doc, themeId: selectedId };
  return {
    ...doc,
    themeId: selectedId,
    customThemes: [...(doc.customThemes ?? []), registered],
  };
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
