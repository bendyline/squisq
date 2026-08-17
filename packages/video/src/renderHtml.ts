/**
 * Render HTML Generation for Video Frame Capture
 *
 * Generates a self-contained HTML document that loads the SquisqPlayer standalone
 * bundle in renderMode, embedding all images and audio as base64 data URIs.
 *
 * The generated page mounts one standalone player whose instance handle is
 * available through `SquisqPlayer.getHandle(root)`. Headless callers use that
 * handle's render API to step through frames and capture screenshots.
 *
 * Browser-pure: uses only btoa() and Uint8Array — no Node.js APIs.
 */

import type {
  Doc,
  Theme,
  VideoPipPosition,
  VideoPipShape,
  VideoPipSize,
  VideoPresentation,
} from '@bendyline/squisq/schemas';

// ── Types ──────────────────────────────────────────────────────────

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

  /**
   * Player rendition mounted in the capture page (default 'slideshow').
   * 'dashboard' renders the one-canvas dashboard projection for
   * single-frame image capture.
   */
  displayMode?: 'slideshow' | 'dashboard';

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
function arrayBufferToDataUrl(buffer: ArrayBuffer, mimeType: string): string {
  const bytes = new Uint8Array(buffer);
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
    videoPresentation,
    pipSize,
    pipShape,
    pipPosition,
    animationsEnabled = true,
    displayMode = 'slideshow',
    dashboard,
  } = options;

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
    `    animationsEnabled: ${JSON.stringify(animationsEnabled)}`,
    captionStyle ? `    captionStyle: ${JSON.stringify(captionStyle)}` : null,
    theme ? `    theme: ${escapeForScript(JSON.stringify(theme))}` : null,
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
#squisq-root{width:${width}px;height:${height}px;display:flex;align-items:center;justify-content:center}
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
  var root = document.getElementById("squisq-root");
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
