/**
 * CanvasSection — the spatial escape hatch of the page rendition.
 *
 * Diagram, tree, timeline, map, drawing, layout, authored-layer blocks,
 * and custom templates are inherently viewport-coordinate SVG content, so
 * they keep rendering through `materializeBlockLayers` + `BlockRenderer` —
 * embedded responsively inside a variable-height page section (intrinsic
 * aspect box with a max-height clamp) instead of a full slide card.
 */

import { useMemo } from 'react';
import type { Block, DocBlock } from '@bendyline/squisq/schemas';
import { materializeBlockLayers } from '@bendyline/squisq/doc';
import type { PageSection } from '@bendyline/squisq/doc';
import { BlockRenderer } from '../BlockRenderer';
import { usePageView } from './PageViewContext';

export interface CanvasSectionProps {
  section: PageSection;
}

export function CanvasSection({ section }: CanvasSectionProps) {
  const { renderContext, basePath, animationsEnabled, theme } = usePageView();
  const media = section.slots.media;
  const canvas = media?.type === 'canvas' ? media : undefined;

  const visualBlock = useMemo(() => {
    if (!canvas) return null;
    const { layers } = materializeBlockLayers(canvas.block as DocBlock, {
      ...renderContext,
      blockIndex: section.index,
    });
    return { ...canvas.block, layers } as Block;
  }, [canvas, renderContext, section.index]);

  if (!canvas || !visualBlock) return null;

  const aspect = canvas.aspect;
  const frame = section.hints?.frame;
  const frameClass =
    frame === 'terminal'
      ? ' squisq-page-canvas--terminal squisq-page-canvas--framed'
      : ' squisq-page-canvas--framed';

  return (
    <div
      className={`squisq-page-canvas${frameClass}`}
      style={{
        aspectRatio: `${aspect.width} / ${aspect.height}`,
        // Clamp tall canvases; derive the width cap from the aspect so a
        // portrait viewport doesn't produce a page-height skyscraper.
        maxHeight: 'min(70vh, 720px)',
        maxWidth: `calc(min(70vh, 720px) * ${(aspect.width / Math.max(1, aspect.height)).toFixed(4)})`,
      }}
    >
      <BlockRenderer
        block={visualBlock}
        blockTime={0}
        basePath={basePath}
        viewport={{ width: aspect.width, height: aspect.height }}
        animationsEnabled={animationsEnabled}
        theme={theme}
      />
    </div>
  );
}
