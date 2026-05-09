/**
 * OutlinePanel
 *
 * Left-side companion to the InlinePreviewGutter. Renders a hierarchical
 * tree of the document's headings (h1 → h2 → h3 …) so the structure is
 * graspable at a glance and the user can jump to any section. Works in
 * BOTH the WYSIWYG and Markdown editor views — view-specific positioning
 * lives in `useHeadingLayout`.
 */

import { type CSSProperties, useRef } from 'react';
import type { Block } from '@bendyline/squisq/schemas';
import { hasTemplate } from '@bendyline/squisq/doc';
import { extractPlainText } from '@bendyline/squisq/markdown';
import { useEditorContext } from './EditorContext';
import { templateLabel } from './TemplatePicker';
import { useHeadingLayout } from './useHeadingLayout';

export interface OutlinePanelProps {
  /** Width of the pane in pixels (default: 240). */
  width?: number;
  /** Optional CSS class for the outer container. */
  className?: string;
}

export function OutlinePanel({ width = 240, className }: OutlinePanelProps) {
  const { doc } = useEditorContext();
  const paneRef = useRef<HTMLElement | null>(null);
  const { scrollToBlock } = useHeadingLayout(paneRef);

  const isEmpty = !doc || doc.blocks.length === 0 || !hasAnyHeading(doc.blocks);
  const paneStyle: CSSProperties = {
    width: `${width}px`,
    flex: `0 0 ${width}px`,
    overflow: 'auto',
  };

  return (
    <aside
      ref={paneRef}
      className={`squisq-outline${className ? ` ${className}` : ''}`}
      style={paneStyle}
      data-testid="outline-panel"
      aria-label="Document outline"
    >
      {isEmpty ? (
        <div className="squisq-outline-empty">
          <p>Add a heading to populate the outline.</p>
        </div>
      ) : (
        <ul className="squisq-outline-tree" role="tree">
          {doc!.blocks.map((b) => (
            <OutlineNode key={b.id} block={b} onSelect={scrollToBlock} />
          ))}
        </ul>
      )}
    </aside>
  );
}

// ── Subcomponents ──────────────────────────────────────────────────

function OutlineNode({ block, onSelect }: { block: Block; onSelect: (b: Block) => void }) {
  const heading = block.sourceHeading;
  const depth = heading?.depth ?? 1;
  const text = heading ? extractPlainText(heading).trim() : '';
  const annotation = heading?.templateAnnotation;
  const tplName = annotation?.template;
  const showChip = tplName && hasTemplate(tplName);

  return (
    <li className="squisq-outline-item" role="treeitem">
      <button
        type="button"
        className={`squisq-outline-row squisq-outline-row--depth-${depth}`}
        onClick={() => onSelect(block)}
        title={text || '(empty heading)'}
      >
        <span className="squisq-outline-row-text">{text || '(untitled)'}</span>
        {showChip && (
          <span className="squisq-outline-template-chip">{templateLabel(tplName!)}</span>
        )}
      </button>
      {block.children && block.children.length > 0 && (
        <ul className="squisq-outline-tree">
          {block.children.map((child) => (
            <OutlineNode key={child.id} block={child} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </li>
  );
}

// ── Helpers ────────────────────────────────────────────────────────

function hasAnyHeading(blocks: Block[]): boolean {
  for (const b of blocks) {
    if (b.sourceHeading) return true;
    if (b.children && hasAnyHeading(b.children)) return true;
  }
  return false;
}
