/**
 * What a markdown media reference points at. Image syntax is the only
 * embedding markdown has, so documents written for a library that ships
 * clips and recordings (knowledge catalogs, recorder output) reference them
 * as `![A brass bell ringing](sounds/bell.mp3)` — and a renderer that drew
 * every such reference as an `<img>` showed a broken picture.
 *
 * The decision is by file extension, ignoring any query string or fragment.
 * `.webm` and `.mp4` are containers for either; like narration discovery
 * (`audioMapping.ts`), they count as audio only under the `audio/` folder
 * the recorder writes to, and as video everywhere else.
 */

export type MediaReferenceKind = 'video' | 'audio';

const VIDEO_EXTENSIONS = new Set(['mp4', 'm4v', 'mov', 'webm', 'ogv']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac']);
const CONTAINER_EXTENSIONS = new Set(['webm', 'mp4']);

/** `'video'`, `'audio'`, or null for anything else (an image, a page, no extension). */
export function mediaKindForUrl(url: string): MediaReferenceKind | null {
  const path = url.split(/[?#]/, 1)[0] ?? '';
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  if (CONTAINER_EXTENSIONS.has(ext) && /^(?:\.\/)?audio\//i.test(path)) return 'audio';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  return null;
}
