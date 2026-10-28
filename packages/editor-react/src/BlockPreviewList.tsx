/**
 * BlockPreviewList
 *
 * The navigation sheet's block previews: the same cards as the inline gutter,
 * stacked in one scrolling column instead of aligned beside their headings,
 * because a narrow editor has no room beside them. Choosing a card moves the
 * editor to that block.
 */

import { useCallback, useRef } from 'react';
import type { ViewportConfig, MediaProvider } from '@bendyline/squisq/schemas';
import { VIEWPORT_PRESETS } from '@bendyline/squisq/schemas';
import { flattenBlocks } from '@bendyline/squisq/doc';
import { BlockRenderer, MediaContext } from '@bendyline/squisq-react';
import { useEditorContext } from './EditorContext';
import { templateLabel } from './TemplatePicker';
import { blockAnchors, blockStartLine } from './useHeadingLayout';
import { useBlockPreviewItems, type BlockPreviewItem } from './useBlockPreviewItems';

export interface BlockPreviewListProps {
  /** Base path for resolving media URLs in card thumbnails. */
  basePath?: string;
  /** Viewport used to render each card (default: landscape preset). */
  viewport?: ViewportConfig;
  /** Resolves relative image sources inside the cards. */
  mediaProvider?: MediaProvider | null;
  /** Called after choosing a card has moved the editor to that block. */
  onNavigate?: () => void;
}

export function BlockPreviewList({
  basePath = '/',
  viewport = VIEWPORT_PRESETS.landscape,
  mediaProvider = null,
  onNavigate,
}: BlockPreviewListProps) {
  const { doc, activeView, layoutMode, goToBlockByLine, monacoEditor } = useEditorContext();
  const items = useBlockPreviewItems(viewport);
  const listRef = useRef<HTMLUListElement | null>(null);

  // Focus stays put after a jump, as in the sheet's outline: moving it into
  // the editor would raise the on-screen keyboard over the block just chosen.
  const handleSelect = useCallback(
    (item: BlockPreviewItem) => {
      const line = blockStartLine(item.sourceBlock);
      if (layoutMode === 'block') {
        if (typeof line !== 'number') return;
        goToBlockByLine(line);
      } else if (activeView === 'wysiwyg') {
        const container = listRef.current
          ?.closest('.squisq-editor-with-gutter')
          ?.querySelector<HTMLElement>('.squisq-wysiwyg-container');
        if (!container || !doc) return;
        const blocks = flattenBlocks(doc.blocks);
        const index = blocks.findIndex((block) => block.id === item.sourceBlock.id);
        const anchor = index >= 0 ? blockAnchors(blocks, container)[index] : null;
        if (!anchor) return;
        anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (activeView === 'raw' && monacoEditor) {
        if (typeof line !== 'number') return;
        monacoEditor.revealLineInCenter(line);
        monacoEditor.setPosition({ lineNumber: line, column: 1 });
      } else {
        return;
      }
      onNavigate?.();
    },
    [activeView, doc, goToBlockByLine, layoutMode, monacoEditor, onNavigate],
  );

  if (items.length === 0) {
    return (
      <div className="squisq-preview-list-empty">
        <p>Add some content to see block previews.</p>
      </div>
    );
  }

  return (
    <MediaContext.Provider value={mediaProvider}>
      <ul ref={listRef} className="squisq-preview-list" aria-label="Block previews">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className="squisq-preview-list-card"
              data-template={item.template}
              onClick={() => handleSelect(item)}
            >
              <span className="squisq-inline-preview-card-label">
                <span className="squisq-inline-preview-card-template">
                  {templateLabel(item.template)}
                </span>
                {item.headingText && (
                  <>
                    <span className="squisq-inline-preview-card-sep" aria-hidden="true">
                      —
                    </span>
                    <span className="squisq-inline-preview-card-title">{item.headingText}</span>
                  </>
                )}
              </span>
              <span
                className="squisq-inline-preview-card-svg"
                aria-hidden="true"
                style={{ aspectRatio: `${viewport.width} / ${viewport.height}` }}
              >
                <BlockRenderer
                  block={item.block}
                  buildPlayback="all"
                  blockTime={0}
                  basePath={basePath}
                  viewport={viewport}
                />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </MediaContext.Provider>
  );
}
