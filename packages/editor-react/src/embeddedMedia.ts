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
 * Adapt body-embedded audio/video to the scheduled-clip shape consumed by
 * timeline playback. Embedded media is block-scoped, so it starts with its
 * owning block and stays active for that block's authored duration.
 */
export function collectEmbeddedMediaSchedule(doc: Doc): ScheduledClip[] {
  const schedule: ScheduledClip[] = [];

  const visit = (blocks: Block[]): void => {
    for (const block of blocks) {
      collectEmbeddedMedia(block).forEach((media, index) => {
        schedule.push({
          id: `embedded:${block.id}:${index}`,
          kind: media.kind,
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

/**
 * Video-only projection used by the docked timeline monitors.
 *
 * Audio ownership remains with the timeline's off-screen media host so opening
 * or closing a monitor cannot duplicate or suppress a clip's sound.
 */
export function collectEmbeddedVideoSchedule(doc: Doc): ScheduledClip[] {
  return collectEmbeddedMediaSchedule(doc).filter((clip) => clip.kind === 'video');
}

/**
 * Build the complete set of media elements owned by Timeline playback.
 *
 * Scheduled clips can overlap and intentionally remain independent: the
 * browser mixes every active audible element. Body embeds are added because
 * they do not appear in `resolveMediaSchedule()`. Legacy narration segments
 * are added only when their source is not already represented by a scheduled
 * clip, preventing the same narration take from playing twice.
 */
export function collectTimelinePlaybackSchedule(
  doc: Doc,
  scheduled: ScheduledClip[],
): ScheduledClip[] {
  const scheduledSources = new Set(scheduled.map((clip) => clip.src));
  const narration = doc.audio.segments
    .map<ScheduledClip | null>((segment, index) => {
      if (scheduledSources.has(segment.src)) return null;
      return {
        id: `narration:${index}`,
        kind: 'audio',
        src: segment.src,
        absoluteStart: Math.max(0, segment.startTime),
        absoluteEnd: Math.max(0, segment.startTime) + Math.max(0, segment.duration),
        sourceIn: 0,
        anchor: 'document',
      };
    })
    .filter(
      (clip): clip is ScheduledClip => clip !== null && clip.absoluteEnd > clip.absoluteStart,
    );

  return [...scheduled, ...collectEmbeddedMediaSchedule(doc), ...narration];
}
