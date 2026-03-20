/**
 * Render HTML Generation for Video Frame Capture
 *
 * Generates a self-contained HTML document that loads the SquisqPlayer standalone
 * bundle in renderMode, embedding all images and audio as base64 data URIs.
 *
 * The generated page exposes `window.seekTo(time)`, `window.getDuration()`, etc.
 * via the SquisqRenderAPI, enabling Playwright (or any headless browser) to step
 * through frames and capture screenshots.
 *
 * Browser-pure: uses only btoa() and Uint8Array — no Node.js APIs.
 */

import type { Doc } from '@bendyline/squisq/schemas';

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
 * Convert an ArrayBuffer to a base64 data URI.
 * Uses only standard Web APIs (Uint8Array + btoa).
 */
function arrayBufferToDataUrl(buffer: ArrayBuffer, mimeType: string): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
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
 * The page mounts the SquisqPlayer in renderMode, which exposes the
 * SquisqRenderAPI on `window` (seekTo, getDuration, getCaptions, etc.).
 *
 * @param doc - The Doc to render
 * @param options - Render HTML options including player script and media
 * @returns Complete HTML string ready to be loaded in a headless browser
 */
export function generateRenderHtml(doc: Doc, options: RenderHtmlOptions): string {
  const { playerScript, images, audio, width = 1920, height = 1080 } = options;

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
  SquisqPlayer.mount(document.getElementById("squisq-root"), doc, {
    mode: "slideshow",
    images: images,
    audio: audio,
    autoPlay: false,
    basePath: ".",
    renderMode: true
  });
})();
</script>
</body>
</html>`;
}
