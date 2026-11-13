/**
 * Baked media for exports that cannot apply a recipe.
 *
 * A script-free HTML page plays a clip's file as it is: no cuts, no cleaned-up
 * sound, no gain, fades or crop. `bakeMarkdownMedia` finds every clip in a
 * markdown source whose recipe such a player would ignore, has the render
 * manager bake it, and returns the source with those clips pointing at their
 * baked files and the recipe (and trim) taken off — a document any exporter
 * can treat as ordinary media. The original source is not changed; this is
 * the text to hand to the export.
 */

import { markdownToDoc } from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { mediaBakeCopyPath, needsMediaBake } from '@bendyline/squisq/mediaEdit';
import type { MediaEditRenderManager } from '@bendyline/squisq-video-react/media-edit';
import { setMediaClipInSource } from '../timelineSource';
import { listEditableMedia } from './mediaEditTargets';

export interface BakedMediaReference {
  /** The clip's source reference, as the document wrote it. */
  src: string;
  kind: 'audio' | 'video';
  /** 1-based line of the clip in the markdown. */
  sourceLine: number;
  /** Where the baked file is stored: a media path the document's provider resolves. */
  path: string;
  /** The reference written into the returned markdown. */
  reference: string;
}

export interface BakedMarkdown {
  /** The source, with every baked clip pointing at its baked file. */
  markdown: string;
  baked: BakedMediaReference[];
  /** Clips that could not be baked. They keep their original reference and recipe. */
  failures: Array<{ src: string; sourceLine: number; error: string }>;
}

export interface BakeMarkdownMediaOptions {
  signal?: AbortSignal;
  /** 0…1 across every clip that needs baking, with the clip being worked on. */
  onProgress?: (fraction: number, clip: { index: number; count: number; src: string }) => void;
  /**
   * How the returned markdown refers to a baked file.
   *
   * - `'store'` (default) — its path in the render store. Right when the
   *   export is read beside the document's own media folder.
   * - `'copy'` — a visible name beside the source (`video/take-edited.mp4`),
   *   for an export that carries its own copy of each file: the render store
   *   is a dot-folder, which many static hosts will not serve. The exporter
   *   reads `baked[n].path` and writes it at `baked[n].reference`.
   */
  reference?: 'store' | 'copy';
}

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1);
}

/** A copy name no earlier clip in this export took (two recipes over one source). */
function uniqueCopyPath(src: string, extension: string, used: Set<string>): string {
  const first = mediaBakeCopyPath(src, extension);
  let path = first;
  for (let n = 2; used.has(path); n++) {
    path = first.replace(/(\.[^./]+)$/, `-${n}$1`);
  }
  used.add(path);
  return path;
}

/**
 * Bake every clip in `markdown` that a recipe-unaware player would play
 * wrongly, and return the source rewritten to use the baked files. A clip
 * that fails to bake is reported and left as it was; cancelling rejects with
 * an `AbortError`.
 */
export async function bakeMarkdownMedia(
  markdown: string,
  manager: MediaEditRenderManager,
  options: BakeMarkdownMediaOptions = {},
): Promise<BakedMarkdown> {
  const doc = markdownToDoc(parseMarkdown(markdown));
  const clips = listEditableMedia(doc).filter((item) => needsMediaBake(item.clip));
  const result: BakedMarkdown = { markdown, baked: [], failures: [] };
  const usedCopyPaths = new Set<string>();

  for (const [index, item] of clips.entries()) {
    options.signal?.throwIfAborted();
    const position = { index, count: clips.length, src: item.src };
    options.onProgress?.(index / clips.length, position);
    try {
      const path = await manager.bake(item.clip, {
        signal: options.signal,
        onProgress: (fraction) => options.onProgress?.((index + fraction) / clips.length, position),
      });
      const reference =
        options.reference === 'copy'
          ? uniqueCopyPath(item.src, extensionOf(path), usedCopyPaths)
          : path;
      // The baked file already holds the trim and the recipe: neither may be applied twice.
      const rewritten = setMediaClipInSource(result.markdown, item.sourceLine, {
        src: reference,
        clipStart: null,
        clipEnd: null,
        edits: null,
      });
      if (rewritten == null) throw new Error('The clip could not be rewritten.');
      result.markdown = rewritten;
      result.baked.push({
        src: item.src,
        kind: item.kind,
        sourceLine: item.sourceLine,
        path,
        reference,
      });
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      result.failures.push({
        src: item.src,
        sourceLine: item.sourceLine,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  options.onProgress?.(1, { index: clips.length, count: clips.length, src: '' });
  return result;
}
