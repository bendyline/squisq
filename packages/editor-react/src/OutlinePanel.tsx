/**
 * OutlinePanel
 *
 * Left-side companion to the InlinePreviewGutter. Renders a hierarchical
 * tree of the document's headings (h1 → h2 → h3 …) so the structure is
 * graspable at a glance and the user can jump to any section. Works in
 * BOTH the WYSIWYG and Markdown editor views — view-specific positioning
 * lives in `useHeadingLayout`.
 */

import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Block } from '@bendyline/squisq/schemas';
import { flattenBlocks, hasTemplate } from '@bendyline/squisq/doc';
import { extractPlainText } from '@bendyline/squisq/markdown';
import { useEditorContext } from './EditorContext';
import { templateLabel } from './TemplatePicker';
import { useHeadingLayout } from './useHeadingLayout';
import { usePreviewSettingsOptional } from './PreviewControls';

export interface OutlinePanelProps {
  /** Width of the pane in pixels (default: 240). */
  width?: number;
  /** Optional CSS class for the outer container. */
  className?: string;
}

export function OutlinePanel({ width = 240, className }: OutlinePanelProps) {
  const { doc, markdownSource, setMarkdownSource } = useEditorContext();
  const paneRef = useRef<HTMLElement | null>(null);
  const { scrollToBlock } = useHeadingLayout(paneRef);
  const activeBlockId = useActiveOutlineBlockId();

  // Promote / demote the row's heading by rewriting just the `#` prefix
  // on the heading line. Falls through when the new depth would leave the
  // legal H1–H6 range, so the buttons disable themselves at the edges.
  // Both editor surfaces resync from `markdownSource` automatically.
  const changeHeadingLevel = useCallback(
    (block: Block, delta: number) => {
      const line = block.sourceHeading?.position?.start.line;
      if (typeof line !== 'number') return;
      const next = bumpHeadingLevelInSource(markdownSource, line, delta);
      if (next != null) setMarkdownSource(next);
    },
    [markdownSource, setMarkdownSource],
  );

  // Inherit the active document theme's primary color so the current-row
  // highlight and template-name chips match the rest of the editor's
  // accent palette (e.g. warm-earth's terracotta) instead of the
  // hard-coded purple fallback. Falls through to the CSS defaults when
  // no PreviewSettingsProvider is mounted.
  const previewSettings = usePreviewSettingsOptional();
  const accentColor = previewSettings?.activeTheme?.colors?.primary;

  const isEmpty = !doc || doc.blocks.length === 0 || !hasAnyHeading(doc.blocks);
  const paneStyle: CSSProperties = {
    width: `${width}px`,
    flex: `0 0 ${width}px`,
    overflow: 'auto',
    ...(accentColor
      ? ({ ['--squisq-outline-accent' as string]: accentColor } as CSSProperties)
      : {}),
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
            <OutlineNode
              key={b.id}
              block={b}
              activeBlockId={activeBlockId}
              onSelect={scrollToBlock}
              onChangeLevel={changeHeadingLevel}
            />
          ))}
        </ul>
      )}
    </aside>
  );
}

// ── Subcomponents ──────────────────────────────────────────────────

function OutlineNode({
  block,
  activeBlockId,
  onSelect,
  onChangeLevel,
}: {
  block: Block;
  activeBlockId: string | null;
  onSelect: (b: Block) => void;
  onChangeLevel: (block: Block, delta: number) => void;
}) {
  const heading = block.sourceHeading;
  const depth = heading?.depth ?? 1;
  const text = heading ? extractPlainText(heading).trim() : '';
  const annotation = heading?.templateAnnotation;
  const tplName = annotation?.template;
  const showChip = tplName && hasTemplate(tplName);
  const isActive = block.id === activeBlockId;
  const canPromote = !!heading && depth > 1;
  const canDemote = !!heading && depth < 6;

  return (
    <li className="squisq-outline-item" role="treeitem" aria-current={isActive || undefined}>
      <div className="squisq-outline-row-wrap">
        <button
          type="button"
          className={`squisq-outline-row squisq-outline-row--depth-${depth}${
            isActive ? ' squisq-outline-row--current' : ''
          }`}
          onClick={() => onSelect(block)}
          title={text || '(empty heading)'}
        >
          <span className="squisq-outline-row-text">{text || '(untitled)'}</span>
          {showChip && (
            <span className="squisq-outline-template-chip">{templateLabel(tplName!)}</span>
          )}
        </button>
        {heading && (
          <span className="squisq-outline-row-actions">
            <button
              type="button"
              className="squisq-outline-row-arrow"
              aria-label={`Promote heading (currently H${depth})`}
              title="Promote heading"
              disabled={!canPromote}
              onClick={() => onChangeLevel(block, -1)}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <path
                  d="M6.5 2.5 L3 5 L6.5 7.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </svg>
            </button>
            <button
              type="button"
              className="squisq-outline-row-arrow"
              aria-label={`Demote heading (currently H${depth})`}
              title="Demote heading"
              disabled={!canDemote}
              onClick={() => onChangeLevel(block, +1)}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <path
                  d="M3.5 2.5 L7 5 L3.5 7.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </svg>
            </button>
          </span>
        )}
      </div>
      {block.children && block.children.length > 0 && (
        <ul className="squisq-outline-tree">
          {block.children.map((child) => (
            <OutlineNode
              key={child.id}
              block={child}
              activeBlockId={activeBlockId}
              onSelect={onSelect}
              onChangeLevel={onChangeLevel}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

// ── Active-block tracking ──────────────────────────────────────────

/**
 * Tracks which heading the user's cursor is currently inside (or most
 * recently passed). In WYSIWYG mode this watches Tiptap's selection;
 * in Raw mode it watches Monaco's cursor line. The Preview surface has
 * no cursor concept and reports `null`.
 *
 * The lookup mirrors the heading-pairing logic in `useHeadingLayout`:
 * the Nth heading in document order maps to `flattenBlocks(doc.blocks)[N]`.
 */
function useActiveOutlineBlockId(): string | null {
  const { doc, activeView, tiptapEditor, monacoEditor } = useEditorContext();
  const flatBlocks = useMemo(() => (doc ? flattenBlocks(doc.blocks) : []), [doc]);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Reset whenever the active surface changes — a stale highlight from
  // the previous view would mislead the user before the new surface's
  // cursor handler runs.
  useEffect(() => {
    setActiveId(null);
  }, [activeView]);

  useEffect(() => {
    if (activeView !== 'wysiwyg' || !tiptapEditor) return;

    const update = () => {
      const { from } = tiptapEditor.state.selection;
      let lastIndex = -1;
      let seen = -1;
      tiptapEditor.state.doc.forEach((node, offset) => {
        if (node.type.name !== 'heading') return;
        seen += 1;
        if (offset <= from) lastIndex = seen;
      });
      const block = lastIndex >= 0 ? flatBlocks[lastIndex] : null;
      setActiveId(block?.id ?? null);
    };

    update();
    tiptapEditor.on('selectionUpdate', update);
    tiptapEditor.on('update', update);
    return () => {
      tiptapEditor.off('selectionUpdate', update);
      tiptapEditor.off('update', update);
    };
  }, [activeView, tiptapEditor, flatBlocks]);

  useEffect(() => {
    if (activeView !== 'raw' || !monacoEditor) return;

    const update = () => {
      const line = monacoEditor.getPosition()?.lineNumber;
      if (typeof line !== 'number') {
        setActiveId(null);
        return;
      }
      let lastIndex = -1;
      flatBlocks.forEach((b, i) => {
        const headingLine = b.sourceHeading?.position?.start.line;
        if (typeof headingLine === 'number' && headingLine <= line) lastIndex = i;
      });
      const block = lastIndex >= 0 ? flatBlocks[lastIndex] : null;
      setActiveId(block?.id ?? null);
    };

    update();
    const sub = monacoEditor.onDidChangeCursorPosition(update);
    return () => sub.dispose();
  }, [activeView, monacoEditor, flatBlocks]);

  return activeId;
}

// ── Helpers ────────────────────────────────────────────────────────

function hasAnyHeading(blocks: Block[]): boolean {
  for (const b of blocks) {
    if (b.sourceHeading) return true;
    if (b.children && hasAnyHeading(b.children)) return true;
  }
  return false;
}

/**
 * Rewrites just the leading `#` run on the given 1-based line, shifting
 * the heading depth by `delta`. Returns `null` when the line isn't an
 * ATX heading or the resulting depth would fall outside 1–6. Leaves the
 * rest of the line (including any `{[template]}` annotation) untouched.
 */
function bumpHeadingLevelInSource(source: string, line: number, delta: number): string | null {
  const lines = source.split('\n');
  const idx = line - 1;
  if (idx < 0 || idx >= lines.length) return null;
  const original = lines[idx];
  const match = original.match(/^(#{1,6})(\s|$)/);
  if (!match) return null;
  const currentDepth = match[1].length;
  const newDepth = currentDepth + delta;
  if (newDepth < 1 || newDepth > 6) return null;
  lines[idx] = '#'.repeat(newDepth) + original.slice(currentDepth);
  return lines.join('\n');
}
