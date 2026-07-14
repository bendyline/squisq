import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { editor as MonacoEditorNs } from 'monaco-editor';
import { useEditorContext } from '../EditorContext';
import { Icon } from '../Icon';
import { updateTiptapFindHighlights } from './FindHighlightExtension';
import { findTextMatches, normalizeFindIndex } from './findModel';

interface HighlightRegistryLike {
  set(name: string, highlight: unknown): void;
  delete(name: string): boolean;
}

interface HighlightConstructorLike {
  new (...ranges: Range[]): unknown;
}

interface PreviewHighlightResult {
  count: number;
  cleanup: () => void;
}

export interface FindToolbarProps {
  onClose: () => void;
}

/** Search controls shown immediately to the right of the Write/Source/Use tabs. */
export function FindToolbar({ onClose }: FindToolbarProps) {
  const { activeView, markdownSource, tiptapEditor, monacoEditor } = useEditorContext();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [matchCount, setMatchCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const reactId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const previewHighlightName = `squisq-find-${reactId}`;
  const previewSelectedName = `${previewHighlightName}-selected`;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const style = document.createElement('style');
    style.dataset.squisqFindHighlight = reactId;
    style.textContent = `::highlight(${previewHighlightName}) { background: #fde68a; color: inherit; } ::highlight(${previewSelectedName}) { background: #f59e0b; color: #111827; }`;
    document.head.append(style);
    return () => style.remove();
  }, [previewHighlightName, previewSelectedName, reactId]);

  useEffect(() => {
    let cleanup = () => {};
    let count = 0;

    if (activeView === 'raw' && monacoEditor) {
      const model = monacoEditor.getModel();
      const matches = model
        ? model.findMatches(query.trim(), false, false, false, null, false)
        : [];
      count = query.trim() ? matches.length : 0;
      const selected = normalizeFindIndex(selectedIndex, count);
      const decorations = monacoEditor.createDecorationsCollection(
        matches.slice(0, count).map((match, index) => ({
          range: match.range,
          options: monacoDecorationOptions(index === selected),
        })),
      );
      if (count > 0) monacoEditor.revealRangeInCenter(matches[selected].range);
      cleanup = () => decorations.clear();
    } else if (activeView === 'wysiwyg' && tiptapEditor && !tiptapEditor.isDestroyed) {
      count = updateTiptapFindHighlights(tiptapEditor, query, selectedIndex);
      const selected = tiptapEditor.view.dom.querySelector<HTMLElement>(
        '.squisq-find-match--selected',
      );
      selected?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
      cleanup = () => {
        if (!tiptapEditor.isDestroyed) updateTiptapFindHighlights(tiptapEditor, '', 0);
      };
    } else if (activeView === 'preview') {
      const root = inputRef.current
        ?.closest('.squisq-editor-shell')
        ?.querySelector<HTMLElement>('[data-testid="preview-panel"]');
      if (root) {
        const result = applyPreviewHighlights(
          root,
          query,
          selectedIndex,
          previewHighlightName,
          previewSelectedName,
        );
        count = result.count;
        cleanup = result.cleanup;
      }
    }

    setMatchCount(count);
    setSelectedIndex((current) => normalizeFindIndex(current, count));
    return cleanup;
  }, [
    activeView,
    markdownSource,
    monacoEditor,
    previewHighlightName,
    previewSelectedName,
    query,
    selectedIndex,
    tiptapEditor,
  ]);

  const moveSelection = useCallback(
    (delta: number) => {
      if (matchCount === 0) return;
      setSelectedIndex((current) => normalizeFindIndex(current + delta, matchCount));
    },
    [matchCount],
  );

  const resultLabel =
    query.trim() === ''
      ? '0 of 0'
      : matchCount === 0
        ? 'No results'
        : `${normalizeFindIndex(selectedIndex, matchCount) + 1} of ${matchCount}`;

  return (
    <div className="squisq-find-toolbar" role="search" aria-label="Find in document">
      <div className="squisq-find-field">
        <Icon icon="fa-solid fa-magnifying-glass" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          className="squisq-find-input"
          aria-label="Find in document"
          placeholder="Find in document"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelectedIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              moveSelection(event.shiftKey ? -1 : 1);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
            }
          }}
        />
        <span className="squisq-find-count" aria-live="polite" aria-atomic="true">
          {resultLabel}
        </span>
      </div>
      <button
        type="button"
        className="squisq-find-button"
        aria-label="Previous match"
        data-tooltip="Previous match (Shift+Enter)"
        disabled={matchCount === 0}
        onClick={() => moveSelection(-1)}
      >
        <Icon icon="fa-solid fa-chevron-up" />
      </button>
      <button
        type="button"
        className="squisq-find-button"
        aria-label="Next match"
        data-tooltip="Next match (Enter)"
        disabled={matchCount === 0}
        onClick={() => moveSelection(1)}
      >
        <Icon icon="fa-solid fa-chevron-down" />
      </button>
      <button
        type="button"
        className="squisq-find-button squisq-find-close"
        aria-label="Close find"
        data-tooltip="Close find (Esc)"
        onClick={onClose}
      >
        <Icon icon="fa-solid fa-xmark" />
      </button>
    </div>
  );
}

function monacoDecorationOptions(selected: boolean): MonacoEditorNs.IModelDecorationOptions {
  return {
    inlineClassName: selected
      ? 'squisq-find-match squisq-find-match--selected'
      : 'squisq-find-match',
  };
}

function applyPreviewHighlights(
  root: HTMLElement,
  query: string,
  selectedIndex: number,
  highlightName: string,
  selectedName: string,
): PreviewHighlightResult {
  const ranges = collectTextRanges(root, query);
  const selected = normalizeFindIndex(selectedIndex, ranges.length);
  const css = globalThis.CSS as (typeof CSS & { highlights?: HighlightRegistryLike }) | undefined;
  const HighlightConstructor = (
    globalThis as typeof globalThis & {
      Highlight?: HighlightConstructorLike;
    }
  ).Highlight;

  if (css?.highlights && HighlightConstructor) {
    css.highlights.set(highlightName, new HighlightConstructor(...ranges));
    if (ranges.length > 0) {
      css.highlights.set(selectedName, new HighlightConstructor(ranges[selected]));
      scrollRangeIntoView(ranges[selected]);
    } else {
      css.highlights.delete(selectedName);
    }
    return {
      count: ranges.length,
      cleanup: () => {
        css.highlights?.delete(highlightName);
        css.highlights?.delete(selectedName);
      },
    };
  }

  // CSS Custom Highlight is broadly available in current browsers. Keep a
  // DOM-mark fallback for older embedded webviews; Preview is read-only, and
  // every inserted mark is unwrapped when the query changes or Find closes.
  const marks = markPreviewRanges(ranges, selected);
  marks
    .find((mark) => mark.classList.contains('squisq-find-match--selected'))
    ?.scrollIntoView?.({
      block: 'center',
      inline: 'nearest',
    });
  return {
    count: ranges.length,
    cleanup: () => {
      const parents = new Set<Node>();
      for (const mark of marks) {
        const parent = mark.parentNode;
        if (!parent) continue;
        parents.add(parent);
        mark.replaceWith(...Array.from(mark.childNodes));
      }
      parents.forEach((parent) => parent.normalize());
    },
  };
}

function collectTextRanges(root: HTMLElement, query: string): Range[] {
  if (!query.trim()) return [];
  const doc = root.ownerDocument;
  const showText = doc.defaultView?.NodeFilter.SHOW_TEXT ?? 4;
  const walker = doc.createTreeWalker(root, showText);
  const ranges: Range[] = [];
  let current = walker.nextNode();
  while (current) {
    const text = current as Text;
    const parent = text.parentElement;
    if (
      parent &&
      !parent.closest(
        'button, input, textarea, select, script, style, [aria-hidden="true"], [data-squisq-find-ignore]',
      )
    ) {
      for (const match of findTextMatches(text.data, query)) {
        const range = doc.createRange();
        range.setStart(text, match.from);
        range.setEnd(text, match.to);
        ranges.push(range);
      }
    }
    current = walker.nextNode();
  }
  return ranges;
}

function scrollRangeIntoView(range: Range): void {
  const element =
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement;
  (element as HTMLElement | null)?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
}

function markPreviewRanges(ranges: Range[], selectedIndex: number): HTMLElement[] {
  const marks: HTMLElement[] = [];
  // Work backwards so splitting a text node does not invalidate the offsets
  // of an earlier match in that same node.
  [...ranges]
    .map((range, index) => ({ range, index }))
    .reverse()
    .forEach(({ range, index }) => {
      const text = range.startContainer;
      if (!(text instanceof Text) || text !== range.endContainer || !text.parentNode) return;
      const after = text.splitText(range.endOffset);
      const matched = text.splitText(range.startOffset);
      const mark = text.ownerDocument.createElement('mark');
      mark.className =
        index === selectedIndex
          ? 'squisq-find-match squisq-find-match--selected'
          : 'squisq-find-match';
      matched.replaceWith(mark);
      mark.append(matched);
      marks.push(mark);
      // Keep the tail referenced so aggressive DOM implementations do not
      // discard it before the next reverse-ordered range is processed.
      void after;
    });
  return marks;
}
