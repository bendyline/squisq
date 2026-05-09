/**
 * OutlinePanel
 *
 * Left-side companion to the InlinePreviewGutter. Renders a hierarchical
 * tree of the document's headings (h1 → h2 → h3 …) so the structure is
 * graspable at a glance and the user can jump to any section.
 *
 * Implementation notes:
 * - Reads `doc.blocks` from EditorContext. `markdownToDoc` already nests
 *   sub-headings under their parent block, so we walk the tree directly
 *   instead of rebuilding from a flat heading list.
 * - Click-to-scroll uses the same ordinal-index pairing as the
 *   InlinePreviewGutter — the n-th annotated block matches the n-th
 *   `[data-template]` heading. For the outline we use the broader set
 *   `h1, h2, h3, h4, h5, h6` and pair to the flat block order from
 *   `flattenBlocks`.
 * - Anchored to the editor's measured `pageLeft` so it hugs the page
 *   edge rather than floating at the wrapper's far left. Falls back to
 *   `left: 0` until the page has been measured (mirrors the right
 *   gutter's `pageRight == null` fallback).
 */

import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Block } from '@bendyline/squisq/schemas';
import { flattenBlocks, hasTemplate } from '@bendyline/squisq/doc';
import { extractPlainText } from '@bendyline/squisq/markdown';
import { useEditorContext } from './EditorContext';
import { templateLabel } from './TemplatePicker';

export interface OutlinePanelProps {
  /** Width of the pane in pixels (default: 240). */
  width?: number;
  /** Optional CSS class for the outer container. */
  className?: string;
}

export function OutlinePanel({ width = 240, className }: OutlinePanelProps) {
  const { doc, tiptapEditor } = useEditorContext();
  const paneRef = useRef<HTMLElement | null>(null);
  // Where the editor's centered "page" starts, in px relative to the
  // wrapper. The outline pane sits flush against this edge so its right
  // border meets the page's left edge.
  const [pageLeft, setPageLeft] = useState<number | null>(null);

  // Pre-compute the flat block order — used for click-to-scroll's ordinal
  // index lookup. Tied to `doc.blocks` only; the helper handles nesting.
  const flatBlocks = useMemo(() => (doc ? flattenBlocks(doc.blocks) : []), [doc]);

  const handleSelect = useCallback(
    (block: Block) => {
      const wysiwygContainer =
        paneRef.current?.parentElement?.querySelector<HTMLElement>('.squisq-wysiwyg-container');
      if (!wysiwygContainer) return;
      const headings = wysiwygContainer.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6');
      const index = flatBlocks.findIndex((b) => b.id === block.id);
      if (index < 0 || index >= headings.length) return;
      const target = headings[index];
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // Move the cursor into the heading so subsequent typing lands there.
      // Best-effort; harmless when the editor isn't ready or the position
      // can't be inferred.
      if (tiptapEditor) {
        try {
          tiptapEditor.chain().focus().run();
        } catch {
          // ignore — focus/scroll-only navigation is still useful
        }
      }
    },
    [flatBlocks, tiptapEditor],
  );

  // Track the editor's left page edge so the pane hugs it (mirrors the
  // right gutter's `pageRight` measurement). Re-runs on resize, scroll,
  // and DOM mutations.
  useLayoutEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    const wrapper = pane.parentElement;
    if (!wrapper) return;
    const wysiwygContainer = wrapper.querySelector<HTMLElement>('.squisq-wysiwyg-container');
    if (!wysiwygContainer) return;

    let raf = 0;
    const recompute = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const page = wysiwygContainer.querySelector<HTMLElement>('.squisq-wysiwyg-editor');
        if (!page) return;
        const wrapperRect = wrapper.getBoundingClientRect();
        const pageRect = page.getBoundingClientRect();
        const offset = pageRect.left - wrapperRect.left;
        setPageLeft((prev) => (prev != null && Math.abs(prev - offset) < 0.5 ? prev : offset));
      });
    };

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(wysiwygContainer);
    const editorSurface = wysiwygContainer.querySelector('.squisq-wysiwyg-editor');
    if (editorSurface) ro.observe(editorSurface);
    window.addEventListener('resize', recompute);
    const settleTimer = window.setTimeout(recompute, 250);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(settleTimer);
      ro.disconnect();
      window.removeEventListener('resize', recompute);
    };
  }, []);

  const isEmpty = !doc || doc.blocks.length === 0 || !hasAnyHeading(doc.blocks);
  const paneStyle: CSSProperties = {
    width: `${width}px`,
    overflow: 'auto',
    ...(pageLeft != null
      ? { position: 'absolute', top: 0, bottom: 0, left: Math.max(0, pageLeft - width) }
      : { position: 'absolute', top: 0, bottom: 0, left: 0 }),
    visibility: pageLeft == null ? 'hidden' : 'visible',
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
            <OutlineNode key={b.id} block={b} onSelect={handleSelect} />
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
