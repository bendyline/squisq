/**
 * OutlinePanel
 *
 * Left-side companion to the InlinePreviewGutter. Renders a hierarchical
 * tree of the document's headings (h1 → h2 → h3 …) so the structure is
 * graspable at a glance and the user can jump to any section. Works in
 * BOTH the WYSIWYG and Markdown editor views — view-specific positioning
 * lives in `useHeadingLayout`.
 */

import {
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Block } from '@bendyline/squisq/schemas';
import { flattenBlocks, hasTemplate } from '@bendyline/squisq/doc';
import { extractPlainText } from '@bendyline/squisq/markdown';
import { useEditorContext } from './EditorContext';
import { templateLabel } from './TemplatePicker';
import { useHeadingLayout } from './useHeadingLayout';
import { usePreviewSettingsOptional } from './PreviewControls';
import { moveHeadingSectionInSource, type OutlineDropPlacement } from './outlineSource';

/**
 * Responsive default width for the outline pane, used when no fixed `width`
 * (or `--squisq-outline-width`) is supplied: never narrower than 180px, grows
 * with the viewport so it stretches out to fill horizontal space when there's
 * room, and caps at 260px so it never dominates the editor — heading rows
 * ellipsize, so the pane doesn't need to fit the longest title. A viewport
 * unit (rather than a container unit) keeps the pane and the toolbar's
 * view-tabs — which read the same value — resolving to an identical width,
 * so their right edges stay aligned.
 */
export const OUTLINE_RESPONSIVE_WIDTH = 'clamp(180px, 15vw, 260px)';

export interface OutlinePanelProps {
  /**
   * Fixed width of the pane in pixels. When omitted, the pane sizes
   * responsively from `--squisq-outline-width` (falling back to
   * {@link OUTLINE_RESPONSIVE_WIDTH}) so it stretches on wider screens.
   */
  width?: number;
  /** Optional CSS class for the outer container. */
  className?: string;
  /** Disable heading-level changes and section reordering. */
  readOnly?: boolean;
}

interface OutlineSectionRef {
  blockId: string;
  headingLine: number;
  depth: number;
  parentId: string | null;
}

interface ActiveOutlineDrag extends OutlineSectionRef {
  sourceAtStart: string;
}

interface OutlineDropTarget {
  blockId: string;
  placement: OutlineDropPlacement;
}

const OUTLINE_DRAG_MIME = 'application/x-squisq-outline-section';

export function OutlinePanel({ width, className, readOnly = false }: OutlinePanelProps) {
  const {
    doc,
    markdownSource,
    setMarkdownSource,
    isParsing,
    layoutMode,
    goToBlockByLine,
    activeBlockStartLine,
  } = useEditorContext();
  const paneRef = useRef<HTMLElement | null>(null);
  const { scrollToBlock } = useHeadingLayout(paneRef);
  const cursorActiveId = useActiveOutlineBlockId();
  const activeDragRef = useRef<ActiveOutlineDrag | null>(null);
  const [draggedBlockId, setDraggedBlockId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<OutlineDropTarget | null>(null);

  // In block-at-a-time mode there's no live cursor across the whole document
  // (only the active block is mounted), so the highlight follows the card:
  // match the block whose heading begins on the active slice's source line.
  const blockModeActiveId = useMemo(() => {
    if (layoutMode !== 'block' || activeBlockStartLine == null || !doc) return null;
    const match = flattenBlocks(doc.blocks).find(
      (b) => b.sourceHeading?.position?.start.line === activeBlockStartLine,
    );
    return match?.id ?? null;
  }, [layoutMode, activeBlockStartLine, doc]);
  const activeBlockId = layoutMode === 'block' ? blockModeActiveId : cursorActiveId;

  // Clicking a row jumps the card to that block in block mode, or scrolls the
  // editor to it in document mode.
  const handleSelect = useCallback(
    (block: Block) => {
      if (layoutMode === 'block') {
        const line = block.sourceHeading?.position?.start.line;
        if (typeof line === 'number') {
          goToBlockByLine(line);
          return;
        }
      }
      scrollToBlock(block);
    },
    [layoutMode, goToBlockByLine, scrollToBlock],
  );

  // Promote / demote the row's heading by rewriting just the `#` prefix
  // on the heading line. Falls through when the new depth would leave the
  // legal H1–H6 range, so the buttons disable themselves at the edges.
  // Both editor surfaces resync from `markdownSource` automatically.
  const changeHeadingLevel = useCallback(
    (block: Block, delta: number) => {
      if (readOnly || isParsing) return;
      const line = block.sourceHeading?.position?.start.line;
      if (typeof line !== 'number') return;
      const next = bumpHeadingLevelInSource(markdownSource, line, delta);
      if (next != null) setMarkdownSource(next);
    },
    [isParsing, markdownSource, readOnly, setMarkdownSource],
  );

  const clearDragState = useCallback(() => {
    activeDragRef.current = null;
    setDraggedBlockId(null);
    setDropTarget(null);
  }, []);

  const handleDragStart = useCallback(
    (event: ReactDragEvent<HTMLElement>, section: OutlineSectionRef) => {
      if (readOnly || isParsing) {
        event.preventDefault();
        return;
      }

      activeDragRef.current = { ...section, sourceAtStart: markdownSource };
      setDraggedBlockId(section.blockId);
      setDropTarget(null);
      event.dataTransfer.effectAllowed = 'move';
      // Firefox requires a text payload before it will initiate a native drag.
      // The custom type makes the payload identifiable to other Squisq panes;
      // the in-memory ref remains authoritative for this mounted panel.
      event.dataTransfer.setData(OUTLINE_DRAG_MIME, String(section.headingLine));
      event.dataTransfer.setData('text/plain', String(section.headingLine));
    },
    [isParsing, markdownSource, readOnly],
  );

  const handleDragOver = useCallback(
    (event: ReactDragEvent<HTMLElement>, section: OutlineSectionRef) => {
      const dragged = activeDragRef.current;
      if (!dragged) return;

      // Prevent the editor shell's file-drop handler from changing this to a
      // copy operation while an outline section is being moved.
      event.preventDefault();
      event.stopPropagation();

      if (!canDropOnSection(dragged, section) || readOnly || isParsing) {
        event.dataTransfer.dropEffect = 'none';
        setDropTarget(null);
        return;
      }

      const placement = placementForPointer(event);
      event.dataTransfer.dropEffect = 'move';
      setDropTarget((current) =>
        current?.blockId === section.blockId && current.placement === placement
          ? current
          : { blockId: section.blockId, placement },
      );
    },
    [isParsing, readOnly],
  );

  const handleDrop = useCallback(
    (event: ReactDragEvent<HTMLElement>, section: OutlineSectionRef) => {
      const dragged = activeDragRef.current;
      if (!dragged) return;

      event.preventDefault();
      event.stopPropagation();
      const placement = placementForPointer(event);
      const canMove =
        !readOnly &&
        !isParsing &&
        dragged.sourceAtStart === markdownSource &&
        canDropOnSection(dragged, section);
      const next = canMove
        ? moveHeadingSectionInSource(
            markdownSource,
            dragged.headingLine,
            section.headingLine,
            placement,
          )
        : null;

      clearDragState();
      if (next != null) setMarkdownSource(next);
    },
    [clearDragState, isParsing, markdownSource, readOnly, setMarkdownSource],
  );

  // Inherit the active document theme's primary color so the current-row
  // highlight and template-name chips match the rest of the editor's
  // accent palette (e.g. warm-earth's terracotta) instead of the
  // hard-coded purple fallback. Falls through to the CSS defaults when
  // no PreviewSettingsProvider is mounted.
  const previewSettings = usePreviewSettingsOptional();
  const accentColor = previewSettings?.activeTheme?.colors?.primary;

  const isEmpty = !doc || doc.blocks.length === 0 || !hasAnyHeading(doc.blocks);
  // Fixed px when a width is supplied; otherwise size from the shared
  // `--squisq-outline-width` variable (the shell sets it, and the toolbar's
  // view-tabs read the same value so their right edges stay aligned). The
  // clamp fallback lets a standalone OutlinePanel stretch on wide screens too.
  const basis =
    width != null ? `${width}px` : `var(--squisq-outline-width, ${OUTLINE_RESPONSIVE_WIDTH})`;
  const paneStyle: CSSProperties = {
    width: basis,
    flex: `0 0 ${basis}`,
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
              parentId={null}
              activeBlockId={activeBlockId}
              draggedBlockId={draggedBlockId}
              dropTarget={dropTarget}
              mutationsDisabled={readOnly || isParsing}
              onSelect={handleSelect}
              onChangeLevel={changeHeadingLevel}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onDragEnd={clearDragState}
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
  parentId,
  activeBlockId,
  draggedBlockId,
  dropTarget,
  mutationsDisabled,
  onSelect,
  onChangeLevel,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  block: Block;
  parentId: string | null;
  activeBlockId: string | null;
  draggedBlockId: string | null;
  dropTarget: OutlineDropTarget | null;
  mutationsDisabled: boolean;
  onSelect: (b: Block) => void;
  onChangeLevel: (block: Block, delta: number) => void;
  onDragStart: (event: ReactDragEvent<HTMLElement>, section: OutlineSectionRef) => void;
  onDragOver: (event: ReactDragEvent<HTMLElement>, section: OutlineSectionRef) => void;
  onDrop: (event: ReactDragEvent<HTMLElement>, section: OutlineSectionRef) => void;
  onDragEnd: () => void;
}) {
  const heading = block.sourceHeading;
  const depth = heading?.depth ?? 1;
  const headingLine = heading?.position?.start.line;
  const text = heading ? extractPlainText(heading).trim() : '';
  const annotation = heading?.templateAnnotation;
  const tplName = annotation?.template;
  const showChip = tplName && hasTemplate(tplName);
  const isActive = block.id === activeBlockId;
  const canPromote = !!heading && depth > 1;
  const canDemote = !!heading && depth < 6;
  const section =
    heading && typeof headingLine === 'number'
      ? { blockId: block.id, headingLine, depth, parentId }
      : null;
  const canDrag = section != null && !mutationsDisabled;
  const isDragging = block.id === draggedBlockId;
  const dropPlacement = dropTarget?.blockId === block.id ? dropTarget.placement : null;
  const itemClasses = [
    'squisq-outline-item',
    isDragging ? 'squisq-outline-item--dragging' : '',
    dropPlacement ? `squisq-outline-item--drop-${dropPlacement}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <li className={itemClasses} role="treeitem" aria-current={isActive || undefined}>
      <div
        className="squisq-outline-row-wrap"
        onDragOver={section ? (event) => onDragOver(event, section) : undefined}
        onDrop={section ? (event) => onDrop(event, section) : undefined}
      >
        <button
          type="button"
          className={`squisq-outline-row squisq-outline-row--depth-${depth}${
            isActive ? ' squisq-outline-row--current' : ''
          }`}
          onClick={() => onSelect(block)}
          draggable={canDrag}
          aria-grabbed={isDragging || undefined}
          onDragStart={section ? (event) => onDragStart(event, section) : undefined}
          onDragEnd={onDragEnd}
          title={text || '(empty heading)'}
        >
          {canDrag && (
            <span className="squisq-outline-drag-handle" aria-hidden="true">
              <svg width="8" height="12" viewBox="0 0 8 12">
                <circle cx="2" cy="2" r="1" fill="currentColor" />
                <circle cx="6" cy="2" r="1" fill="currentColor" />
                <circle cx="2" cy="6" r="1" fill="currentColor" />
                <circle cx="6" cy="6" r="1" fill="currentColor" />
                <circle cx="2" cy="10" r="1" fill="currentColor" />
                <circle cx="6" cy="10" r="1" fill="currentColor" />
              </svg>
            </span>
          )}
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
              disabled={mutationsDisabled || !canPromote}
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
              disabled={mutationsDisabled || !canDemote}
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
              parentId={block.id}
              activeBlockId={activeBlockId}
              draggedBlockId={draggedBlockId}
              dropTarget={dropTarget}
              mutationsDisabled={mutationsDisabled}
              onSelect={onSelect}
              onChangeLevel={onChangeLevel}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDrop={onDrop}
              onDragEnd={onDragEnd}
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

function canDropOnSection(dragged: OutlineSectionRef, target: OutlineSectionRef): boolean {
  return (
    dragged.blockId !== target.blockId &&
    dragged.depth === target.depth &&
    dragged.parentId === target.parentId
  );
}

function placementForPointer(event: ReactDragEvent<HTMLElement>): OutlineDropPlacement {
  const bounds = event.currentTarget.getBoundingClientRect();
  return event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after';
}

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
