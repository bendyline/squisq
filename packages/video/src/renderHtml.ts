/**
 * Render HTML Generation for Video Frame Capture
 *
 * Generates a self-contained HTML document that loads the SquisqPlayer standalone
 * bundle in renderMode, embedding all images and audio as base64 data URIs, and
 * any font files the host supplies (`fonts`) as `@font-face` rules.
 *
 * The generated page mounts one standalone player whose instance handle is
 * available through `SquisqPlayer.getHandle(root)`. Headless callers use that
 * handle's render API to step through frames and capture screenshots.
 *
 * Browser-pure: uses only btoa() and Uint8Array — no Node.js APIs.
 */

import type {
  Doc,
  MotionSpec,
  Theme,
  VideoPipPosition,
  VideoPipShape,
  VideoPipSize,
  VideoPresentation,
} from '@bendyline/squisq/schemas';

// ── Types ──────────────────────────────────────────────────────────

/**
 * A font face embedded in the render page. Capture pages load nothing from the
 * network, so a theme font the rendering machine lacks (any Google Fonts stack,
 * such as `dm-sans`) falls back to a system face unless its file is supplied.
 * One entry per file: a family split into unicode-range subsets, or into
 * upright and italic files, takes one entry for each.
 */
export interface RenderFontFace {
  /** CSS family name as the theme's font stack spells it, e.g. `DM Sans`. */
  family: string;
  /** The font file's bytes (an ArrayBuffer, or a Uint8Array such as a Node Buffer). */
  data: ArrayBuffer | Uint8Array;
  /** File format (default 'woff2'). */
  format?: 'woff2' | 'woff' | 'truetype' | 'opentype';
  /** CSS `font-weight`: one weight, or a variable font's range such as `100 1000` (default `normal`). */
  weight?: number | string;
  /** CSS `font-style` (default 'normal'). */
  style?: 'normal' | 'italic';
  /** CSS `unicode-range`, when the file holds one subset of the family. */
  unicodeRange?: string;
}

export interface RenderHtmlOptions {
  /** The IIFE player bundle source code (from PLAYER_BUNDLE) */
  playerScript: string;

  /**
   * Map of relative image paths (as they appear in the Doc) to binary data.
   * Converted to base64 data URIs and embedded in the HTML.
   */
  images?: Map<string, ArrayBuffer>;

  /**
   * Map of audio segment names/paths to binary audio data.
   * Converted to base64 data URIs and embedded in the HTML.
   */
  audio?: Map<string, ArrayBuffer>;

  /** Viewport width in CSS pixels (default: 1920) */
  width?: number;

  /** Viewport height in CSS pixels (default: 1080) */
  height?: number;

  /** Caption style for the rendered video. Omit for no captions. */
  captionStyle?: 'standard' | 'social';

  /** Theme override for the capture player. Omitted values resolve from the Doc. */
  theme?: Theme;

  /** Motion profile override. Omitted values resolve from the Doc, then the theme. */
  motion?: MotionSpec | null;

  /** Player-level video placement override. Omitted values resolve from Doc frontmatter. */
  videoPresentation?: VideoPresentation;

  /** Picture-in-picture size override. Omitted values resolve from Doc frontmatter. */
  pipSize?: VideoPipSize;

  /** Picture-in-picture shape override. Omitted values resolve from Doc frontmatter. */
  pipShape?: VideoPipShape;

  /** Picture-in-picture corner override. Omitted values resolve from Doc frontmatter. */
  pipPosition?: VideoPipPosition;

  /**
   * Whether Squisq layer animations and block transitions are rendered.
   * Defaults to true. Embedded/timed media and document timing are unaffected.
   */
  animationsEnabled?: boolean;
  /** False captures the completed build state. */
  buildsEnabled?: boolean;

  /**
   * Player rendition mounted in the capture page (default 'slideshow').
   * 'dashboard' renders the one-canvas dashboard projection for
   * single-frame image capture.
   */
  displayMode?: 'slideshow' | 'dashboard';

  /**
   * Font files to embed as `@font-face` rules (default none). Faces load
   * before the player mounts, so `document.fonts.ready` covers them.
   */
  fonts?: readonly RenderFontFace[];

  /** Dashboard-mode options (ignored unless `displayMode` is 'dashboard'). */
  dashboard?: {
    /** Layout id or 'auto'. Overrides doc frontmatter. */
    layout?: string;
    /** Title-band override. Overrides doc frontmatter. */
    title?: boolean;
    /**
     * Cell style variant ('basic' | 'card' | 'panel' | 'accent'). Overrides
     * doc frontmatter; colors always come from the active theme.
     */
    style?: string;
    /** Host-supplied title fallback (typically the file name). */
    documentTitle?: string;
  };
}

// ── MIME Detection ─────────────────────────────────────────────────

const MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  avif: 'image/avif',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  webm: 'video/webm',
};

function inferMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return MIME_MAP[ext] ?? 'application/octet-stream';
}

// ── Base64 Encoding (browser-pure) ────────────────────────────────

/**
 * Chunk size for binary-string assembly. 32 KiB stays well inside every
 * engine's argument-count limit for `String.fromCharCode(...)` while keeping
 * the number of intermediate strings small.
 */
const BINARY_STRING_CHUNK = 0x8000;

/**
 * Convert an ArrayBuffer to a base64 data URI.
 * Uses only standard Web APIs (Uint8Array + btoa) — this module is browser-pure.
 *
 * Built chunk-wise rather than one byte at a time: per-byte `binary += ...`
 * allocates a rope of hundreds of MB for a large asset (measured ~6-9x slower
 * at 8-32 MB). Output is byte-identical.
 */
function arrayBufferToDataUrl(buffer: ArrayBuffer | Uint8Array, mimeType: string): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += BINARY_STRING_CHUNK) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + BINARY_STRING_CHUNK)));
  }
  return `data:${mimeType};base64,${btoa(parts.join(''))}`;
}

// ── Escaping ───────────────────────────────────────────────────────

/**
 * Prevent `</script>` from prematurely closing the script tag.
 */
function escapeForScript(str: string): string {
  return str.replace(/<\/(script)/gi, '<\\/$1');
}

/** Escape HTML special characters. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Font Faces ─────────────────────────────────────────────────────

const FONT_MIME: Record<NonNullable<RenderFontFace['format']>, string> = {
  woff2: 'font/woff2',
  woff: 'font/woff',
  truetype: 'font/ttf',
  opentype: 'font/otf',
};

const FONT_FAMILY = /^[\p{L}\p{N} _.-]+$/u;
const FONT_WEIGHT = /^(?:normal|bold|\d{1,4}(?: \d{1,4})?)$/;
const UNICODE_RANGE =
  /^U\+[0-9A-F?]{1,6}(?:-[0-9A-F]{1,6})?(?:, ?U\+[0-9A-F?]{1,6}(?:-[0-9A-F]{1,6})?)*$/i;

/**
 * `@font-face` rules for the supplied fonts. Every value is checked against a
 * strict pattern rather than escaped, so a caller cannot break out of the rule.
 * `font-display: block` keeps a capture from ever drawing the fallback face.
 */
function fontFaceCss(fonts: readonly RenderFontFace[]): string {
  return fonts
    .map((font) => {
      const family = font.family.trim();
      const format = font.format ?? 'woff2';
      const weight = String(font.weight ?? 'normal').trim();
      const style = font.style ?? 'normal';
      if (!FONT_FAMILY.test(family)) throw new Error(`Invalid font family name: ${font.family}`);
      if (!(format in FONT_MIME)) throw new Error(`Unsupported font format: ${format}`);
      if (!FONT_WEIGHT.test(weight)) {
        throw new Error(`Invalid font weight for ${family}: ${weight}`);
      }
      if (style !== 'normal' && style !== 'italic') {
        throw new Error(`Invalid font style for ${family}: ${String(style)}`);
      }
      if (font.unicodeRange !== undefined && !UNICODE_RANGE.test(font.unicodeRange.trim())) {
        throw new Error(`Invalid unicode-range for ${family}: ${font.unicodeRange}`);
      }
      const src = arrayBufferToDataUrl(font.data, FONT_MIME[format]);
      const range = font.unicodeRange ? `;unicode-range:${font.unicodeRange.trim()}` : '';
      return (
        `@font-face{font-family:"${family}";src:url(${src}) format("${format}");` +
        `font-weight:${weight};font-style:${style};font-display:block${range}}`
      );
    })
    .join('\n');
}

// ── HTML Generation ────────────────────────────────────────────────

/**
 * Generate a self-contained HTML document for headless video frame capture.
 *
 * The page mounts the SquisqPlayer in renderMode. Call
 * `SquisqPlayer.getHandle(root)` to obtain this instance's render API.
 *
 * @param doc - The Doc to render
 * @param options - Render HTML options including player script and media
 * @returns Complete HTML string ready to be loaded in a headless browser
 */
export function generateRenderHtml(doc: Doc, options: RenderHtmlOptions): string {
  const {
    playerScript,
    images,
    audio,
    width = 1920,
    height = 1080,
    captionStyle,
    theme,
    motion,
    videoPresentation,
    pipSize,
    pipShape,
    pipPosition,
    animationsEnabled = true,
    buildsEnabled = true,
    displayMode = 'slideshow',
    dashboard,
    fonts = [],
  } = options;
  const fontCss = fonts.length > 0 ? `\n${fontFaceCss(fonts)}` : '';
  // A face loads only once text uses it; start every one now so the capture's
  // wait on document.fonts.ready also waits for them.
  const fontLoad =
    fonts.length > 0
      ? '\n  if (document.fonts) document.fonts.forEach(function (face) { face.load().catch(function () {}); });'
      : '';

  // Build base64 image map
  const imageMap: Record<string, string> = {};
  if (images) {
    for (const [path, buffer] of images.entries()) {
      imageMap[path] = arrayBufferToDataUrl(buffer, inferMimeType(path));
    }
  }

  // Build base64 audio map
  const audioMap: Record<string, string> = {};
  let hasAudio = false;
  if (audio) {
    for (const [name, buffer] of audio.entries()) {
      audioMap[name] = arrayBufferToDataUrl(buffer, inferMimeType(name));
      hasAudio = true;
    }
  }

  const docJson = escapeForScript(JSON.stringify(doc));
  const imageMapJson = escapeForScript(JSON.stringify(imageMap));
  const audioMapJson = hasAudio ? escapeForScript(JSON.stringify(audioMap)) : 'null';
  const playerOptionLines = [
    // Always pin the composed viewport to the export size. The page also
    // pins #squisq-root to it, but an explicit viewport is what stops
    // portrait/custom renders from falling back to the landscape preset.
    `    viewport: ${JSON.stringify({ width, height })}`,
    `    animationsEnabled: ${JSON.stringify(animationsEnabled)}`,
    `    buildsEnabled: ${JSON.stringify(buildsEnabled)}`,
    captionStyle ? `    captionStyle: ${JSON.stringify(captionStyle)}` : null,
    theme ? `    theme: ${escapeForScript(JSON.stringify(theme))}` : null,
    motion != null ? `    motion: ${escapeForScript(JSON.stringify(motion))}` : null,
    videoPresentation ? `    videoPresentation: ${JSON.stringify(videoPresentation)}` : null,
    pipSize ? `    pipSize: ${JSON.stringify(pipSize)}` : null,
    pipShape ? `    pipShape: ${JSON.stringify(pipShape)}` : null,
    pipPosition ? `    pipPosition: ${JSON.stringify(pipPosition)}` : null,
    displayMode === 'dashboard'
      ? `    dashboard: ${escapeForScript(JSON.stringify(dashboard ?? {}))}`
      : null,
  ].filter((line): line is string => line !== null);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=${width}, height=${height}">
<title>${escapeHtml('Squisq Video Render')}</title>
<style>
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0;width:${width}px;height:${height}px;overflow:hidden;background:#000}
#squisq-root{width:${width}px;height:${height}px;display:flex;align-items:center;justify-content:center}${fontCss}
</style>
</head>
<body>
<div id="squisq-root"></div>
<script>${escapeForScript(playerScript)}</script>
<script>
(function(){
  var doc = JSON.parse(${JSON.stringify(docJson)});
  var images = JSON.parse(${JSON.stringify(imageMapJson)});
  var audio = ${audioMapJson === 'null' ? 'null' : 'JSON.parse(' + JSON.stringify(audioMapJson) + ')'};
  var root = document.getElementById("squisq-root");${fontLoad}
  SquisqPlayer.mount(root, doc, {
    mode: ${JSON.stringify(displayMode === 'dashboard' ? 'dashboard' : 'slideshow')},
    images: images,
    audio: audio,
    autoPlay: false,
    basePath: ".",
    renderMode: true,
${playerOptionLines.join(',\n')}
  });
})();
</script>
</body>
</html>`;
}
