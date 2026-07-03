/**
 * BlockPreviewPanel
 *
 * A large, live preview of the active block, shown to the right of the
 * block-at-a-time / timeline editing card when "Show block previews" is on.
 * In document mode that toggle drives the {@link InlinePreviewGutter} (a
 * column of small cards aligned to headings); in card mode there's only one
 * block in view, so a single full-size preview reads better than a gutter.
 *
 * Reuses the shared preview pipeline (`resolveBlockVisual` → `BlockRenderer`)
 * so the frame matches the slideshow and the timeline thumbnails exactly,
 * honoring the active theme and viewport from the preview settings.
 */

import { useMemo } from 'react';
import type { ViewportConfig } from '@bendyline/squisq/schemas';
import { VIEWPORT_PRESETS } from '@bendyline/squisq/schemas';
import { flattenBlocks, DEFAULT_THEME } from '@bendyline/squisq/doc';
import { useEditorContext } from './EditorContext';
import { usePreviewSettingsOptional } from './PreviewControls';
import { BlockThumbnail } from './TimelineBlockPreview';
import { resolveBlockVisual } from './resolveBlockVisual';

export interface BlockPreviewPanelProps {
  basePath?: string;
}

export function BlockPreviewPanel({ basePath = '/' }: BlockPreviewPanelProps) {
  const { doc, activeBlockStartLine, mediaProvider } = useEditorContext();
  const previewSettings = usePreviewSettingsOptional();
  const theme = previewSettings?.activeTheme ?? DEFAULT_THEME;
  const viewport: ViewportConfig = previewSettings?.activeViewport ?? VIEWPORT_PRESETS.landscape;

  // The block the card editor is scoped to — matched by its heading's source
  // line (same key the timeline + outline use), falling back to the first
  // block (e.g. when a heading-less preamble is active).
  const block = useMemo(() => {
    if (!doc) return null;
    const blocks = flattenBlocks(doc.blocks);
    if (blocks.length === 0) return null;
    return (
      blocks.find((b) => b.sourceHeading?.position?.start.line === activeBlockStartLine) ??
      blocks[0]
    );
  }, [doc, activeBlockStartLine]);

  const visual = useMemo(
    () => (doc && block ? resolveBlockVisual(doc, block, theme, viewport) : null),
    [doc, block, theme, viewport],
  );

  if (!visual) return null;

  return (
    <div className="squisq-block-preview-panel" data-testid="block-preview-panel" aria-hidden>
      <div
        className="squisq-block-preview-frame"
        style={{ aspectRatio: `${viewport.width} / ${viewport.height}` }}
      >
        <BlockThumbnail
          visual={visual}
          viewport={viewport}
          basePath={basePath}
          mediaProvider={mediaProvider}
        />
      </div>
    </div>
  );
}
