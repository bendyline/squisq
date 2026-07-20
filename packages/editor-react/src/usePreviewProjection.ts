/**
 * Shared player-document projection used by the main Video preview and the
 * Timeline composition monitor. Keeping this in one hook guarantees both
 * surfaces apply narration timing, transforms, and player materialization in
 * the same order.
 */

import { useEffect, useState } from 'react';
import type { Doc } from '@bendyline/squisq/schemas';
import { resolveAudioMapping } from '@bendyline/squisq/doc';
import { applyTransform } from '@bendyline/squisq/transform';
import type { ContentContainer } from '@bendyline/squisq/storage';
import { buildPreviewDoc } from './buildPreviewDoc';

export interface PreviewProjection {
  /** Transformed content model shared by Page and Document. */
  contentDoc: Doc;
  /** Flattened/timed player model shared by Slideshow and Video. */
  playerDoc: Doc;
}

export function usePreviewProjection(
  doc: Doc | null,
  transformStyle: string,
  workspaceContainer?: ContentContainer | null,
  documentTitle?: string,
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
      return { contentDoc, playerDoc: buildPreviewDoc(contentDoc, { documentTitle }) };
    };

    if (workspaceContainer) {
      let cancelled = false;
      resolveAudioMapping(doc, workspaceContainer).then(
        (audioDoc) => {
          if (!cancelled) setProjection(build(audioDoc));
        },
        () => {
          // The immediate projection remains valid if optional audio discovery
          // fails. Consume the rejection rather than leaking it.
        },
      );
      setProjection(build(doc));
      return () => {
        cancelled = true;
      };
    }

    setProjection(build(doc));
  }, [doc, transformStyle, workspaceContainer, documentTitle]);

  return projection;
}
