/**
 * Shared player-document projection used by the main Video preview and the
 * Timeline composition monitor. Keeping this in one hook guarantees both
 * surfaces apply narration timing, transforms, and player materialization in
 * the same order.
 */

import { useEffect, useState } from 'react';
import type { AudioTrack, Doc } from '@bendyline/squisq/schemas';
import { resolveAudioMapping, resolveDataReferences } from '@bendyline/squisq/doc';
import { applyTransform } from '@bendyline/squisq/transform';
import type { ContentContainer } from '@bendyline/squisq/storage';
import { buildPreviewDoc } from './buildPreviewDoc';

/** Preview window size for `{[dataTable src=…]}` sidecar references. */
const DATA_PREVIEW_ROWS = 50;

/**
 * Fill `{[dataTable src=…]}` sidecar references with bounded previews.
 * The readers live in `@bendyline/squisq-formats` and are loaded lazily —
 * a document with no data references costs nothing. Any failure (module
 * load, file read, parse) falls back to the input doc: the body link still
 * renders, matching the resolver's own never-throw contract.
 */
async function resolveDataPreviews(doc: Doc, container: ContentContainer): Promise<Doc> {
  try {
    const { defaultDataReaders } = await import('@bendyline/squisq-formats/data');
    const resolved = await resolveDataReferences(doc, container, {
      readers: defaultDataReaders(),
      maxPreviewRows: DATA_PREVIEW_ROWS,
    });
    return resolved.doc;
  } catch {
    return doc;
  }
}

export interface PreviewProjection {
  /** Transformed content model shared by Page and Document. */
  contentDoc: Doc;
  /** Flattened/timed player model shared by Slideshow and Video. */
  playerDoc: Doc;
}

function hasEquivalentAudio(left: AudioTrack, right: AudioTrack): boolean {
  if (left === right) return true;
  if (left.segments.length !== right.segments.length) return false;
  return left.segments.every((segment, index) => {
    const other = right.segments[index];
    return (
      segment.src === other.src &&
      segment.name === other.name &&
      segment.duration === other.duration &&
      segment.startTime === other.startTime
    );
  });
}

/**
 * Re-parsing frontmatter creates a fresh Doc (and therefore a fresh AudioTrack)
 * even when the playable timeline did not change. DocPlayer intentionally
 * resets for a genuinely new track, so retain the previous track identity for
 * equivalent projections and let cosmetic document updates remain in place.
 */
function preserveEquivalentAudio(
  previous: PreviewProjection | null,
  next: PreviewProjection,
): PreviewProjection {
  const previousAudio = previous?.playerDoc.audio;
  if (!previousAudio || !hasEquivalentAudio(previousAudio, next.playerDoc.audio)) return next;
  return {
    ...next,
    playerDoc: { ...next.playerDoc, audio: previousAudio },
  };
}

export function usePreviewProjection(
  doc: Doc | null,
  transformStyle: string,
  workspaceContainer?: ContentContainer | null,
  documentTitle?: string,
  /**
   * Bump to re-run container discovery (audio + data previews) without a
   * document change — e.g. after a sidecar file is re-uploaded.
   */
  mediaRevision?: number,
): PreviewProjection | null {
  const [projection, setProjection] = useState<PreviewProjection | null>(null);

  useEffect(() => {
    if (!doc || !doc.blocks.length) {
      setProjection(null);
      return;
    }

    // Audio resolution precedes transform so narration timing is inherited by
    // any generated slides before the player-ready document is materialized.
    const build = (sourceDoc: Doc): PreviewProjection => {
      const contentDoc = transformStyle ? applyTransform(sourceDoc, transformStyle).doc : sourceDoc;
      // Image interleaving splices untimed 5s filler slides between blocks and
      // then recomputes every startTime cumulatively. That is fine for a doc
      // whose timeline is only a reading-time estimate, but once a
      // document-anchored take OWNS the timeline — a narration recording, or
      // presenter-driven slide timings — the filler shifts every later slide
      // off the audio. A take's schedule wins over decoration.
      const narrationOwnsTimeline = (contentDoc.documentMedia ?? []).some(
        (clip) => clip.anchor === 'document',
      );
      return {
        contentDoc,
        playerDoc: buildPreviewDoc(contentDoc, {
          documentTitle,
          interleaveImages: !narrationOwnsTimeline,
        }),
      };
    };
    const commit = (next: PreviewProjection) => {
      setProjection((previous) => preserveEquivalentAudio(previous, next));
    };

    if (workspaceContainer) {
      let cancelled = false;
      const immediate = build(doc);
      resolveAudioMapping(doc, workspaceContainer)
        // Data-reference previews resolve after audio (independent steps;
        // resolveDataPreviews falls back to its input on any failure).
        .then((audioDoc) => resolveDataPreviews(audioDoc, workspaceContainer))
        .then(
          (resolvedDoc) => {
            if (!cancelled) commit(build(resolvedDoc));
          },
          () => {
            // Fall back to the immediate projection if optional audio discovery
            // fails. Consume the rejection rather than leaking it.
            if (!cancelled) commit(immediate);
          },
        );
      // Audio discovery is authoritative for workspace previews. On first
      // projection show the un-timed build immediately rather than an empty
      // pane; on re-parses keep the previous (narration-timed) projection on
      // screen until discovery lands. Committing the un-timed build here made
      // every timeline edit double-jump: raw sequential geometry for a beat,
      // then the narration-timed layout snapping in. Retaining the previous
      // projection whole also keeps the resolved audio track, so a transient
      // synthetic track cannot rewind the player. The success/failure branch
      // above commits the authoritative next projection.
      setProjection((previous) => previous ?? immediate);
      return () => {
        cancelled = true;
      };
    }

    commit(build(doc));
  }, [doc, transformStyle, workspaceContainer, documentTitle, mediaRevision]);

  return projection;
}
