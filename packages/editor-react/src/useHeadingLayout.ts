/**
 * useHeadingLayout
 *
 * Shared positioning hook for the editor gutters (`OutlinePanel` and
 * `InlinePreviewGutter`). Each gutter needs to know:
 *   - where every heading sits vertically inside the wrapper
 *   - where the editor "page" edges sit horizontally
 *   - how to scroll the editor to a particular heading
 *
 * Two backends, picked from `EditorContext.activeView`:
 *   - **wysiwyg** — query DOM headings inside `.squisq-wysiwyg-container`,
 *     measure with `getBoundingClientRect`, scroll via `scrollIntoView`.
 *     Live updates via `ResizeObserver` + `MutationObserver`.
 *   - **raw** — walk `doc.blocks`, derive each heading's line number from
 *     `MarkdownHeading.position.start.line`, ask Monaco for the line's
 *     pixel offset via `getTopForLineNumber`, scroll via
 *     `revealLineInCenterIfOutsideViewport` + `setPosition`. Live updates
 *     via `onDidScrollChange` + `onDidChangeModelContent`.
 *
 * Both backends produce coordinates in the *wrapper's* reference frame
 * (i.e., `.squisq-editor-with-gutter`), so the rendering layers — cards,
 * extent bars, outline rows — don't care which editor is active.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { Block } from '@bendyline/squisq/schemas';
import { flattenBlocks, hasTemplate } from '@bendyline/squisq/doc';
import { useEditorContext } from './EditorContext';

export interface HeadingLayoutEntry {
  /** The block (heading-rooted unit) this entry represents. */
  block: Block;
  /** Heading top, in px relative to the wrapper's top edge. */
  top: number;
  /** Where this block ends — the next heading's top, or the editor bottom. */
  bottom: number;
  /** True when the heading has a recognised template annotation. */
  annotated: boolean;
}

export interface HeadingLayout {
  /** All headings, in document order. */
  entries: HeadingLayoutEntry[];
  /** Editor page's left/right edges, in px relative to the wrapper. */
  pageEdges: { left: number; right: number } | null;
  /** Scroll the active editor to bring the block's heading into view. */
  scrollToBlock: (block: Block) => void;
  /** True once a measurement has produced numbers (avoids flicker on mount). */
  ready: boolean;
}

/**
 * @param refInsideWrapper — any DOM ref under `.squisq-editor-with-gutter`.
 *        The hook walks up to find the wrapper.
 */
export function useHeadingLayout(
  refInsideWrapper: RefObject<HTMLElement | null>,
): HeadingLayout {
  const { doc, activeView, monacoEditor, tiptapEditor } = useEditorContext();

  const flatBlocks = useMemo(() => (doc ? flattenBlocks(doc.blocks) : []), [doc]);

  const [entries, setEntries] = useState<HeadingLayoutEntry[]>([]);
  const [pageEdges, setPageEdges] = useState<{ left: number; right: number } | null>(null);

  // ── WYSIWYG backend ────────────────────────────────────────────────

  useEffect(() => {
    if (activeView !== 'wysiwyg') return;
    const node = refInsideWrapper.current;
    if (!node) return;
    const wrapper = findWrapper(node);
    if (!wrapper) return;
    const wysiwygContainer = wrapper.querySelector<HTMLElement>('.squisq-wysiwyg-container');
    if (!wysiwygContainer) return;

    let raf = 0;
    const recompute = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const headings = Array.from(
          wysiwygContainer.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'),
        );
        const wrapperRect = wrapper.getBoundingClientRect();
        const editorRect = wysiwygContainer.getBoundingClientRect();
        const next: HeadingLayoutEntry[] = [];
        flatBlocks.forEach((block, i) => {
          const h = headings[i];
          if (!h) return;
          const top = h.getBoundingClientRect().top - wrapperRect.top;
          const nextH = headings[i + 1];
          const bottom = nextH
            ? nextH.getBoundingClientRect().top - wrapperRect.top
            : editorRect.bottom - wrapperRect.top;
          next.push({
            block,
            top,
            bottom,
            annotated: !!h.getAttribute('data-template'),
          });
        });
        setEntries((prev) => (sameEntries(prev, next) ? prev : next));

        // Page edges — anchor to the .squisq-wysiwyg-editor (the centered "page").
        const page = wysiwygContainer.querySelector<HTMLElement>('.squisq-wysiwyg-editor');
        if (page) {
          const pageRect = page.getBoundingClientRect();
          const left = pageRect.left - wrapperRect.left;
          const right = pageRect.right - wrapperRect.left;
          setPageEdges((prev) =>
            prev != null && Math.abs(prev.left - left) < 0.5 && Math.abs(prev.right - right) < 0.5
              ? prev
              : { left, right },
          );
        }
      });
    };

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(wysiwygContainer);
    const editorSurface = wysiwygContainer.querySelector('.squisq-wysiwyg-editor');
    if (editorSurface) ro.observe(editorSurface);
    const mo = new MutationObserver(recompute);
    mo.observe(wysiwygContainer, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['data-template', 'data-template-params'],
    });
    wysiwygContainer.addEventListener('scroll', recompute, { passive: true });
    window.addEventListener('resize', recompute);
    const settle = window.setTimeout(recompute, 250);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(settle);
      ro.disconnect();
      mo.disconnect();
      wysiwygContainer.removeEventListener('scroll', recompute);
      window.removeEventListener('resize', recompute);
    };
  }, [activeView, flatBlocks, refInsideWrapper]);

  // ── Raw (Monaco) backend ───────────────────────────────────────────

  useEffect(() => {
    if (activeView !== 'raw') return;
    if (!monacoEditor) return;
    const node = refInsideWrapper.current;
    if (!node) return;
    const wrapper = findWrapper(node);
    if (!wrapper) return;

    let raf = 0;
    const recompute = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const wrapperRect = wrapper.getBoundingClientRect();
        const monacoRoot = monacoEditor.getDomNode() as HTMLElement | null;
        if (!monacoRoot) return;
        const monacoRect = monacoRoot.getBoundingClientRect();
        // Y of the editor's content top in wrapper coordinates.
        const monacoTop = monacoRect.top - wrapperRect.top;
        const scrollTop = monacoEditor.getScrollTop();

        const layoutInfo = monacoEditor.getLayoutInfo();
        const next: HeadingLayoutEntry[] = [];
        flatBlocks.forEach((block, i) => {
          const line = block.sourceHeading?.position?.start.line;
          if (typeof line !== 'number') return;
          const lineTop = monacoEditor.getTopForLineNumber(line) - scrollTop + monacoTop;
          // Bottom = next block's top, or the visible bottom of the editor.
          const nextBlock = flatBlocks[i + 1];
          const nextLine = nextBlock?.sourceHeading?.position?.start.line;
          const bottom =
            typeof nextLine === 'number'
              ? monacoEditor.getTopForLineNumber(nextLine) - scrollTop + monacoTop
              : monacoTop + layoutInfo.height;
          const tplName = block.sourceHeading?.templateAnnotation?.template;
          next.push({
            block,
            top: lineTop,
            bottom,
            annotated: !!tplName && hasTemplate(tplName),
          });
        });
        setEntries((prev) => (sameEntries(prev, next) ? prev : next));

        // Page edges — Monaco's editor area extends to its container's
        // box edges; treat the whole editor as the "page".
        const left = monacoRect.left - wrapperRect.left;
        const right = monacoRect.right - wrapperRect.left;
        setPageEdges((prev) =>
          prev != null && Math.abs(prev.left - left) < 0.5 && Math.abs(prev.right - right) < 0.5
            ? prev
            : { left, right },
        );
      });
    };

    recompute();
    const scrollSub = monacoEditor.onDidScrollChange(recompute);
    const contentSub = monacoEditor.onDidChangeModelContent(recompute);
    const layoutSub = monacoEditor.onDidLayoutChange(recompute);
    const ro = new ResizeObserver(recompute);
    const monacoRoot = monacoEditor.getDomNode();
    if (monacoRoot) ro.observe(monacoRoot);
    window.addEventListener('resize', recompute);
    const settle = window.setTimeout(recompute, 250);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(settle);
      scrollSub.dispose();
      contentSub.dispose();
      layoutSub.dispose();
      ro.disconnect();
      window.removeEventListener('resize', recompute);
    };
  }, [activeView, monacoEditor, flatBlocks, refInsideWrapper]);

  // Reset edges when the active view changes — the previous view's
  // measurements don't carry over to the next.
  useEffect(() => {
    setEntries([]);
    setPageEdges(null);
  }, [activeView]);

  // ── scrollToBlock ──────────────────────────────────────────────────

  const scrollToBlock = useCallback(
    (block: Block) => {
      if (activeView === 'wysiwyg') {
        const node = refInsideWrapper.current;
        const wrapper = node ? findWrapper(node) : null;
        const wysiwygContainer = wrapper?.querySelector<HTMLElement>('.squisq-wysiwyg-container');
        if (!wysiwygContainer) return;
        const headings = wysiwygContainer.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6');
        const index = flatBlocks.findIndex((b) => b.id === block.id);
        if (index < 0 || index >= headings.length) return;
        headings[index].scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (tiptapEditor) {
          try {
            tiptapEditor.chain().focus().run();
          } catch {
            // ignore
          }
        }
        return;
      }
      if (activeView === 'raw' && monacoEditor) {
        const line = block.sourceHeading?.position?.start.line;
        if (typeof line !== 'number') return;
        monacoEditor.revealLineInCenter(line);
        monacoEditor.setPosition({ lineNumber: line, column: 1 });
        monacoEditor.focus();
      }
    },
    [activeView, flatBlocks, monacoEditor, refInsideWrapper, tiptapEditor],
  );

  return {
    entries,
    pageEdges,
    scrollToBlock,
    ready: entries.length > 0 || pageEdges != null,
  };
}

// ── Helpers ────────────────────────────────────────────────────────

function findWrapper(node: HTMLElement): HTMLElement | null {
  let cur: HTMLElement | null = node.parentElement;
  while (cur) {
    if (cur.classList.contains('squisq-editor-with-gutter')) return cur;
    cur = cur.parentElement;
  }
  // Fallback: immediate parent (during transitional renames).
  return node.parentElement;
}

function sameEntries(a: HeadingLayoutEntry[], b: HeadingLayoutEntry[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.block.id !== y.block.id) return false;
    if (x.annotated !== y.annotated) return false;
    if (Math.abs(x.top - y.top) > 0.5) return false;
    if (Math.abs(x.bottom - y.bottom) > 0.5) return false;
  }
  return true;
}
