import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { Editor as TiptapEditor } from '@tiptap/core';
import type { editor as MonacoEditorNs, IRange } from 'monaco-editor';
import { useEditorContext } from '../EditorContext';
import { Icon } from '../Icon';
import {
  replaceAllTiptapFindMatches,
  replaceTiptapFindMatch,
  updateTiptapFindHighlights,
} from './FindHighlightExtension';
import {
  findProseMirrorMatches,
  findTextMatches,
  nextFindIndexAfter,
  normalizeFindIndex,
  type FindOptions,
  type FindRequest,
} from './findModel';

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
  /** The document is editable, so Replace may be offered. */
  allowReplace?: boolean;
  /** Show the replace field. */
  replaceOpen?: boolean;
  onReplaceOpenChange?: (open: boolean) => void;
  /** Advances when the find shortcut is pressed again while the bar is open. */
  focusRequest?: number;
}

/** Longest editor selection that seeds the query; longer ones are not a search. */
const MAX_SEEDED_QUERY = 200;

/** Search controls shown immediately to the right of the Write/Source/Use tabs. */
export function FindToolbar({
  onClose,
  allowReplace = false,
  replaceOpen = false,
  onReplaceOpenChange,
  focusRequest = 0,
}: FindToolbarProps) {
  const { activeView, markdownSource, tiptapEditor, monacoEditor, findRequest } =
    useEditorContext();
  const [initial] = useState(() =>
    initialFindState(findRequest, activeView, tiptapEditor, monacoEditor),
  );
  const [query, setQuery] = useState(initial.query);
  const [matchCase, setMatchCase] = useState(initial.matchCase ?? false);
  const [wholeWord, setWholeWord] = useState(initial.wholeWord ?? false);
  const [selectedIndex, setSelectedIndex] = useState(initial.occurrence ?? 0);
  const [matchCount, setMatchCount] = useState(0);
  const [replacement, setReplacement] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const reactId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const previewHighlightName = `squisq-find-${reactId}`;
  const previewSelectedName = `${previewHighlightName}-selected`;
  const canReplace = allowReplace && activeView !== 'preview';
  const showReplace = canReplace && replaceOpen;
  const options: FindOptions = { matchCase, wholeWord };

  // Reveal (scroll to and select) the current match only when the user
  // navigates — never because the document changed, or typing in the
  // document with Find open would keep yanking the caret to the match. A
  // reveal stays pending until there is a match to reveal (a document that
  // is still loading has none yet).
  const lastNavigationRef = useRef('');
  const pendingRevealRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusRequest]);

  useEffect(() => {
    if (showReplace) replaceInputRef.current?.focus();
  }, [showReplace, focusRequest]);

  // A new host request (e.g. a workspace search hit) replaces the query.
  const appliedRequestRef = useRef(findRequest);
  useEffect(() => {
    if (!findRequest || findRequest === appliedRequestRef.current) return;
    appliedRequestRef.current = findRequest;
    setQuery(findRequest.query);
    setMatchCase(findRequest.matchCase ?? false);
    setWholeWord(findRequest.wholeWord ?? false);
    setSelectedIndex(findRequest.occurrence ?? 0);
  }, [findRequest]);

  useEffect(() => {
    const style = document.createElement('style');
    style.dataset.squisqFindHighlight = reactId;
    style.textContent = `::highlight(${previewHighlightName}) { background: var(--squisq-find-match, #fde68a); color: inherit; } ::highlight(${previewSelectedName}) { background: var(--squisq-find-match-current, #f59e0b); color: var(--squisq-find-match-text, #111827); }`;
    document.head.append(style);
    return () => style.remove();
  }, [previewHighlightName, previewSelectedName, reactId]);

  useEffect(() => {
    let cleanup = () => {};
    let count = 0;
    const navigationKey = [activeView, query, matchCase, wholeWord, selectedIndex].join('\u0000');
    if (navigationKey !== lastNavigationRef.current) {
      lastNavigationRef.current = navigationKey;
      pendingRevealRef.current = true;
    }
    const reveal = pendingRevealRef.current;
    const findOptions: FindOptions = { matchCase, wholeWord };

    if (activeView === 'raw' && monacoEditor) {
      const model = monacoEditor.getModel();
      const ranges = model ? findMonacoRanges(model, query, findOptions) : [];
      count = ranges.length;
      const selected = normalizeFindIndex(selectedIndex, count);
      const decorations = monacoEditor.createDecorationsCollection(
        ranges.map((range, index) => ({
          range,
          options: monacoDecorationOptions(index === selected),
        })),
      );
      if (reveal && count > 0) {
        monacoEditor.setSelection(ranges[selected]!);
        monacoEditor.revealRangeInCenter(ranges[selected]!);
      }
      cleanup = () => decorations.clear();
    } else if (activeView === 'wysiwyg' && tiptapEditor && !tiptapEditor.isDestroyed) {
      count = updateTiptapFindHighlights(tiptapEditor, query, selectedIndex, findOptions, {
        select: reveal,
      });
      if (reveal) {
        tiptapEditor.view.dom
          .querySelector<HTMLElement>('.squisq-find-match--selected')
          ?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
      }
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
          findOptions,
          selectedIndex,
          previewHighlightName,
          previewSelectedName,
          reveal,
        );
        count = result.count;
        cleanup = result.cleanup;
      }
    }

    if (count > 0) pendingRevealRef.current = false;
    setMatchCount(count);
    // With no matches yet (a document still loading), keep a requested
    // occurrence rather than collapsing it to the first match.
    setSelectedIndex((current) => (count === 0 ? current : normalizeFindIndex(current, count)));
    return cleanup;
  }, [
    activeView,
    markdownSource,
    matchCase,
    monacoEditor,
    previewHighlightName,
    previewSelectedName,
    query,
    selectedIndex,
    tiptapEditor,
    wholeWord,
  ]);

  const moveSelection = useCallback(
    (delta: number) => {
      if (matchCount === 0) return;
      setSelectedIndex((current) => normalizeFindIndex(current + delta, matchCount));
    },
    [matchCount],
  );

  const replaceCurrent = () => {
    if (!canReplace || matchCount === 0) return;
    let next: number | null = null;
    if (activeView === 'raw' && monacoEditor) {
      next = replaceMonacoMatch(monacoEditor, query, selectedIndex, replacement, options);
    } else if (activeView === 'wysiwyg' && tiptapEditor && !tiptapEditor.isDestroyed) {
      next = replaceTiptapFindMatch(tiptapEditor, query, selectedIndex, replacement, options);
    }
    if (next === null) return;
    pendingRevealRef.current = true;
    setSelectedIndex(next);
  };

  const replaceAll = () => {
    if (!canReplace || matchCount === 0) return;
    if (activeView === 'raw' && monacoEditor) {
      replaceAllMonacoMatches(monacoEditor, query, replacement, options);
    } else if (activeView === 'wysiwyg' && tiptapEditor && !tiptapEditor.isDestroyed) {
      replaceAllTiptapFindMatches(tiptapEditor, query, replacement, options);
    }
    setSelectedIndex(0);
  };

  /** Close and hand focus back to the editor, where the current match is selected. */
  const close = () => {
    if (activeView === 'raw') monacoEditor?.focus();
    else if (activeView === 'wysiwyg' && tiptapEditor && !tiptapEditor.isDestroyed) {
      tiptapEditor.commands.focus();
    }
    onClose();
  };

  const resultLabel =
    query.trim() === ''
      ? '0 of 0'
      : matchCount === 0
        ? 'No results'
        : `${normalizeFindIndex(selectedIndex, matchCount) + 1} of ${matchCount}`;

  return (
    <div className="squisq-find-toolbar" role="search" aria-label="Find in document">
      {canReplace && (
        <button
          type="button"
          className="squisq-find-button squisq-find-replace-toggle"
          aria-label="Toggle replace"
          aria-expanded={showReplace}
          data-tooltip="Toggle replace"
          onClick={() => onReplaceOpenChange?.(!replaceOpen)}
        >
          <Icon icon={showReplace ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-right'} />
        </button>
      )}
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
              close();
            }
          }}
        />
        <span className="squisq-find-count" aria-live="polite" aria-atomic="true">
          {resultLabel}
        </span>
      </div>
      <button
        type="button"
        className="squisq-find-button squisq-find-option"
        aria-label="Match case"
        aria-pressed={matchCase}
        data-tooltip="Match case"
        onClick={() => {
          setMatchCase((value) => !value);
          setSelectedIndex(0);
        }}
      >
        <span aria-hidden="true">Aa</span>
      </button>
      <button
        type="button"
        className="squisq-find-button squisq-find-option squisq-find-option--word"
        aria-label="Match whole word"
        aria-pressed={wholeWord}
        data-tooltip="Match whole word"
        onClick={() => {
          setWholeWord((value) => !value);
          setSelectedIndex(0);
        }}
      >
        <span aria-hidden="true">ab</span>
      </button>
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
      {showReplace && (
        <>
          <div className="squisq-find-field squisq-replace-field">
            <Icon icon="fa-solid fa-right-left" />
            <input
              ref={replaceInputRef}
              type="text"
              value={replacement}
              className="squisq-find-input"
              aria-label="Replace with"
              placeholder="Replace"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setReplacement(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  if (event.ctrlKey || event.metaKey) replaceAll();
                  else replaceCurrent();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  close();
                }
              }}
            />
          </div>
          <button
            type="button"
            className="squisq-find-button"
            aria-label="Replace"
            data-tooltip="Replace (Enter)"
            disabled={matchCount === 0}
            onClick={replaceCurrent}
          >
            <Icon icon="fa-solid fa-arrow-right-long" />
          </button>
          <button
            type="button"
            className="squisq-find-button"
            aria-label="Replace all"
            data-tooltip="Replace all (Ctrl+Enter)"
            disabled={matchCount === 0}
            onClick={replaceAll}
          >
            <Icon icon="fa-solid fa-angles-right" />
          </button>
        </>
      )}
      <button
        type="button"
        className="squisq-find-button squisq-find-close"
        aria-label="Close find"
        data-tooltip="Close find (Esc)"
        onClick={close}
      >
        <Icon icon="fa-solid fa-xmark" />
      </button>
    </div>
  );
}

/**
 * What Find opens with: the host's request, or else the editor's single-line
 * selection, with the match at that selection already current.
 */
function initialFindState(
  request: FindRequest | null,
  activeView: string,
  tiptapEditor: TiptapEditor | null,
  monacoEditor: MonacoEditorNs.IStandaloneCodeEditor | null,
): FindRequest {
  if (request) return request;
  let text = '';
  let index = 0;
  if (activeView === 'raw' && monacoEditor) {
    const selection = monacoEditor.getSelection();
    const model = monacoEditor.getModel();
    if (selection && model && !selection.isEmpty()) {
      text = model.getValueInRange(selection);
      const start = model.getOffsetAt(selection.getStartPosition());
      index = nextFindIndexAfter(findTextMatches(model.getValue(), text), start);
    }
  } else if (activeView === 'wysiwyg' && tiptapEditor && !tiptapEditor.isDestroyed) {
    const { from, to } = tiptapEditor.state.selection;
    if (from !== to) {
      text = tiptapEditor.state.doc.textBetween(from, to, '\n');
      index = nextFindIndexAfter(findProseMirrorMatches(tiptapEditor.state.doc, text), from);
    }
  }
  if (!text.trim() || text.includes('\n') || text.length > MAX_SEEDED_QUERY) return { query: '' };
  return { query: text, occurrence: index };
}

/** Source-view matches, using the same matcher as Write and Use. */
function findMonacoRanges(
  model: MonacoEditorNs.ITextModel,
  query: string,
  options: FindOptions,
): IRange[] {
  return findTextMatches(model.getValue(), query, options).map((match) => {
    const start = model.getPositionAt(match.from);
    const end = model.getPositionAt(match.to);
    return {
      startLineNumber: start.lineNumber,
      startColumn: start.column,
      endLineNumber: end.lineNumber,
      endColumn: end.column,
    };
  });
}

function replaceMonacoMatch(
  editor: MonacoEditorNs.IStandaloneCodeEditor,
  query: string,
  selectedIndex: number,
  replacement: string,
  options: FindOptions,
): number | null {
  const model = editor.getModel();
  if (!model) return null;
  const ranges = findMonacoRanges(model, query, options);
  const range = ranges[normalizeFindIndex(selectedIndex, ranges.length)];
  if (!range) return null;
  const start = model.getOffsetAt({ lineNumber: range.startLineNumber, column: range.startColumn });
  editor.pushUndoStop();
  editor.executeEdits('squisq-find', [{ range, text: replacement }]);
  editor.pushUndoStop();
  return nextFindIndexAfter(
    findTextMatches(model.getValue(), query, options),
    start + replacement.length,
  );
}

function replaceAllMonacoMatches(
  editor: MonacoEditorNs.IStandaloneCodeEditor,
  query: string,
  replacement: string,
  options: FindOptions,
): number {
  const model = editor.getModel();
  if (!model) return 0;
  const ranges = findMonacoRanges(model, query, options);
  if (ranges.length === 0) return 0;
  // One edit operation between undo stops: a single undo restores everything.
  editor.pushUndoStop();
  editor.executeEdits(
    'squisq-find',
    ranges.map((range) => ({ range, text: replacement })),
  );
  editor.pushUndoStop();
  return ranges.length;
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
  options: FindOptions,
  selectedIndex: number,
  highlightName: string,
  selectedName: string,
  reveal: boolean,
): PreviewHighlightResult {
  const ranges = collectTextRanges(root, query, options);
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
      css.highlights.set(selectedName, new HighlightConstructor(ranges[selected]!));
      if (reveal) scrollRangeIntoView(ranges[selected]!);
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
  if (reveal) {
    marks
      .find((mark) => mark.classList.contains('squisq-find-match--selected'))
      ?.scrollIntoView?.({
        block: 'center',
        inline: 'nearest',
      });
  }
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

function collectTextRanges(root: HTMLElement, query: string, options: FindOptions): Range[] {
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
      for (const match of findTextMatches(text.data, query, options)) {
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
