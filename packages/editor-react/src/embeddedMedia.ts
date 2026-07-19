/**
 * embeddedMedia
 *
 * Finds audio/video embedded directly in a block's body — recorder output
 * (`<video src="…">` / `<audio src="…">` HTML tags), dropped files, or markdown
 * links/images to a media file — as opposed to authored `{[audio …]}` clip
 * annotations. The timeline surfaces these so authors see (and can re-time) the
 * media they inserted; editing one converts it to a timed clip annotation.
 */

import type { Block, Doc, ScheduledClip } from '@bendyline/squisq/schemas';

const VIDEO_EXT = new Set(['webm', 'mp4', 'mov', 'm4v', 'ogv']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus']);

/** Audio/video kind inferred from a URL's extension, or null for other files. */
export function mediaKindFromUrl(url: string): 'audio' | 'video' | null {
  const ext = url.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase();
  if (!ext) return null;
  if (VIDEO_EXT.has(ext)) return 'video';
  if (AUDIO_EXT.has(ext)) return 'audio';
  return null;
}

export interface EmbeddedMedia {
  src: string;
  kind: 'audio' | 'video';
  /** 1-based source line of the embed, for re-timing / relocation. */
  sourceLine?: number;
}

/** Recursively collect embedded audio/video from a block's body content. */
export function collectEmbeddedMedia(block: Block): EmbeddedMedia[] {
  const out: EmbeddedMedia[] = [];

  const visit = (node: unknown, line: number | undefined): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as {
      type?: string;
      url?: unknown;
      tagName?: string;
      attributes?: Record<string, string>;
      children?: unknown;
      htmlChildren?: unknown;
      position?: { start?: { line?: number } };
    };
    const here = n.position?.start?.line ?? line;

    // Markdown image/link to a media file.
    if ((n.type === 'image' || n.type === 'link') && typeof n.url === 'string') {
      const kind = mediaKindFromUrl(n.url);
      if (kind) out.push({ src: n.url, kind, sourceLine: here });
    }

    // Raw HTML `<video>` / `<audio>` element (recorder output). The src can be
    // on the element itself or on a nested `<source>`.
    if (n.type === 'htmlElement' && (n.tagName === 'video' || n.tagName === 'audio')) {
      const kind = n.tagName === 'video' ? 'video' : 'audio';
      let src = typeof n.attributes?.src === 'string' ? n.attributes.src : undefined;
      if (!src && Array.isArray(n.children)) {
        for (const child of n.children) {
          const c = child as { tagName?: string; attributes?: Record<string, string> };
          if (c.tagName === 'source' && typeof c.attributes?.src === 'string') {
            src = c.attributes.src;
            break;
          }
        }
      }
      if (src) out.push({ src, kind, sourceLine: here });
    }

    if (Array.isArray(n.children)) n.children.forEach((c) => visit(c, here));
    if (Array.isArray(n.htmlChildren)) n.htmlChildren.forEach((c) => visit(c, here));
  };

  (block.contents ?? []).forEach((node) => visit(node, undefined));
  return out;
}

/**
 * Adapt body-embedded videos to the scheduled-clip shape consumed by the
 * timeline monitor. Embedded media is block-scoped, so it starts with its
 * owning block and stays active for that block's authored duration.
 */
export function collectEmbeddedVideoSchedule(doc: Doc): ScheduledClip[] {
  const schedule: ScheduledClip[] = [];

  const visit = (blocks: Block[]): void => {
    for (const block of blocks) {
      collectEmbeddedMedia(block).forEach((media, index) => {
        if (media.kind !== 'video') return;
        schedule.push({
          id: `embedded:${block.id}:${index}`,
          kind: 'video',
          src: media.src,
          absoluteStart: block.startTime,
          absoluteEnd: block.startTime + block.duration,
          sourceIn: 0,
          anchor: 'block',
          blockId: block.id,
          ...(media.sourceLine != null ? { sourceLine: media.sourceLine } : {}),
        });
      });
      if (block.children?.length) visit(block.children);
    }
  };

  visit(doc.blocks);
  return schedule;
}
