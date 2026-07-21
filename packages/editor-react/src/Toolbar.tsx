/**
 * Toolbar
 *
 * Formatting toolbar that provides common markdown editing actions.
 * In WYSIWYG mode, uses Tiptap's chain commands to toggle marks / set nodes.
 * In Raw mode, appends markdown syntax at the cursor (or end of source).
 * Hidden in Preview mode.
 */

import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { IRange } from 'monaco-editor';
import type { Block } from '@bendyline/squisq/schemas';
import { VIEWPORT_PRESETS } from '@bendyline/squisq/schemas';
import { DEFAULT_THEME, flattenBlocks } from '@bendyline/squisq/doc';
import {
  KNOWN_BLOCK_META_KEYS,
  matchTrailingTemplateAnnotation,
  splitKeyValueToken,
  tokenizeAttrTokens,
} from '@bendyline/squisq/markdown';
import { useEditorContext, type EditorView } from './EditorContext';
import { VersionHistoryPanel } from './VersionHistoryPanel';
import { RecorderEntry } from './RecorderEntry';
import { ViewMenuPanel } from './ViewMenuPanel';
import { TransformMenu } from './TransformMenu';
import {
  TemplatePicker,
  TEMPLATE_NAMES,
  TEMPLATE_GALLERY_PORTAL_SELECTOR,
  templateLabel,
} from './TemplatePicker';
import { TransitionPicker, TRANSITION_FLYOUT_PORTAL_ID } from './TransitionPicker';
import {
  readHeadingLineTransition,
  setHeadingLineTransition,
  readBlockAttrsTransition,
  setHeadingAttrsTransition,
  EMPTY_TRANSITION,
  type TransitionFields,
} from './headingTransition';
import { profileBlockContents, recommendTemplatesForBlock } from '@bendyline/squisq/recommend';
import { findBlockSliceAtLine, findBlockSliceByHeadingIndex } from './blockSlice';
import { LinkDialog } from './LinkDialog';
import { DocumentSettingsDialog } from './DocumentSettingsDialog';
import { EmojiPicker, EMOJI_PICKER_WIDTH, EMOJI_PICKER_MAX_HEIGHT } from './EmojiPicker';
import { CustomLayoutManager } from './customTemplates/CustomLayoutManager';
import { Icon } from './Icon';
import type { PickerEntry } from './emojiData';
import { createPortal } from 'react-dom';
import { PreviewModeMenu, displayModeLabel, usePreviewSettingsOptional } from './PreviewControls';
import { filterVisibleMediaEntries } from './mediaEntries';
import {
  selectionToTable,
  selectionToTableMarkdown,
  selectionToTaskItems,
  selectionToTaskListMarkdown,
} from './selectionConversions';
import { isMarkdownFencedCodeLine, markdownFencedCodeLineMask } from './markdownCodeFence';
import {
  CODE_SNIPPET_LANGUAGES,
  codeSnippetMarkdown,
  type CodeSnippetLanguage,
} from './codeSnippet/codeSnippetLanguages';
import {
  MERMAID_DIAGRAM_TYPES,
  mermaidDiagramMarkdown,
  type MermaidDiagramType,
} from './mermaid/mermaidDiagramTypes';
import { MermaidDiagramTypeThumbnail } from './mermaid/MermaidDiagramTypeThumbnail';
import { FindToolbar } from './find/FindToolbar';
import { platformShortcut } from './platformShortcuts';
import { useEscapeDismissal } from './useEscapeDismissal';
import type { EditorHostMode } from './editorHostMode';

const VIEWS: { id: EditorView; label: string; shortLabel?: string; shortcutKey: string }[] = [
  { id: 'wysiwyg', label: 'Write', shortcutKey: '1' },
  { id: 'raw', label: 'Source', shortcutKey: '2' },
  { id: 'preview', label: 'Use', shortcutKey: '3' },
];

const BLOCK_META_KEYS = new Set<string>(Object.keys(KNOWN_BLOCK_META_KEYS));

export interface ToolbarProps {
  /** Additional class name */
  className?: string;
  /** Whether the Files panel is currently shown */
  showFiles?: boolean;
  /** Number of files currently available through the MediaProvider. */
  fileCount?: number;
  /** Toggle the Files panel. When provided, a "Files" button appears in the toolbar. */
  onToggleFiles?: () => void;
  /** Content rendered at the left edge of the toolbar, before the view tabs. */
  slotLeft?: ReactNode;
  /** Content rendered immediately after the view tabs, on the left side of the
   *  toolbar (before the formatting controls). Used for the preview mode
   *  switch in Use view. */
  slotAfterTabs?: ReactNode;
  /** Content rendered after the formatting controls (in the middle area). */
  slotAfterActions?: ReactNode;
  /** Content rendered at the rightmost end of the toolbar, after all other elements. */
  slotRight?: ReactNode;
  /**
   * Whether to include the "Play" (preview) tab in the view switcher.
   * Defaults to true. Hosts that don't want the slideshow preview — e.g.
   * editing free-form prompts — can pass false to suppress it.
   */
  showPlayTab?: boolean;
  /**
   * Semantic embedding mode inherited from EditorShell. Chat mode exposes
   * only the Write surface, which suppresses the view tabs and their
   * keyboard-switch targets. Defaults to `'document'`.
   */
  hostMode?: EditorHostMode;
}

import {
  BUTTONS,
  BUTTON_INDEX_BY_ID,
  CHART_TYPE_MENU_WIDTH,
  CODE_SNIPPET_MENU_WIDTH,
  CONVERT_BUTTONS,
  fileCountBadge,
  fileCountLabel,
  FIRST_MEDIA_INDEX,
  INSERT_MENU_WIDTH,
  MEDIA_BUTTONS,
  MERMAID_TYPE_MENU_WIDTH,
  TASK_LIST_MARKDOWN,
  buttonIcon,
} from './toolbar/toolbarButtons';

import {
  blockConversionRange,
  insertTaskList,
  isTiptapActive,
  tableContent,
  taskListContent,
} from './toolbar/tiptapToolbar';

import {
  DIAGRAM_STARTER_MARKDOWN,
  insertAsciiDiagramBlock,
  insertChartBlock,
  insertFenceBlock,
  insertLayoutBlock,
  insertMermaidDiagramBlock,
  insertTemplateHeading,
  insertTimelineBlock,
  insertTreeBlock,
  LAYOUT_STARTER_MARKDOWN,
  MERMAID_STARTER_MARKDOWN,
  TIMELINE_STARTER_MARKDOWN,
  TREE_STARTER_MARKDOWN,
} from './toolbar/sceneBlockInserts';
import {
  CHART_TYPES,
  chartStarterMarkdown,
  DEFAULT_CHART_TYPE,
  type ChartTypeEntry,
} from './chart/chartTypes';
import { ChartTypeThumbnail } from './chart/ChartTypeThumbnail';

function findBlockBySourceLine(blocks: readonly Block[], lineNumber: number): Block | null {
  for (const block of blocks) {
    const pos = block.sourceHeading?.position;
    if (!pos) continue;
    if (pos.start.line <= lineNumber && pos.end.line >= lineNumber) return block;
  }
  return null;
}

function splitTemplateAnnotationParams(text: string): { text: string; params: string[] } {
  const match = matchTrailingTemplateAnnotation(text);
  if (!match) return { text: text.trimEnd(), params: [] };
  const tokens = tokenizeAttrTokens(match.inner.trim());
  const firstIsParam = tokens.length > 0 && tokens[0].indexOf('=') > 0;
  return {
    text: text.slice(0, match.index).trimEnd(),
    params: keepBlockMetaParamTokens(tokens.slice(firstIsParam ? 0 : 1)),
  };
}

function buildTemplateAnnotation(template: string, params: string[]): string | null {
  const parts = template ? [template, ...params] : params;
  return parts.length > 0 ? `{[${parts.join(' ')}]}` : null;
}

function keepBlockMetaParamTokens(tokens: readonly string[]): string[] {
  return tokens.filter((token) => {
    const kv = splitKeyValueToken(token);
    return kv ? BLOCK_META_KEYS.has(kv.key) : false;
  });
}

function keepBlockMetaParamString(inner: string | null | undefined): string | null {
  if (!inner) return null;
  const params = keepBlockMetaParamTokens(tokenizeAttrTokens(inner));
  return params.length > 0 ? params.join(' ') : null;
}

/**
 * Formatting toolbar.
 * - WYSIWYG: calls Tiptap chain commands (toggleBold, etc.)
 * - Raw: appends markdown syntax to the source
 */
export function Toolbar({
  className,
  showFiles,
  fileCount,
  onToggleFiles,
  slotLeft,
  slotAfterTabs,
  slotAfterActions,
  slotRight,
  showPlayTab = true,
  hostMode = 'document',
}: ToolbarProps) {
  const {
    activeView,
    setActiveView,
    markdownSource,
    doc,
    setMarkdownSource,
    tiptapEditor,
    monacoEditor,
    activeSceneText,
    mediaProvider,
    editorMode,
    findMode,
    setFindMode,
    layoutMode,
    activeBlockStartLine,
    versioning,
    allowRecording,
    documentLinkProvider,
    linkSchemes,
    colorScheme,
    mediaRevision,
    bumpMediaRevision,
  } = useEditorContext();
  const previewSettings = usePreviewSettingsOptional();
  const [useModeMenuRequest, requestUseModeMenu] = useReducer((count: number) => count + 1, 0);
  const [recorderOpen, setRecorderOpen] = useState(false);
  // When a canvas textbox is being edited, its Tiptap instance takes over
  // the formatting buttons; otherwise they drive the document editor. The
  // `level` gates which buttons apply (inline labels vs. rich textboxes).
  const formattingEditor = activeSceneText?.editor ?? tiptapEditor;
  const sceneTextLevel = activeSceneText?.level ?? null;
  const isCodeMode = editorMode === 'code';
  const showDocumentChrome = !isCodeMode && hostMode !== 'chat';
  // In code mode only the raw view is meaningful; the WYSIWYG and Preview
  // surfaces aren't mounted, so hide their tabs.
  const visibleViews = VIEWS.filter((v) => {
    if (hostMode === 'chat') return v.id === 'wysiwyg';
    if (isCodeMode) return v.id === 'raw';
    if (v.id === 'preview' && !showPlayTab) return false;
    return true;
  });
  const showViewTabs = visibleViews.length > 1;
  const [scannedFileCount, setScannedFileCount] = useState(0);
  const resolvedFileCount = fileCount ?? scannedFileCount;

  useEffect(() => {
    if (fileCount !== undefined) return;
    if (!mediaProvider) {
      setScannedFileCount(0);
      return;
    }

    let cancelled = false;
    mediaProvider.listMedia().then(
      (entries) => {
        if (!cancelled) setScannedFileCount(filterVisibleMediaEntries(entries).length);
      },
      () => {
        if (!cancelled) setScannedFileCount(0);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [fileCount, mediaProvider, mediaRevision, showFiles]);

  // Hidden file input for image picker
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Link dialog — shared by WYSIWYG and Raw views.
  const [linkDialog, setLinkDialog] = useState<{
    mode: 'insert' | 'update';
    target: 'wysiwyg' | 'raw';
    initialText: string;
    initialUrl: string;
    /** For target='raw': the range to replace when editing an existing
     *  [text](url) under the cursor. Null means use the current Monaco
     *  selection (insert at cursor / wrap selection). */
    rawRange: IRange | null;
  } | null>(null);

  // Emoji picker — toolbar-anchored popover. We track the trigger
  // button's screen rect so the picker can position itself just below
  // it via createPortal (the toolbar's overflow:hidden actions row
  // would otherwise clip the popover).
  const emojiButtonRef = useRef<HTMLButtonElement | null>(null);
  const [emojiPickerAnchor, setEmojiPickerAnchor] = useState<{
    top: number;
    left: number;
  } | null>(null);

  const openEmojiPicker = useCallback(() => {
    const btn = emojiButtonRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    // Position just below the trigger by default, then clamp into the
    // visible viewport so the picker is never clipped on the right or
    // bottom — flips above the trigger when there isn't room below.
    const gap = 6;
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = rect.left;
    if (left + EMOJI_PICKER_WIDTH + margin > vw) {
      left = Math.max(margin, vw - EMOJI_PICKER_WIDTH - margin);
    }
    let top = rect.bottom + gap;
    if (top + EMOJI_PICKER_MAX_HEIGHT + margin > vh) {
      const flipped = rect.top - EMOJI_PICKER_MAX_HEIGHT - gap;
      // Prefer flipping above when there's more room there; otherwise
      // pin to the top edge with margin and let the picker's own
      // maxHeight clip it.
      top = flipped >= margin ? flipped : margin;
    }
    setEmojiPickerAnchor({ top, left });
  }, []);

  const closeEmojiPicker = useCallback(() => setEmojiPickerAnchor(null), []);

  // Insert menu — toolbar-anchored dropdown that replaces the individual media-group
  // buttons with a single "+" button. Portaled out to avoid overflow:hidden clipping.
  const insertMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const insertMenuReturnFocusRef = useRef<HTMLElement | null>(null);
  const overflowTriggerRef = useRef<HTMLButtonElement>(null);
  const insertMenuRef = useRef<HTMLDivElement | null>(null);
  const codeSnippetMenuRef = useRef<HTMLDivElement | null>(null);
  const mermaidTypeMenuRef = useRef<HTMLDivElement | null>(null);
  const chartTypeMenuRef = useRef<HTMLDivElement | null>(null);
  const [insertMenuAnchor, setInsertMenuAnchor] = useState<{ top: number; left: number } | null>(
    null,
  );
  const [codeSnippetMenuAnchor, setCodeSnippetMenuAnchor] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [mermaidTypeMenuAnchor, setMermaidTypeMenuAnchor] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [chartTypeMenuAnchor, setChartTypeMenuAnchor] = useState<{
    top: number;
    left: number;
  } | null>(null);

  const openInsertMenu = useCallback((trigger?: HTMLElement | null) => {
    const btn = trigger ?? insertMenuButtonRef.current;
    if (!btn) return;
    insertMenuReturnFocusRef.current = trigger
      ? overflowTriggerRef.current
      : insertMenuButtonRef.current;
    const rect = btn.getBoundingClientRect();
    const gap = 4;
    const margin = 8;
    const vw = window.innerWidth;
    let left = rect.left;
    if (left + INSERT_MENU_WIDTH + margin > vw) {
      left = Math.max(margin, rect.right - INSERT_MENU_WIDTH);
    }
    setInsertMenuAnchor({ top: rect.bottom + gap, left });
    setCodeSnippetMenuAnchor(null);
    setMermaidTypeMenuAnchor(null);
    setChartTypeMenuAnchor(null);
  }, []);

  const openCodeSnippetMenu = useCallback((trigger: HTMLElement) => {
    const rect = trigger.getBoundingClientRect();
    const gap = 4;
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = rect.right + gap;
    if (left + CODE_SNIPPET_MENU_WIDTH + margin > vw) {
      left = Math.max(margin, rect.left - CODE_SNIPPET_MENU_WIDTH - gap);
    }
    const maxMenuHeight = Math.min(440, vh - margin * 2);
    const top = Math.max(margin, Math.min(rect.top, vh - maxMenuHeight - margin));
    setCodeSnippetMenuAnchor({ top, left });
    setMermaidTypeMenuAnchor(null);
    setChartTypeMenuAnchor(null);
  }, []);

  const openMermaidTypeMenu = useCallback((trigger: HTMLElement) => {
    const rect = trigger.getBoundingClientRect();
    const gap = 4;
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = rect.right + gap;
    if (left + MERMAID_TYPE_MENU_WIDTH + margin > vw) {
      left = Math.max(margin, rect.left - MERMAID_TYPE_MENU_WIDTH - gap);
    }
    const maxMenuHeight = Math.min(600, vh - margin * 2);
    const top = Math.max(margin, Math.min(rect.top, vh - maxMenuHeight - margin));
    setMermaidTypeMenuAnchor({ top, left });
    setCodeSnippetMenuAnchor(null);
    setChartTypeMenuAnchor(null);
  }, []);

  const openChartTypeMenu = useCallback((trigger: HTMLElement) => {
    const rect = trigger.getBoundingClientRect();
    const gap = 4;
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = rect.right + gap;
    if (left + CHART_TYPE_MENU_WIDTH + margin > vw) {
      left = Math.max(margin, rect.left - CHART_TYPE_MENU_WIDTH - gap);
    }
    const maxMenuHeight = Math.min(600, vh - margin * 2);
    const top = Math.max(margin, Math.min(rect.top, vh - maxMenuHeight - margin));
    setChartTypeMenuAnchor({ top, left });
    setCodeSnippetMenuAnchor(null);
    setMermaidTypeMenuAnchor(null);
  }, []);

  const closeInsertMenu = useCallback(() => {
    setInsertMenuAnchor(null);
    setCodeSnippetMenuAnchor(null);
    setMermaidTypeMenuAnchor(null);
    setChartTypeMenuAnchor(null);
  }, []);

  // ── Overflow detection ────────────────────────────────
  const actionsRef = useRef<HTMLDivElement>(null);
  const [measuredOverflowIndex, setMeasuredOverflowIndex] = useState<number | null>(null);
  // '|'-joined data-contextual ids of the contextual groups (template /
  // transition pickers, table controls) whose right edge doesn't fit in the
  // actions row. Stored as a string so identical measurements bail out of
  // re-rendering.
  const [clippedContextualKey, setClippedContextualKey] = useState('');
  const [showOverflow, setShowOverflow] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);

  useEscapeDismissal(showOverflow, () => setShowOverflow(false), overflowTriggerRef);
  useEscapeDismissal(insertMenuAnchor !== null, closeInsertMenu, insertMenuReturnFocusRef);

  // Document settings (frontmatter) dialog
  const [showDocSettings, setShowDocSettings] = useState(false);

  // Custom layout manager dialog (list of doc/library layouts + designer)
  const [showLayoutManager, setShowLayoutManager] = useState(false);

  useEffect(() => {
    if (!findMode) return;
    setShowOverflow(false);
    closeInsertMenu();
    closeEmojiPicker();
  }, [closeEmojiPicker, closeInsertMenu, findMode]);

  const overflowIndex = measuredOverflowIndex;
  const clippedContextual = new Set(clippedContextualKey ? clippedContextualKey.split('|') : []);

  useEffect(() => {
    const container = actionsRef.current;
    if (!container) return;

    const measure = () => {
      const containerRight = container.getBoundingClientRect().right;
      // Contextual groups aren't BUTTONS entries, so they must not shift the
      // btnIndex mapping below — measure them separately.
      const children = container.querySelectorAll<HTMLElement>(
        ':scope > .squisq-toolbar-group:not(.squisq-toolbar-contextual) > .squisq-toolbar-button',
      );
      let firstHidden: number | null = null;
      children.forEach((child) => {
        if (firstHidden !== null) return;
        // A button is hidden if its right edge extends past the container.
        // Its data-btn-index carries its BUTTONS position (see
        // BUTTON_INDEX_BY_ID for why the DOM can't be walked positionally).
        if (child.getBoundingClientRect().right > containerRight + 2) {
          const index = Number(child.dataset.btnIndex);
          firstHidden = Number.isNaN(index) ? null : index;
        }
      });
      setMeasuredOverflowIndex(firstHidden);
      // Contextual groups (template/transition pickers, table controls) that
      // don't fit move into the overflow menu instead of painting cropped.
      const clipped: string[] = [];
      container
        .querySelectorAll<HTMLElement>(':scope > .squisq-toolbar-contextual')
        .forEach((group) => {
          if (group.getBoundingClientRect().right > containerRight + 2) {
            clipped.push(group.dataset.contextual ?? '');
          }
        });
      setClippedContextualKey(clipped.join('|'));
    };

    // Observe the row and every group in it: contextual groups mount/unmount
    // with the cursor context and change width with their value, all without
    // resizing the flex:1 container itself — a container-only observer would
    // go stale.
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    const observeAll = () => {
      ro?.disconnect();
      ro?.observe(container);
      container
        .querySelectorAll<HTMLElement>(':scope > .squisq-toolbar-group')
        .forEach((group) => ro?.observe(group));
    };
    const mo = new MutationObserver(() => {
      observeAll();
      measure();
    });
    mo.observe(container, { childList: true });
    if (!ro) window.addEventListener('resize', measure);
    observeAll();
    measure();
    return () => {
      ro?.disconnect();
      if (!ro) window.removeEventListener('resize', measure);
      mo.disconnect();
    };
  }, [activeView]);

  // Close overflow menu on outside click. Clicks inside the template
  // gallery / transition flyout portals count as inside: those popovers are
  // hosted by pickers living in this menu, and closing the menu on their
  // mousedown would unmount them before the click completes.
  useEffect(() => {
    if (!showOverflow) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (overflowRef.current?.contains(target)) return;
      if (
        target instanceof Element &&
        target.closest(`${TEMPLATE_GALLERY_PORTAL_SELECTOR}, #${TRANSITION_FLYOUT_PORTAL_ID}`)
      ) {
        return;
      }
      setShowOverflow(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showOverflow]);

  // Close insert menu on outside click
  useEffect(() => {
    if (!insertMenuAnchor) return;
    const handleClick = (e: MouseEvent) => {
      if (insertMenuButtonRef.current?.contains(e.target as Node)) return;
      if (insertMenuRef.current?.contains(e.target as Node)) return;
      if (codeSnippetMenuRef.current?.contains(e.target as Node)) return;
      if (mermaidTypeMenuRef.current?.contains(e.target as Node)) return;
      if (chartTypeMenuRef.current?.contains(e.target as Node)) return;
      closeInsertMenu();
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [insertMenuAnchor, closeInsertMenu]);

  // Open-up vs open-down: the overflow menu is anchored to its trigger with
  // `top: 100%` by default. When the toolbar lives near the bottom of a
  // small container (e.g. a chat composer), a downward menu gets clipped.
  // Measure on open and flip the anchor to `bottom: 100%` if the space
  // above the trigger is larger than the space below.
  const [overflowPlacement, setOverflowPlacement] = useState<'down' | 'up'>('down');
  useEffect(() => {
    if (!showOverflow || !overflowRef.current) return;
    const trigger = overflowRef.current.querySelector<HTMLElement>(
      '.squisq-toolbar-overflow-trigger',
    );
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    // Assume a typical menu height; exact measurement is unreliable on first
    // open because the menu hasn't rendered yet when this runs.
    const ESTIMATED_MENU_HEIGHT = 260;
    if (spaceBelow < ESTIMATED_MENU_HEIGHT && spaceAbove > spaceBelow) {
      setOverflowPlacement('up');
    } else {
      setOverflowPlacement('down');
    }
  }, [showOverflow]);

  // Force re-render when Tiptap selection or formatting state changes
  const [, forceUpdate] = useReducer((c: number) => c + 1, 0);
  useEffect(() => {
    if (!formattingEditor) return;
    formattingEditor.on('transaction', forceUpdate);
    return () => {
      formattingEditor.off('transaction', forceUpdate);
    };
  }, [formattingEditor]);

  // ── Tiptap handler ─────────────────────────────────────
  const handleTiptap = useCallback(
    (id: string) => {
      const tiptapEditor = formattingEditor;
      if (!tiptapEditor) return;
      const chain = tiptapEditor.chain().focus();
      switch (id) {
        case 'bold':
          chain.toggleBold().run();
          break;
        case 'italic':
          chain.toggleItalic().run();
          break;
        case 'strikethrough':
          chain.toggleStrike().run();
          break;
        case 'code':
          chain.toggleCode().run();
          break;
        case 'h1':
          chain.toggleHeading({ level: 1 }).run();
          break;
        case 'h2':
          chain.toggleHeading({ level: 2 }).run();
          break;
        case 'h3':
          chain.toggleHeading({ level: 3 }).run();
          break;
        case 'h4':
          chain.toggleHeading({ level: 4 }).run();
          break;
        case 'h5':
          chain.toggleHeading({ level: 5 }).run();
          break;
        case 'h6':
          chain.toggleHeading({ level: 6 }).run();
          break;
        case 'quote':
          chain.toggleBlockquote().run();
          break;
        case 'ul':
          chain.toggleBulletList().run();
          break;
        case 'ol':
          chain.toggleOrderedList().run();
          break;
        case 'codeblock':
          chain.toggleCodeBlock().run();
          break;
        case 'hr':
          chain.setHorizontalRule().run();
          break;
        case 'link': {
          const isActive = tiptapEditor.isActive('link');
          let initialText = '';
          let initialUrl = '';
          if (isActive) {
            // Snap selection to the full link mark so editing replaces
            // the entire `[text](url)` rather than just the cursor word.
            tiptapEditor.chain().focus().extendMarkRange('link').run();
            const sel = tiptapEditor.state.selection;
            initialText = tiptapEditor.state.doc.textBetween(sel.from, sel.to, ' ');
            initialUrl = (tiptapEditor.getAttributes('link') as { href?: string }).href ?? '';
          } else {
            const { from, to, empty } = tiptapEditor.state.selection;
            if (!empty) {
              initialText = tiptapEditor.state.doc.textBetween(from, to, ' ');
            }
          }
          setLinkDialog({
            mode: isActive ? 'update' : 'insert',
            target: 'wysiwyg',
            initialText,
            initialUrl,
            rawRange: null,
          });
          break;
        }
        case 'table':
          tiptapEditor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
          break;
        case 'tasklist':
          insertTaskList(tiptapEditor);
          break;
        case 'chart':
          // Overflow-menu path (no flyout): insert the default chart starter.
          insertChartBlock(tiptapEditor, {
            template: DEFAULT_CHART_TYPE.id,
            headingText: DEFAULT_CHART_TYPE.headingText,
            table: DEFAULT_CHART_TYPE.table,
          });
          break;
        case 'diagram':
          // Diagrams are ASCII-art code fences; the AsciiDiagramExtension
          // mounts the interactive canvas over the inserted starter.
          insertAsciiDiagramBlock(tiptapEditor);
          break;
        case 'complexdiagram':
          // Complex diagrams remain full Mermaid source; the Mermaid extension
          // renders the fence without narrowing it to Squisq's graph model.
          insertMermaidDiagramBlock(tiptapEditor);
          break;
        case 'tree':
          // File trees are ASCII tree fences; TreeViewExtension mounts the
          // interactive outline over the inserted starter.
          insertTreeBlock(tiptapEditor);
          break;
        case 'timeline':
          // The authored fence is immediately replaced by the WYSIWYG rail
          // canvas; Preview uses the same events as vector layers.
          insertTimelineBlock(tiptapEditor);
          break;
        case 'drawing':
          // Empty drawing is usable via the canvas's "Shapes ▾" palette;
          // each shape persists as a child heading.
          insertTemplateHeading(tiptapEditor, { template: 'drawing', text: 'Drawing' });
          break;
        case 'layout':
          // Seed with a starter text layer (a child sub-block) so the canvas
          // isn't blank; further layers add via the toolbar Text/Box buttons.
          insertLayoutBlock(tiptapEditor);
          break;
      }
    },
    [formattingEditor],
  );

  // ── Raw markdown handler ───────────────────────────────
  const handleRaw = useCallback(
    (id: string) => {
      if (monacoEditor) {
        // Use Monaco's selection API for proper wrap/insert behavior
        const selection = monacoEditor.getSelection();
        const model = monacoEditor.getModel();
        if (!selection || !model) return;

        const selectedText = model.getValueInRange(selection);
        const hasSelection = selectedText.length > 0;

        let replacement = '';
        let newCursorOffset = 0; // offset from start of replacement to place cursor

        // Inline wrapping: wrap selection or insert placeholder
        const wrapInline = (before: string, after: string, placeholder: string) => {
          if (hasSelection) {
            replacement = before + selectedText + after;
          } else {
            replacement = before + placeholder + after;
            // Select the placeholder text after insertion
            newCursorOffset = before.length;
          }
        };

        // Block-level: prefix each selected line, or insert a new block
        const prefixLines = (prefix: string, placeholder: string) => {
          if (hasSelection) {
            replacement = selectedText
              .split('\n')
              .map((line: string) => prefix + line)
              .join('\n');
          } else {
            replacement = prefix + placeholder;
            newCursorOffset = prefix.length;
          }
        };

        switch (id) {
          case 'bold':
            wrapInline('**', '**', 'bold text');
            break;
          case 'italic':
            wrapInline('*', '*', 'italic text');
            break;
          case 'strikethrough':
            wrapInline('~~', '~~', 'strikethrough');
            break;
          case 'code':
            wrapInline('`', '`', 'code');
            break;
          case 'h1':
            prefixLines('# ', 'Heading 1');
            break;
          case 'h2':
            prefixLines('## ', 'Heading 2');
            break;
          case 'h3':
            prefixLines('### ', 'Heading 3');
            break;
          case 'h4':
            prefixLines('#### ', 'Heading 4');
            break;
          case 'h5':
            prefixLines('##### ', 'Heading 5');
            break;
          case 'h6':
            prefixLines('###### ', 'Heading 6');
            break;
          case 'quote':
            prefixLines('> ', 'Quote');
            break;
          case 'ul':
            prefixLines('- ', 'Item');
            break;
          case 'ol':
            prefixLines('1. ', 'Item');
            break;
          case 'codeblock': {
            const inner = hasSelection ? selectedText : 'code';
            replacement = '```\n' + inner + '\n```';
            if (!hasSelection) newCursorOffset = 4; // after ```\n
            break;
          }
          case 'hr': {
            replacement = '\n---\n';
            break;
          }
          case 'link': {
            // Open the LinkDialog instead of inserting literal text. If the
            // cursor sits inside an existing `[text](url)` on this line,
            // prefill from it and replace the whole match on confirm.
            const lineNumber = selection.startLineNumber;
            const lineText = model.getLineContent(lineNumber);
            const cursorCol = selection.startColumn;
            const linkRe = /\[([^\]]*)\]\(([^)]*)\)/g;
            let match: RegExpExecArray | null;
            let existing: { text: string; url: string; range: IRange } | null = null;
            while ((match = linkRe.exec(lineText)) !== null) {
              const startCol = match.index + 1; // 1-based
              const endCol = startCol + match[0].length;
              if (cursorCol >= startCol && cursorCol <= endCol) {
                existing = {
                  text: match[1],
                  url: match[2],
                  range: {
                    startLineNumber: lineNumber,
                    startColumn: startCol,
                    endLineNumber: lineNumber,
                    endColumn: endCol,
                  },
                };
                break;
              }
            }
            setLinkDialog({
              mode: existing ? 'update' : 'insert',
              target: 'raw',
              initialText: existing ? existing.text : hasSelection ? selectedText : '',
              initialUrl: existing ? existing.url : '',
              rawRange: existing ? existing.range : null,
            });
            // Skip the executeEdits/setPosition tail below — the dialog will
            // apply its own edit on confirm.
            return;
          }
          case 'table': {
            const tpl =
              '| Header 1 | Header 2 | Header 3 |\n| --- | --- | --- |\n| Cell | Cell | Cell |\n| Cell | Cell | Cell |';
            replacement = '\n' + tpl + '\n';
            newCursorOffset = 3; // after \n|
            break;
          }
          case 'tasklist': {
            replacement = `\n${TASK_LIST_MARKDOWN}\n`;
            newCursorOffset = replacement.length;
            break;
          }
          case 'chart': {
            // Default chart starter: annotated heading + sample table.
            replacement = chartStarterMarkdown(DEFAULT_CHART_TYPE);
            newCursorOffset = replacement.length;
            break;
          }
          case 'diagram': {
            // A diagram is an ASCII-art code fence; the WYSIWYG view
            // renders its editable canvas, preview renders it as a slide.
            replacement = DIAGRAM_STARTER_MARKDOWN;
            newCursorOffset = replacement.length;
            break;
          }
          case 'complexdiagram': {
            replacement = MERMAID_STARTER_MARKDOWN;
            newCursorOffset = replacement.length;
            break;
          }
          case 'tree': {
            replacement = TREE_STARTER_MARKDOWN;
            newCursorOffset = replacement.length;
            break;
          }
          case 'timeline': {
            replacement = TIMELINE_STARTER_MARKDOWN;
            newCursorOffset = replacement.length;
            break;
          }
          case 'drawing': {
            replacement = '\n## Drawing {[drawing]}\n';
            newCursorOffset = replacement.length;
            break;
          }
          case 'layout': {
            // Seed a starter text layer (a child sub-block) so it isn't blank.
            replacement = LAYOUT_STARTER_MARKDOWN;
            newCursorOffset = replacement.length;
            break;
          }
        }

        // Apply the edit via Monaco's executeEdits for proper undo support
        const range = selection;
        monacoEditor.executeEdits('toolbar', [{ range, text: replacement }]);

        // If no selection, move the cursor to the command's preferred edit point.
        if (!hasSelection && newCursorOffset > 0) {
          const startPos = model.getPositionAt(
            model.getOffsetAt(range.getStartPosition()) + newCursorOffset,
          );
          monacoEditor.setPosition(startPos);
          monacoEditor.revealPositionInCenterIfOutsideViewport(startPos);
        }

        monacoEditor.focus();
      } else {
        // Fallback: no Monaco instance, just append
        let insertion = '';
        switch (id) {
          case 'bold':
            insertion = '**bold text**';
            break;
          case 'italic':
            insertion = '*italic text*';
            break;
          case 'strikethrough':
            insertion = '~~strikethrough~~';
            break;
          case 'code':
            insertion = '`code`';
            break;
          case 'h1':
            insertion = '\n# Heading 1\n';
            break;
          case 'h2':
            insertion = '\n## Heading 2\n';
            break;
          case 'h3':
            insertion = '\n### Heading 3\n';
            break;
          case 'quote':
            insertion = '\n> Quote\n';
            break;
          case 'ul':
            insertion = '\n- Item\n';
            break;
          case 'ol':
            insertion = '\n1. Item\n';
            break;
          case 'codeblock':
            insertion = '\n```\ncode\n```\n';
            break;
          case 'hr':
            insertion = '\n---\n';
            break;
          case 'link':
            insertion = '[link text](url)';
            break;
          case 'table':
            insertion =
              '\n| Header 1 | Header 2 | Header 3 |\n| --- | --- | --- |\n| Cell | Cell | Cell |\n| Cell | Cell | Cell |\n';
            break;
          case 'tasklist':
            insertion = `\n${TASK_LIST_MARKDOWN}\n`;
            break;
          case 'chart':
            insertion = chartStarterMarkdown(DEFAULT_CHART_TYPE);
            break;
          case 'diagram':
            insertion = DIAGRAM_STARTER_MARKDOWN;
            break;
          case 'complexdiagram':
            insertion = MERMAID_STARTER_MARKDOWN;
            break;
          case 'tree':
            insertion = TREE_STARTER_MARKDOWN;
            break;
          case 'timeline':
            insertion = TIMELINE_STARTER_MARKDOWN;
            break;
          case 'drawing':
            insertion = '\n## Drawing {[drawing]}\n';
            break;
          case 'layout':
            insertion = LAYOUT_STARTER_MARKDOWN;
            break;
        }
        if (insertion) {
          setMarkdownSource(markdownSource + insertion);
        }
      }
    },
    [monacoEditor, markdownSource, setMarkdownSource],
  );

  const handleCodeSnippetInsert = useCallback(
    (language: CodeSnippetLanguage) => {
      if (activeView === 'wysiwyg' && tiptapEditor) {
        insertFenceBlock(tiptapEditor, language.starter, language.fenceLanguage, {
          focusInsertedCodeSnippet: true,
        });
        closeInsertMenu();
        return;
      }

      if (monacoEditor) {
        const selection = monacoEditor.getSelection();
        const model = monacoEditor.getModel();
        if (!selection || !model) return;
        const selectedText = model.getValueInRange(selection);
        const source = selectedText.length > 0 ? selectedText : language.starter;
        const markdown = codeSnippetMarkdown(language.fenceLanguage, source);
        monacoEditor.executeEdits('toolbar-code-snippet', [{ range: selection, text: markdown }]);
        if (selectedText.length === 0) {
          const sourceOffset = 5 + language.fenceLanguage.length + source.length;
          const sourcePosition = model.getPositionAt(
            model.getOffsetAt(selection.getStartPosition()) + sourceOffset,
          );
          monacoEditor.setPosition(sourcePosition);
          monacoEditor.revealPositionInCenterIfOutsideViewport(sourcePosition);
        }
        monacoEditor.focus();
        closeInsertMenu();
        return;
      }

      setMarkdownSource(
        markdownSource + codeSnippetMarkdown(language.fenceLanguage, language.starter),
      );
      closeInsertMenu();
    },
    [activeView, closeInsertMenu, markdownSource, monacoEditor, setMarkdownSource, tiptapEditor],
  );

  const handleChartTypeInsert = useCallback(
    (entry: ChartTypeEntry) => {
      if (activeView === 'wysiwyg' && tiptapEditor) {
        insertChartBlock(tiptapEditor, {
          template: entry.id,
          headingText: entry.headingText,
          table: entry.table,
        });
        closeInsertMenu();
        return;
      }

      const markdown = chartStarterMarkdown(entry);
      if (monacoEditor) {
        const selection = monacoEditor.getSelection();
        const model = monacoEditor.getModel();
        if (!selection || !model) return;
        monacoEditor.executeEdits('toolbar-chart', [{ range: selection, text: markdown }]);
        const endPosition = model.getPositionAt(
          model.getOffsetAt(selection.getStartPosition()) + markdown.length,
        );
        monacoEditor.setPosition(endPosition);
        monacoEditor.revealPositionInCenterIfOutsideViewport(endPosition);
        monacoEditor.focus();
        closeInsertMenu();
        return;
      }

      setMarkdownSource(markdownSource + markdown);
      closeInsertMenu();
    },
    [activeView, closeInsertMenu, markdownSource, monacoEditor, setMarkdownSource, tiptapEditor],
  );

  // ── Selected-text conversion handlers ─────────────────
  const handleMermaidDiagramInsert = useCallback(
    (diagramType: MermaidDiagramType) => {
      if (activeView === 'wysiwyg' && tiptapEditor) {
        insertMermaidDiagramBlock(tiptapEditor, diagramType.starter);
        closeInsertMenu();
        return;
      }

      const markdown = mermaidDiagramMarkdown(diagramType.starter);
      if (monacoEditor) {
        const selection = monacoEditor.getSelection();
        const model = monacoEditor.getModel();
        if (!selection || !model) return;
        monacoEditor.executeEdits('toolbar-mermaid-diagram', [
          { range: selection, text: markdown },
        ]);
        const endPosition = model.getPositionAt(
          model.getOffsetAt(selection.getStartPosition()) + markdown.length,
        );
        monacoEditor.setPosition(endPosition);
        monacoEditor.revealPositionInCenterIfOutsideViewport(endPosition);
        monacoEditor.focus();
        closeInsertMenu();
        return;
      }

      setMarkdownSource(markdownSource + markdown);
      closeInsertMenu();
    },
    [activeView, closeInsertMenu, markdownSource, monacoEditor, setMarkdownSource, tiptapEditor],
  );

  const readSelectedText = useCallback((): string => {
    // Canvas text overlays intentionally have a smaller schema without tables
    // or task lists. Ignore their selection instead of surfacing actions that
    // cannot be represented by those layers.
    if (activeSceneText) return '';

    if (activeView === 'wysiwyg' && tiptapEditor) {
      const { from, to, empty } = tiptapEditor.state.selection;
      return empty ? '' : tiptapEditor.state.doc.textBetween(from, to, '\n');
    }

    if (activeView === 'raw' && monacoEditor) {
      const selection = monacoEditor.getSelection();
      const model = monacoEditor.getModel();
      return selection && model ? model.getValueInRange(selection) : '';
    }

    return '';
  }, [activeSceneText, activeView, monacoEditor, tiptapEditor]);

  const handleConvertSelection = useCallback(
    (target: 'table' | 'tasklist') => {
      const selectedText = readSelectedText();
      if (!selectedText.trim()) return;

      if (activeView === 'wysiwyg' && tiptapEditor) {
        const content =
          target === 'table'
            ? tableContent(selectionToTable(selectedText).rows)
            : taskListContent(selectionToTaskItems(selectedText));
        tiptapEditor
          .chain()
          .focus()
          .insertContentAt(blockConversionRange(tiptapEditor), content)
          .run();
        return;
      }

      if (activeView === 'raw' && monacoEditor) {
        const selection = monacoEditor.getSelection();
        if (!selection) return;
        const converted =
          target === 'table'
            ? selectionToTableMarkdown(selectedText)
            : selectionToTaskListMarkdown(selectedText);
        if (!converted) return;

        // Monaco line selections commonly include the newline after the last
        // selected line. Retain selected edge newlines so the replacement
        // block never runs into the surrounding Markdown.
        const leadingNewline = /^(?:\r?\n)/.test(selectedText) ? '\n' : '';
        const trailingNewline = /(?:\r?\n)$/.test(selectedText) ? '\n' : '';
        monacoEditor.executeEdits('toolbar-convert-selection', [
          { range: selection, text: leadingNewline + converted + trailingNewline },
        ]);
        monacoEditor.focus();
      }
    },
    [activeView, monacoEditor, readSelectedText, tiptapEditor],
  );

  // ── Image upload handler ───────────────────────────────
  const handleImageFile = useCallback(
    async (file: File) => {
      if (!mediaProvider) return;
      const buffer = await file.arrayBuffer();
      const relativePath = await mediaProvider.addMedia(file.name, buffer, file.type);
      bumpMediaRevision();
      const altText = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');

      if (activeView === 'wysiwyg' && tiptapEditor) {
        tiptapEditor.chain().focus().setImage({ src: relativePath, alt: altText }).run();
      } else if (monacoEditor) {
        const selection = monacoEditor.getSelection();
        const model = monacoEditor.getModel();
        if (selection && model) {
          const md = `![${altText}](${relativePath})`;
          monacoEditor.executeEdits('toolbar', [{ range: selection, text: md }]);
          monacoEditor.focus();
        }
      } else {
        setMarkdownSource(markdownSource + `\n![${altText}](${relativePath})\n`);
      }
    },
    [
      mediaProvider,
      activeView,
      tiptapEditor,
      monacoEditor,
      markdownSource,
      setMarkdownSource,
      bumpMediaRevision,
    ],
  );

  const handleAction = useCallback(
    (id: string) => {
      if (id === 'image') {
        imageInputRef.current?.click();
        return;
      }
      if (id === 'emoji') {
        // Toggle the popover: clicking the button again closes it.
        if (emojiPickerAnchor) closeEmojiPicker();
        else openEmojiPicker();
        return;
      }
      // A focused canvas textbox takes the formatting (handleTiptap targets
      // `formattingEditor`); otherwise route to the document editor.
      if (activeSceneText || (activeView === 'wysiwyg' && tiptapEditor)) {
        handleTiptap(id);
      } else {
        handleRaw(id);
      }
    },
    [
      activeView,
      tiptapEditor,
      activeSceneText,
      handleTiptap,
      handleRaw,
      emojiPickerAnchor,
      openEmojiPicker,
      closeEmojiPicker,
    ],
  );

  // ── Picker insert (emoji or FontAwesome icon) ──────
  // Inserts a chosen picker entry at the cursor. We bypass
  // `insertAtCursor` (which routes through markdown→Tiptap conversion
  // and wraps the input in a paragraph) so entries land inline at the
  // caret rather than starting a new block. Emoji insert as a plain
  // character; FontAwesome icons insert as the `InlineIcon` Tiptap
  // node so the editor renders them inline immediately.
  const handleEmojiSelect = useCallback(
    (entry: PickerEntry) => {
      if (activeView === 'wysiwyg' && tiptapEditor) {
        if (entry.kind === 'emoji') {
          tiptapEditor.chain().focus().insertContent(entry.char).run();
        } else {
          tiptapEditor
            .chain()
            .focus()
            .insertContent({
              type: 'inlineIcon',
              attrs: { token: entry.token, family: entry.family, name: entry.name },
            })
            .run();
        }
      } else if (activeView === 'raw' && monacoEditor) {
        const insertion = entry.kind === 'emoji' ? entry.char : `{[${entry.token}]}`;
        const position = monacoEditor.getPosition();
        if (position) {
          const range = {
            startLineNumber: position.lineNumber,
            startColumn: position.column,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          };
          monacoEditor.executeEdits('picker-insert', [{ range, text: insertion }]);
          monacoEditor.focus();
        } else {
          setMarkdownSource(markdownSource + insertion);
        }
      } else {
        const insertion = entry.kind === 'emoji' ? entry.char : `{[${entry.token}]}`;
        setMarkdownSource(markdownSource + insertion);
      }
      closeEmojiPicker();
    },
    [activeView, tiptapEditor, monacoEditor, markdownSource, setMarkdownSource, closeEmojiPicker],
  );

  // ── Ctrl+K / Cmd+K → open the link dialog ────────────
  // Mirrors the behaviour of common editors (Word, Google Docs, VS Code's
  // Markdown preview): if the cursor is in a Squisq editor surface, the
  // shortcut routes through the same handler the toolbar Link button uses,
  // which prefills the dialog from the current selection (or the link
  // under the cursor) before opening.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() !== 'k') return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // Only intercept when focus is inside one of our editor surfaces.
      const inEditor = !!target.closest(
        '.squisq-wysiwyg-editor, .ProseMirror, .squisq-raw-editor-container, .monaco-editor',
      );
      if (!inEditor) return;
      e.preventDefault();
      e.stopPropagation();
      handleAction('link');
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [handleAction]);

  // ── Link dialog confirm ──────────────────────────────
  const handleLinkConfirm = useCallback(
    (text: string, url: string) => {
      if (!linkDialog) return;
      const trimmedUrl = url.trim();
      const trimmedText = text.trim();

      // Target the focused canvas textbox editor when one is active, else
      // the document editor (the dialog was opened from the same target).
      const wysiwygTarget = formattingEditor;
      if (linkDialog.target === 'wysiwyg' && wysiwygTarget) {
        if (!trimmedUrl) {
          // Empty URL on update = unlink. On insert with no URL, do nothing.
          if (linkDialog.mode === 'update') {
            wysiwygTarget.chain().focus().unsetLink().run();
          }
          setLinkDialog(null);
          return;
        }
        const visibleText = trimmedText || trimmedUrl;
        const chain = wysiwygTarget.chain().focus();
        // Insert (or replace selection) with text carrying a link mark. When
        // updating an existing link, the selection was extended to the full
        // mark range earlier, so this replaces the entire `[text](url)`.
        chain
          .insertContent({
            type: 'text',
            text: visibleText,
            marks: [{ type: 'link', attrs: { href: trimmedUrl } }],
          })
          .run();
        setLinkDialog(null);
        return;
      }

      if (linkDialog.target === 'raw' && monacoEditor) {
        const model = monacoEditor.getModel();
        if (!model) {
          setLinkDialog(null);
          return;
        }
        if (!trimmedUrl && linkDialog.mode === 'update' && linkDialog.rawRange) {
          // Empty URL on update = strip the markdown link, keep the text.
          monacoEditor.executeEdits('toolbar-link-edit', [
            { range: linkDialog.rawRange, text: trimmedText || linkDialog.initialText },
          ]);
          monacoEditor.focus();
          setLinkDialog(null);
          return;
        }
        if (!trimmedUrl) {
          setLinkDialog(null);
          return;
        }
        const visibleText = trimmedText || trimmedUrl;
        const replacement = `[${visibleText}](${trimmedUrl})`;
        const range = linkDialog.rawRange ?? monacoEditor.getSelection();
        if (!range) {
          setLinkDialog(null);
          return;
        }
        monacoEditor.executeEdits('toolbar-link-edit', [{ range, text: replacement }]);
        monacoEditor.focus();
        setLinkDialog(null);
        return;
      }

      setLinkDialog(null);
    },
    [linkDialog, formattingEditor, monacoEditor],
  );

  const groups = ['format', 'lists', 'structure', 'insert'] as const;
  const isWysiwyg = activeView === 'wysiwyg' && tiptapEditor;
  const isPreview = activeView === 'preview';

  // Formatting buttons reflect/drive the focused canvas textbox when one is
  // active, else the document's WYSIWYG editor.
  const formatActive = !!activeSceneText || isWysiwyg;
  // Inline-level textboxes (diagram/drawing labels) only support inline
  // marks — grey out block formatters so the toolbar reflects what applies.
  const INLINE_SCENE_BUTTONS = new Set([
    'bold',
    'italic',
    'strikethrough',
    'code',
    'link',
    'emoji',
  ]);
  // `block`-level textboxes (layout) add lists/blockquote/code block on top of
  // the inline marks — but NOT headings (their content is a sub-block body, so
  // a heading there would re-parse as a sibling sub-block).
  const BLOCK_SCENE_BUTTONS = new Set([...INLINE_SCENE_BUTTONS, 'ul', 'ol', 'quote', 'codeblock']);
  const buttonAllowed = (id: string): boolean => {
    if (!sceneTextLevel) return true;
    if (sceneTextLevel === 'rich') return true;
    if (sceneTextLevel === 'block') return BLOCK_SCENE_BUTTONS.has(id);
    return INLINE_SCENE_BUTTONS.has(id);
  };
  const showConvertActions =
    insertMenuAnchor !== null &&
    readSelectedText().trim().length > 0 &&
    CONVERT_BUTTONS.some((button) => buttonAllowed(button.id));

  // ── Progressive heading disclosure ───────────────────
  // H1\u2013H3 are always visible. H4 appears once the document already
  // contains an H3, H5 once it contains an H4, and H6 once it contains
  // an H5. This keeps the toolbar compact for typical short documents
  // while letting deeply nested documents reach every level.
  const maxHeadingLevelInDoc = useMemo(() => {
    if (!markdownSource) return 0;
    let max = 0;
    const lines = markdownSource.split(/\r\n|\r|\n/);
    const fencedLines = markdownFencedCodeLineMask(markdownSource);
    for (let index = 0; index < lines.length; index++) {
      if (fencedLines[index]) continue;
      const rawLine = lines[index];
      const line = rawLine.trimEnd();
      const m = /^(#{1,6})\s+\S/.exec(line);
      if (m && m[1].length > max) max = m[1].length;
    }
    return max;
  }, [markdownSource]);
  // Show H(n+1) when the document already contains H(n), starting from H3.
  const visibleHeadingMax = Math.min(6, Math.max(3, maxHeadingLevelInDoc + 1));
  const isButtonVisible = (id: string): boolean => {
    const m = /^h([1-6])$/.exec(id);
    if (!m) return true;
    return Number(m[1]) <= visibleHeadingMax;
  };
  const hasVisibleMediaButtons = MEDIA_BUTTONS.some((b) => isButtonVisible(b.id));
  const showInsertInOverflow =
    overflowIndex !== null && overflowIndex <= FIRST_MEDIA_INDEX && hasVisibleMediaButtons;

  // Detect whether cursor is inside a table (WYSIWYG mode only)
  const isInTable = isWysiwyg ? tiptapEditor.isActive('table') : false;

  // Detect current heading template (WYSIWYG mode only)
  const wysiwygTemplate = isWysiwyg
    ? tiptapEditor.isActive('heading')
      ? (tiptapEditor.getAttributes('heading')?.dataTemplate ?? '')
      : null
    : null;

  // ── Monaco heading detection (Markdown view) ─────────────────────
  // Watch the Monaco cursor and surface the template picker whenever the
  // cursor is on a heading line. `null` hides the picker; '' shows it
  // with no template selected; any other string is the current template.
  const isRawView = activeView === 'raw';
  const [rawTemplate, setRawTemplate] = useState<string | null>(null);
  const [rawHeadingLine, setRawHeadingLine] = useState<number | null>(null);
  const [rawTransition, setRawTransition] = useState<TransitionFields>(EMPTY_TRANSITION);
  useEffect(() => {
    if (!isRawView || !monacoEditor) {
      setRawTemplate(null);
      setRawHeadingLine(null);
      setRawTransition(EMPTY_TRANSITION);
      return;
    }
    const recompute = () => {
      const model = monacoEditor.getModel();
      const pos = monacoEditor.getPosition();
      if (!model || !pos) {
        setRawTemplate(null);
        setRawHeadingLine(null);
        setRawTransition(EMPTY_TRANSITION);
        return;
      }
      if (isMarkdownFencedCodeLine(model.getValue(), pos.lineNumber)) {
        setRawTemplate(null);
        setRawHeadingLine(null);
        setRawTransition(EMPTY_TRANSITION);
        return;
      }
      const line = model.getLineContent(pos.lineNumber);
      const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
      if (!headingMatch) {
        setRawTemplate(null);
        setRawHeadingLine(null);
        setRawTransition(EMPTY_TRANSITION);
        return;
      }
      setRawHeadingLine(pos.lineNumber);
      setRawTransition(readHeadingLineTransition(line));
      const annotMatch = matchTrailingTemplateAnnotation(headingMatch[1]);
      if (annotMatch) {
        const tokens = tokenizeAttrTokens(annotMatch.inner.trim());
        const firstIsParam = tokens.length > 0 && tokens[0].indexOf('=') > 0;
        setRawTemplate(firstIsParam ? '' : (tokens[0] ?? ''));
      } else {
        setRawTemplate('');
      }
    };
    recompute();
    const cursorSub = monacoEditor.onDidChangeCursorPosition(recompute);
    const contentSub = monacoEditor.onDidChangeModelContent(recompute);
    return () => {
      cursorSub.dispose();
      contentSub.dispose();
    };
  }, [isRawView, monacoEditor]);

  // Track the index of the heading the WYSIWYG cursor is in among all
  // top-level headings. Used to locate the same heading in the markdown
  // source for content-based template recommendations.
  const [wysiwygHeadingIndex, setWysiwygHeadingIndex] = useState<number | null>(null);
  useEffect(() => {
    if (!isWysiwyg || !tiptapEditor) {
      setWysiwygHeadingIndex(null);
      return;
    }
    const recompute = () => {
      if (!tiptapEditor.isActive('heading')) {
        setWysiwygHeadingIndex(null);
        return;
      }
      const cursor = tiptapEditor.state.selection.from;
      let index = -1;
      let count = 0;
      tiptapEditor.state.doc.descendants((node, pos) => {
        if (node.type.name !== 'heading') return;
        if (pos <= cursor && pos + node.nodeSize > cursor) {
          index = count;
          return false;
        }
        count++;
      });
      setWysiwygHeadingIndex(index >= 0 ? index : null);
    };
    recompute();
    tiptapEditor.on('selectionUpdate', recompute);
    tiptapEditor.on('update', recompute);
    return () => {
      tiptapEditor.off('selectionUpdate', recompute);
      tiptapEditor.off('update', recompute);
    };
  }, [isWysiwyg, tiptapEditor]);

  const currentTemplate = isWysiwyg ? wysiwygTemplate : isRawView ? rawTemplate : null;

  // Compute recommended templates for the active block. Heading slice
  // comes from markdownSource — raw view supplies the cursor line,
  // WYSIWYG supplies the heading index.
  const recommendedTemplates = useMemo(() => {
    if (currentTemplate === null) return undefined;
    let slice = null;
    if (isRawView && rawHeadingLine !== null) {
      slice = findBlockSliceAtLine(markdownSource, rawHeadingLine);
    } else if (isWysiwyg && wysiwygHeadingIndex !== null) {
      slice = findBlockSliceByHeadingIndex(markdownSource, wysiwygHeadingIndex);
    }
    if (slice === null) return undefined;
    const profile = profileBlockContents(slice);
    return recommendTemplatesForBlock(profile, TEMPLATE_NAMES).recommended;
  }, [currentTemplate, isRawView, isWysiwyg, rawHeadingLine, wysiwygHeadingIndex, markdownSource]);

  const templatePreviewBlock = useMemo(() => {
    if (!doc || currentTemplate === null) return null;
    const flat = flattenBlocks(doc.blocks);
    if (flat.length === 0) return null;

    if (isRawView && rawHeadingLine !== null) {
      return findBlockBySourceLine(flat, rawHeadingLine);
    }

    if (isWysiwyg) {
      if (layoutMode !== 'document' && activeBlockStartLine !== null) {
        return findBlockBySourceLine(flat, activeBlockStartLine);
      }
      if (wysiwygHeadingIndex !== null) {
        return flat[wysiwygHeadingIndex] ?? null;
      }
    }

    return null;
  }, [
    activeBlockStartLine,
    currentTemplate,
    doc,
    isRawView,
    isWysiwyg,
    layoutMode,
    rawHeadingLine,
    wysiwygHeadingIndex,
  ]);

  const templatePreviewSource = useMemo(
    () =>
      templatePreviewBlock
        ? {
            block: templatePreviewBlock,
            theme: previewSettings?.activeTheme ?? DEFAULT_THEME,
            viewport: previewSettings?.activeViewport ?? VIEWPORT_PRESETS.landscape,
            basePath: '/',
            mediaProvider,
            customTemplates: doc?.customTemplates,
          }
        : undefined,
    [
      mediaProvider,
      doc?.customTemplates,
      previewSettings?.activeTheme,
      previewSettings?.activeViewport,
      templatePreviewBlock,
    ],
  );

  const handleTemplatePick = (value: string) => {
    // Raw (Monaco) — rewrite the heading line's annotation suffix in place.
    if (isRawView && monacoEditor) {
      const model = monacoEditor.getModel();
      const pos = monacoEditor.getPosition();
      if (!model || !pos) return;
      if (isMarkdownFencedCodeLine(model.getValue(), pos.lineNumber)) return;
      const lineNumber = pos.lineNumber;
      const lineText = model.getLineContent(lineNumber);
      const headingMatch = lineText.match(/^(#{1,6}\s+)(.+)$/);
      if (!headingMatch) return;
      const prefix = headingMatch[1];
      const { text: bareText, params } = splitTemplateAnnotationParams(headingMatch[2]);
      const annotation = buildTemplateAnnotation(value, params);
      const newLine = annotation ? `${prefix}${bareText} ${annotation}` : `${prefix}${bareText}`;
      monacoEditor.executeEdits('toolbar-template-pick', [
        {
          range: {
            startLineNumber: lineNumber,
            startColumn: 1,
            endLineNumber: lineNumber,
            endColumn: lineText.length + 1,
          },
          text: newLine,
        },
      ]);
      monacoEditor.focus();
      return;
    }
    // WYSIWYG — update the heading node attributes.
    if (!tiptapEditor) return;
    const attrs = tiptapEditor.getAttributes('heading') as {
      dataTemplateParams?: string | null;
    };
    const dataTemplateParams = keepBlockMetaParamString(attrs.dataTemplateParams);
    if (value === '') {
      tiptapEditor
        .chain()
        .focus()
        .updateAttributes('heading', { dataTemplate: null, dataTemplateParams })
        .run();
    } else {
      tiptapEditor
        .chain()
        .focus()
        .updateAttributes('heading', { dataTemplate: value, dataTemplateParams })
        .run();
    }
  };

  // ── Current block transition ──────────────────────────
  // Non-null exactly when a block (heading) is active — same condition as
  // the template picker. Read from the Pandoc `{…}` block (canonical), with
  // the `{[…]}` params as a fallback for hand-typed transitions.
  let currentTransition: TransitionFields | null = null;
  if (isWysiwyg && wysiwygTemplate !== null) {
    const attrs = tiptapEditor.getAttributes('heading') as {
      dataBlockAttrs?: string | null;
      dataTemplateParams?: string | null;
    };
    currentTransition = readBlockAttrsTransition(attrs.dataBlockAttrs, attrs.dataTemplateParams);
  } else if (isRawView && rawTemplate !== null) {
    currentTransition = rawTransition;
  }

  const handleTransitionPick = (next: TransitionFields) => {
    // Raw (Monaco) — rewrite the heading line, writing into the `{…}` block.
    if (isRawView && monacoEditor) {
      const model = monacoEditor.getModel();
      const pos = monacoEditor.getPosition();
      if (!model || !pos) return;
      if (isMarkdownFencedCodeLine(model.getValue(), pos.lineNumber)) return;
      const lineNumber = pos.lineNumber;
      const lineText = model.getLineContent(lineNumber);
      const newLine = setHeadingLineTransition(lineText, next);
      if (newLine === lineText) return;
      monacoEditor.executeEdits('toolbar-transition-pick', [
        {
          range: {
            startLineNumber: lineNumber,
            startColumn: 1,
            endLineNumber: lineNumber,
            endColumn: lineText.length + 1,
          },
          text: newLine,
        },
      ]);
      monacoEditor.focus();
      return;
    }
    // WYSIWYG — write transitions into `{[…]}` params and migrate legacy
    // Pandoc transition keys out of `dataBlockAttrs`.
    if (!tiptapEditor) return;
    const attrs = tiptapEditor.getAttributes('heading') as {
      dataBlockAttrs?: string | null;
      dataTemplateParams?: string | null;
    };
    const updated = setHeadingAttrsTransition(attrs.dataBlockAttrs, attrs.dataTemplateParams, next);
    tiptapEditor
      .chain()
      .focus()
      .updateAttributes('heading', {
        dataBlockAttrs: updated.blockAttrsInner,
        dataTemplateParams: updated.templateParams,
      })
      .run();
  };

  // ── Per-block controls in the overflow menu ────────────
  // The template + transition pickers configure the active heading block, so
  // when either is pushed into the ··· menu we group them under a labeled
  // "<name> Block:" heading. `currentTemplate`/`currentTransition` are non-null
  // together (both gated on a heading being active); an empty template string
  // is a heading with no visual template, labeled "Heading".
  const showTemplateInOverflow = currentTemplate !== null && clippedContextual.has('template');
  const showTransitionInOverflow =
    currentTransition !== null && clippedContextual.has('transition');
  const showBlockSectionInOverflow = showTemplateInOverflow || showTransitionInOverflow;
  const overflowBlockLabel = currentTemplate ? templateLabel(currentTemplate) : 'Heading';
  const showToolbarOverflow =
    !findMode &&
    !isPreview &&
    !isCodeMode &&
    (overflowIndex !== null || clippedContextual.size > 0);

  return (
    <div
      className={`squisq-toolbar${findMode ? ' squisq-toolbar--find' : ''} ${className || ''}`}
      role="toolbar"
      aria-label={findMode ? 'Find toolbar' : 'Formatting toolbar'}
    >
      {/* Hidden file input for image picker */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleImageFile(file);
          // Reset so the same file can be re-selected
          e.target.value = '';
        }}
      />
      {/* Left slot — before view tabs */}
      {!findMode && slotLeft}
      {/* View tabs — hidden when only one view is available (e.g. code mode). */}
      {showViewTabs && (
        <div className="squisq-toolbar-view-tabs" role="tablist" aria-label="Editor view">
          {visibleViews.map((view) => {
            const viewLabel =
              view.id === 'preview' && previewSettings
                ? displayModeLabel(previewSettings.activeDisplayMode)
                : view.label;
            const tab = (
              <button
                role="tab"
                data-view={view.id}
                aria-selected={activeView === view.id}
                className={`squisq-toolbar-view-tab${activeView === view.id ? ' squisq-toolbar-view-tab--active' : ''}`}
                onClick={() => {
                  if (view.id === 'preview' && activeView === 'preview' && previewSettings) {
                    requestUseModeMenu();
                    return;
                  }
                  setActiveView(view.id);
                }}
                data-tooltip={`${viewLabel} (${platformShortcut(view.shortcutKey)})`}
              >
                <span
                  className="squisq-toolbar-view-tab-label squisq-toolbar-view-tab-label--long"
                  data-label={viewLabel}
                >
                  {viewLabel}
                </span>
                {view.shortLabel && view.shortLabel !== view.label && (
                  <span
                    className="squisq-toolbar-view-tab-label squisq-toolbar-view-tab-label--short"
                    data-label={view.shortLabel}
                  >
                    {view.shortLabel}
                  </span>
                )}
              </button>
            );

            if (view.id !== 'preview' || !previewSettings) {
              return (
                <div key={view.id} className="squisq-toolbar-view-tab-wrap" role="presentation">
                  {tab}
                </div>
              );
            }

            return (
              <div
                key={view.id}
                className={`squisq-toolbar-view-tab-wrap squisq-toolbar-use-tab${activeView === 'preview' ? ' squisq-toolbar-use-tab--active' : ''}`}
                role="presentation"
              >
                {tab}
                <PreviewModeMenu openRequest={useModeMenuRequest} />
              </div>
            );
          })}
        </div>
      )}
      {/* After-tabs slot — left side, before formatting or preview controls. */}
      {findMode ? <FindToolbar onClose={() => setFindMode(false)} /> : slotAfterTabs}
      {/* Formatting buttons — hidden in preview mode and code mode */}
      {!findMode && !isPreview && !isCodeMode && (
        <div className="squisq-toolbar-actions" ref={actionsRef}>
          {groups.map((group, gi) => (
            <div key={group} className="squisq-toolbar-group">
              {gi > 0 && <div className="squisq-toolbar-separator" />}
              {BUTTONS.filter((b) => b.group === group && isButtonVisible(b.id)).map((btn) => {
                const active =
                  btn.id === 'emoji'
                    ? emojiPickerAnchor !== null
                    : formatActive && formattingEditor
                      ? isTiptapActive(formattingEditor, btn.id)
                      : false;
                const disabled = (btn.id === 'image' && !mediaProvider) || !buttonAllowed(btn.id);
                return (
                  <button
                    key={btn.id}
                    ref={btn.id === 'emoji' ? emojiButtonRef : undefined}
                    className={`squisq-toolbar-button${active ? ' squisq-toolbar-button--active' : ''}`}
                    data-btn-index={BUTTON_INDEX_BY_ID.get(btn.id)}
                    data-tooltip={disabled ? 'Insert image (requires media provider)' : btn.title}
                    onClick={() => handleAction(btn.id)}
                    aria-label={btn.title}
                    aria-pressed={active}
                    disabled={disabled}
                  >
                    {buttonIcon(btn)}
                  </button>
                );
              })}
            </div>
          ))}

          {/* Insert menu button — collapses all media-group actions into a single dropdown */}
          <div className="squisq-toolbar-group">
            <div className="squisq-toolbar-separator" />
            <button
              ref={insertMenuButtonRef}
              className={`squisq-toolbar-button${insertMenuAnchor ? ' squisq-toolbar-button--active' : ''}`}
              data-btn-index={FIRST_MEDIA_INDEX}
              data-tooltip="Insert..."
              onClick={() => (insertMenuAnchor ? closeInsertMenu() : openInsertMenu())}
              aria-label="Insert"
              aria-expanded={insertMenuAnchor !== null}
              aria-haspopup="menu"
            >
              <Icon icon="fa-solid fa-plus" />
            </button>
          </div>

          {/* Template picker — visible when the cursor is in a heading.
              In WYSIWYG, reads from the heading node's `dataTemplate`; in
              Markdown view, parses the `{[...]}` suffix on the cursor's line.
              The `squisq-toolbar-contextual` class + data-contextual id opt
              this group (and the two below) into the clipping measurement:
              when it doesn't fit it hides here and moves into the ··· menu. */}
          {currentTemplate !== null && (
            <div
              className={`squisq-toolbar-group squisq-toolbar-contextual squisq-template-picker${clippedContextual.has('template') ? ' squisq-toolbar-contextual--clipped' : ''}`}
              data-contextual="template"
            >
              <div className="squisq-toolbar-separator" />
              <TemplatePicker
                value={currentTemplate}
                onChange={handleTemplatePick}
                colorScheme={colorScheme}
                recommended={recommendedTemplates}
                previewSource={templatePreviewSource}
              />
            </div>
          )}

          {/* Transition picker — visible alongside the template picker when a
              block (heading) is active. Writes `transition=` into the block's
              Pandoc `{…}` attribute block (the canonical home for transitions). */}
          {currentTransition !== null && (
            <div
              className={`squisq-toolbar-group squisq-toolbar-contextual squisq-transition-picker-group${clippedContextual.has('transition') ? ' squisq-toolbar-contextual--clipped' : ''}`}
              data-contextual="transition"
            >
              <div className="squisq-toolbar-separator" />
              <TransitionPicker
                value={currentTransition}
                onChange={handleTransitionPick}
                colorScheme={colorScheme}
                accentColor={previewSettings?.activeTheme.colors.primary}
              />
            </div>
          )}

          {/* Table controls — visible when cursor is in a table (WYSIWYG) */}
          {isInTable && (
            <div
              className={`squisq-toolbar-group squisq-toolbar-contextual squisq-table-controls${clippedContextual.has('table') ? ' squisq-toolbar-contextual--clipped' : ''}`}
              data-contextual="table"
            >
              <div className="squisq-toolbar-separator" />
              <span className="squisq-table-controls-label">Table:</span>
              <button
                className="squisq-toolbar-button"
                data-tooltip="Add column before"
                onClick={() => tiptapEditor!.chain().focus().addColumnBefore().run()}
                aria-label="Add column before"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                >
                  <rect x="7" y="2" width="8" height="12" rx="1" />
                  <line x1="11" y1="2" x2="11" y2="14" />
                  <line x1="1" y1="8" x2="4.5" y2="8" />
                  <line x1="2.75" y1="6.25" x2="2.75" y2="9.75" />
                </svg>
              </button>
              <button
                className="squisq-toolbar-button"
                data-tooltip="Add column after"
                onClick={() => tiptapEditor!.chain().focus().addColumnAfter().run()}
                aria-label="Add column after"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                >
                  <rect x="1" y="2" width="8" height="12" rx="1" />
                  <line x1="5" y1="2" x2="5" y2="14" />
                  <line x1="11.5" y1="8" x2="15" y2="8" />
                  <line x1="13.25" y1="6.25" x2="13.25" y2="9.75" />
                </svg>
              </button>
              <button
                className="squisq-toolbar-button"
                data-tooltip="Delete column"
                onClick={() => tiptapEditor!.chain().focus().deleteColumn().run()}
                aria-label="Delete column"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                >
                  <rect x="4" y="1" width="8" height="14" rx="1" />
                  <line x1="6" y1="5.5" x2="10" y2="10.5" />
                  <line x1="10" y1="5.5" x2="6" y2="10.5" />
                </svg>
              </button>
              <button
                className="squisq-toolbar-button"
                data-tooltip="Add row above"
                onClick={() => tiptapEditor!.chain().focus().addRowBefore().run()}
                aria-label="Add row above"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                >
                  <rect x="2" y="6" width="12" height="9" rx="1" />
                  <line x1="2" y1="10.5" x2="14" y2="10.5" />
                  <line x1="8" y1="1" x2="8" y2="4.5" />
                  <line x1="6.25" y1="2.75" x2="9.75" y2="2.75" />
                </svg>
              </button>
              <button
                className="squisq-toolbar-button"
                data-tooltip="Add row below"
                onClick={() => tiptapEditor!.chain().focus().addRowAfter().run()}
                aria-label="Add row below"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                >
                  <rect x="2" y="1" width="12" height="9" rx="1" />
                  <line x1="2" y1="5.5" x2="14" y2="5.5" />
                  <line x1="8" y1="11.5" x2="8" y2="15" />
                  <line x1="6.25" y1="13.25" x2="9.75" y2="13.25" />
                </svg>
              </button>
              <button
                className="squisq-toolbar-button"
                data-tooltip="Delete row"
                onClick={() => tiptapEditor!.chain().focus().deleteRow().run()}
                aria-label="Delete row"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                >
                  <rect x="1" y="4" width="14" height="8" rx="1" />
                  <line x1="5.5" y1="6" x2="10.5" y2="10" />
                  <line x1="10.5" y1="6" x2="5.5" y2="10" />
                </svg>
              </button>
              <button
                className="squisq-toolbar-button squisq-toolbar-button--danger"
                data-tooltip="Delete table"
                onClick={() => tiptapEditor!.chain().focus().deleteTable().run()}
                aria-label="Delete table"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                >
                  <rect x="1" y="1" width="14" height="14" rx="1" />
                  <line x1="1" y1="5.5" x2="15" y2="5.5" />
                  <line x1="5.5" y1="1" x2="5.5" y2="15" />
                  <line x1="4.5" y1="4.5" x2="11.5" y2="11.5" strokeWidth="2" />
                  <line x1="11.5" y1="4.5" x2="4.5" y2="11.5" strokeWidth="2" />
                </svg>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Overflow menu — outside the overflow:hidden actions container.
          Also appears when a contextual group (template/transition picker,
          table controls) is clipped, even if every plain button fits. */}
      {showToolbarOverflow && (
        <div className="squisq-toolbar-overflow" ref={overflowRef}>
          <button
            ref={overflowTriggerRef}
            className={`squisq-toolbar-button squisq-toolbar-overflow-trigger${showOverflow ? ' squisq-toolbar-button--active' : ''}`}
            data-tooltip="More actions"
            onClick={() => setShowOverflow((v) => !v)}
            aria-label="More actions"
            aria-expanded={showOverflow}
          >
            ···
          </button>
          {showOverflow && (
            <div
              className={`squisq-toolbar-overflow-menu squisq-toolbar-overflow-menu--${overflowPlacement}`}
            >
              {BUTTONS.slice(overflowIndex ?? BUTTONS.length)
                .filter((b) => isButtonVisible(b.id))
                // Media buttons are represented by the synthetic Insert dropdown
                // in both the visible toolbar and the overflow menu.
                .filter((b) => b.group !== 'media')
                .map((btn) => {
                  const active =
                    btn.id === 'emoji'
                      ? emojiPickerAnchor !== null
                      : formatActive && formattingEditor
                        ? isTiptapActive(formattingEditor, btn.id)
                        : false;
                  const disabled = (btn.id === 'image' && !mediaProvider) || !buttonAllowed(btn.id);
                  return (
                    <button
                      key={btn.id}
                      ref={btn.id === 'emoji' ? emojiButtonRef : undefined}
                      className={`squisq-toolbar-overflow-item${active ? ' squisq-toolbar-overflow-item--active' : ''}`}
                      onClick={() => {
                        handleAction(btn.id);
                        // Keep the overflow open when opening the emoji
                        // picker — otherwise its anchor (the overflow
                        // item) unmounts and the popover loses its ref.
                        if (btn.id !== 'emoji') setShowOverflow(false);
                      }}
                      disabled={disabled}
                    >
                      <span className="squisq-toolbar-overflow-icon">{buttonIcon(btn)}</span>
                      <span>{btn.title}</span>
                    </button>
                  );
                })}

              {showInsertInOverflow && (
                <button
                  className={`squisq-toolbar-overflow-item${insertMenuAnchor ? ' squisq-toolbar-overflow-item--active' : ''}`}
                  onClick={(event) => {
                    if (insertMenuAnchor) {
                      closeInsertMenu();
                    } else {
                      openInsertMenu(event.currentTarget);
                    }
                    setShowOverflow(false);
                  }}
                  aria-haspopup="menu"
                  aria-expanded={insertMenuAnchor !== null}
                >
                  <span className="squisq-toolbar-overflow-icon">
                    <Icon icon="fa-solid fa-plus" />
                  </span>
                  <span>Insert...</span>
                </button>
              )}

              {/* Per-block section — the template + transition pickers move
                  here when clipped, under a divider and a "<name> Block:"
                  heading that names the block they configure. */}
              {showBlockSectionInOverflow && (
                <>
                  <div
                    className="squisq-toolbar-separator"
                    style={{ margin: '4px 0', width: '100%', height: 1 }}
                  />
                  <div className="squisq-toolbar-overflow-heading">{overflowBlockLabel} Block:</div>
                </>
              )}

              {/* Contextual: template picker in overflow — only when the
                  inline one is clipped, so the control lives in exactly one
                  visible place at a time. */}
              {showTemplateInOverflow && (
                <div className="squisq-toolbar-overflow-item squisq-toolbar-overflow-template">
                  <TemplatePicker
                    value={currentTemplate!}
                    onChange={(v) => {
                      handleTemplatePick(v);
                      setShowOverflow(false);
                    }}
                    colorScheme={colorScheme}
                    recommended={recommendedTemplates}
                    previewSource={templatePreviewSource}
                  />
                </div>
              )}

              {/* Contextual: transition picker in overflow — mirrors the
                  template picker above. The menu stays open on change since
                  the flyout carries follow-up controls (direction/duration). */}
              {showTransitionInOverflow && (
                <div className="squisq-toolbar-overflow-item squisq-toolbar-overflow-template">
                  <TransitionPicker
                    value={currentTransition!}
                    onChange={handleTransitionPick}
                    colorScheme={colorScheme}
                    accentColor={previewSettings?.activeTheme.colors.primary}
                  />
                </div>
              )}

              {/* Contextual: table controls in overflow */}
              {isInTable && clippedContextual.has('table') && (
                <>
                  <div
                    className="squisq-toolbar-separator"
                    style={{ margin: '4px 0', width: '100%', height: 1 }}
                  />
                  {[
                    {
                      label: 'Add column before',
                      action: () => tiptapEditor!.chain().focus().addColumnBefore().run(),
                    },
                    {
                      label: 'Add column after',
                      action: () => tiptapEditor!.chain().focus().addColumnAfter().run(),
                    },
                    {
                      label: 'Delete column',
                      action: () => tiptapEditor!.chain().focus().deleteColumn().run(),
                    },
                    {
                      label: 'Add row above',
                      action: () => tiptapEditor!.chain().focus().addRowBefore().run(),
                    },
                    {
                      label: 'Add row below',
                      action: () => tiptapEditor!.chain().focus().addRowAfter().run(),
                    },
                    {
                      label: 'Delete row',
                      action: () => tiptapEditor!.chain().focus().deleteRow().run(),
                    },
                    {
                      label: 'Delete table',
                      action: () => tiptapEditor!.chain().focus().deleteTable().run(),
                    },
                  ].map((item) => (
                    <button
                      key={item.label}
                      className={`squisq-toolbar-overflow-item${item.label.startsWith('Delete') ? ' squisq-toolbar-overflow-item--danger' : ''}`}
                      onClick={() => {
                        item.action();
                        setShowOverflow(false);
                      }}
                    >
                      <span>{item.label}</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* After-actions slot — after formatting controls */}
      {!findMode && slotAfterActions}
      {/* Spacer — pushes right-side items to the end when the flex:1 actions
          container isn't rendered. In preview mode PreviewToolbarControls
          supplies its own flex:1 filler (and measures that leftover width to
          decide whether to collapse), so a second spacer here would split the
          slack and make the controls collapse too early. */}
      {isCodeMode && !findMode && <div style={{ flex: 1 }} />}
      {/* Version history — renders only when the host enabled versioning
          and a container is wired up. The component owns its own button
          and popover; we just give it a slot in the toolbar. */}
      {versioning && !isCodeMode && <VersionHistoryPanel />}
      {/* Keep the recorder controller mounted while its Insert menu closes so
          the portaled modal retains its open state. */}
      {allowRecording && !isCodeMode && mediaProvider && (
        <RecorderEntry open={recorderOpen} onOpenChange={setRecorderOpen} showTrigger={false} />
      )}
      {showDocumentChrome && (
        <button
          type="button"
          className={`squisq-toolbar-button${showLayoutManager ? ' squisq-toolbar-button--active' : ''}`}
          onClick={() => setShowLayoutManager(true)}
          data-tooltip="Custom layouts"
          aria-label="Custom layouts"
        >
          <Icon icon="fa-solid fa-shapes" />
        </button>
      )}
      {showDocumentChrome && activeView === 'raw' && <TransformMenu />}
      {showDocumentChrome && <ViewMenuPanel />}
      {showDocumentChrome && (
        <button
          type="button"
          className="squisq-toolbar-button"
          onClick={() => setShowDocSettings(true)}
          data-tooltip="Document settings"
          aria-label="Document settings"
        >
          <Icon icon="fa-solid fa-file-lines" />
        </button>
      )}
      {/* Files toggle — visible when callback is provided */}
      {onToggleFiles && (
        <button
          className={`squisq-toolbar-button squisq-toolbar-files-toggle${showFiles ? ' squisq-toolbar-button--active' : ''}`}
          onClick={onToggleFiles}
          data-tooltip={`${showFiles ? 'Hide' : 'Show'} Files panel${resolvedFileCount > 0 ? ` (${fileCountLabel(resolvedFileCount)})` : ''}`}
          aria-pressed={showFiles}
          aria-label={`Toggle Files panel${resolvedFileCount > 0 ? `, ${fileCountLabel(resolvedFileCount)}` : ''}`}
        >
          <Icon icon="fa-solid fa-paperclip" />
          {resolvedFileCount > 0 && (
            <span className="squisq-toolbar-files-badge" aria-hidden="true">
              {fileCountBadge(resolvedFileCount)}
            </span>
          )}
        </button>
      )}
      {/* Right slot — rightmost end of toolbar */}
      {slotRight}

      {/* Document settings (frontmatter) dialog */}
      {showDocumentChrome && showDocSettings && (
        <DocumentSettingsDialog
          markdownSource={markdownSource}
          onSave={(next) => {
            setMarkdownSource(next);
            setShowDocSettings(false);
          }}
          onClose={() => setShowDocSettings(false)}
        />
      )}

      {/* Custom layout manager — full-window list + designer dialog. */}
      {showDocumentChrome && showLayoutManager && (
        <CustomLayoutManager onClose={() => setShowLayoutManager(false)} />
      )}

      {/* Link insert/edit dialog — shared by WYSIWYG and Raw views. */}
      {linkDialog && (
        <LinkDialog
          mode={linkDialog.mode}
          initialText={linkDialog.initialText}
          initialUrl={linkDialog.initialUrl}
          onConfirm={handleLinkConfirm}
          onClose={() => setLinkDialog(null)}
          documentLinkProvider={documentLinkProvider}
          linkSchemes={linkSchemes}
        />
      )}

      {/* Insert menu — portaled to the document body so the overflow:hidden
          actions row doesn't clip it. Position computed from trigger rect. */}
      {insertMenuAnchor &&
        createPortal(
          <div
            ref={insertMenuRef}
            className="squisq-insert-menu"
            data-theme={colorScheme}
            style={{ position: 'fixed', top: insertMenuAnchor.top, left: insertMenuAnchor.left }}
            role="menu"
          >
            {showConvertActions && (
              <>
                <div className="squisq-insert-menu-header">Convert</div>
                {CONVERT_BUTTONS.map((btn) => {
                  const label = btn.id === 'table' ? 'Table' : 'Task List';
                  return (
                    <button
                      key={`convert-${btn.id}`}
                      className="squisq-toolbar-overflow-item"
                      disabled={!buttonAllowed(btn.id)}
                      onClick={() => {
                        handleConvertSelection(btn.id as 'table' | 'tasklist');
                        closeInsertMenu();
                      }}
                      role="menuitem"
                      aria-label={`Convert selection to ${label}`}
                    >
                      <span className="squisq-toolbar-overflow-icon">{buttonIcon(btn)}</span>
                      <span>{label}</span>
                    </button>
                  );
                })}
              </>
            )}
            <div
              className={`squisq-insert-menu-header${showConvertActions ? ' squisq-insert-menu-header--separated' : ''}`}
            >
              Insert
            </div>
            {MEDIA_BUTTONS.filter((b) => isButtonVisible(b.id)).map((btn) => {
              const disabled = (btn.id === 'image' && !mediaProvider) || !buttonAllowed(btn.id);
              const stripped = btn.title.replace(/^Insert\s+/i, '');
              const label = stripped.charAt(0).toUpperCase() + stripped.slice(1);
              const hasMermaidTypeMenu = btn.id === 'complexdiagram';
              const hasChartTypeMenu = btn.id === 'chart';
              const hasSubmenu = hasMermaidTypeMenu || hasChartTypeMenu;
              const submenuOpen = hasMermaidTypeMenu
                ? mermaidTypeMenuAnchor !== null
                : chartTypeMenuAnchor !== null;
              return (
                <button
                  key={btn.id}
                  ref={btn.id === 'emoji' ? emojiButtonRef : undefined}
                  className="squisq-toolbar-overflow-item"
                  disabled={disabled}
                  onClick={(event) => {
                    if (hasMermaidTypeMenu) {
                      if (mermaidTypeMenuAnchor) setMermaidTypeMenuAnchor(null);
                      else openMermaidTypeMenu(event.currentTarget);
                      return;
                    }
                    if (hasChartTypeMenu) {
                      if (chartTypeMenuAnchor) setChartTypeMenuAnchor(null);
                      else openChartTypeMenu(event.currentTarget);
                      return;
                    }
                    handleAction(btn.id);
                    if (btn.id !== 'emoji') closeInsertMenu();
                  }}
                  role="menuitem"
                  aria-haspopup={hasSubmenu ? 'menu' : undefined}
                  aria-expanded={hasSubmenu ? submenuOpen : undefined}
                >
                  <span className="squisq-toolbar-overflow-icon">{buttonIcon(btn)}</span>
                  <span>{label}</span>
                  {hasSubmenu && <Icon icon="fa-solid fa-chevron-right" />}
                </button>
              );
            })}
            {allowRecording && mediaProvider && (
              <button
                type="button"
                className="squisq-toolbar-overflow-item"
                onClick={() => {
                  setRecorderOpen(true);
                  closeInsertMenu();
                }}
                role="menuitem"
                aria-label="Record media"
              >
                <span className="squisq-toolbar-overflow-icon">
                  <Icon icon="fa-solid fa-microphone" />
                </span>
                <span>Record media</span>
              </button>
            )}
            <button
              className="squisq-toolbar-overflow-item"
              onClick={(event) => {
                if (codeSnippetMenuAnchor) setCodeSnippetMenuAnchor(null);
                else openCodeSnippetMenu(event.currentTarget);
              }}
              role="menuitem"
              aria-label="Insert Code Snippet"
              aria-haspopup="menu"
              aria-expanded={codeSnippetMenuAnchor !== null}
            >
              <span className="squisq-toolbar-overflow-icon">
                <Icon icon="fa-solid fa-file-code" />
              </span>
              <span>Code Snippet</span>
              <Icon icon="fa-solid fa-chevron-right" />
            </button>
          </div>,
          document.body,
        )}

      {mermaidTypeMenuAnchor &&
        createPortal(
          <div
            ref={mermaidTypeMenuRef}
            className="squisq-insert-menu squisq-mermaid-type-menu"
            data-theme={colorScheme}
            style={{
              position: 'fixed',
              top: mermaidTypeMenuAnchor.top,
              left: mermaidTypeMenuAnchor.left,
            }}
            role="menu"
            aria-label="Mermaid diagram type"
          >
            <div className="squisq-mermaid-type-menu-heading">
              <strong>Complex Diagram</strong>
              <span>Choose a Mermaid diagram type. Flow direction remains a separate edit.</span>
            </div>
            {(['Structure', 'Planning', 'Data'] as const).map((category) => (
              <section key={category} className="squisq-mermaid-type-section">
                <div className="squisq-insert-menu-header">{category}</div>
                <div className="squisq-mermaid-type-grid">
                  {MERMAID_DIAGRAM_TYPES.filter((entry) => entry.category === category).map(
                    (entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        className="squisq-mermaid-type-card"
                        onClick={() => handleMermaidDiagramInsert(entry)}
                        role="menuitem"
                        aria-label={`Insert ${entry.label} Mermaid diagram`}
                      >
                        <span className="squisq-mermaid-type-thumbnail">
                          <MermaidDiagramTypeThumbnail preview={entry.preview} />
                        </span>
                        <span className="squisq-mermaid-type-copy">
                          <span className="squisq-mermaid-type-title">
                            {entry.label}
                            {entry.badge && (
                              <span className="squisq-mermaid-type-badge">{entry.badge}</span>
                            )}
                          </span>
                          <span className="squisq-mermaid-type-description">
                            {entry.description}
                          </span>
                        </span>
                      </button>
                    ),
                  )}
                </div>
              </section>
            ))}
          </div>,
          document.body,
        )}

      {chartTypeMenuAnchor &&
        createPortal(
          <div
            ref={chartTypeMenuRef}
            className="squisq-insert-menu squisq-mermaid-type-menu squisq-chart-type-menu"
            data-theme={colorScheme}
            style={{
              position: 'fixed',
              top: chartTypeMenuAnchor.top,
              left: chartTypeMenuAnchor.left,
              width: CHART_TYPE_MENU_WIDTH,
            }}
            role="menu"
            aria-label="Chart type"
          >
            <div className="squisq-mermaid-type-menu-heading">
              <strong>Chart</strong>
              <span>
                Choose a chart type. The starter table becomes the chart&apos;s data — edit it to
                update the chart.
              </span>
            </div>
            <section className="squisq-mermaid-type-section">
              <div className="squisq-mermaid-type-grid">
                {CHART_TYPES.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className="squisq-mermaid-type-card"
                    onClick={() => handleChartTypeInsert(entry)}
                    role="menuitem"
                    aria-label={`Insert ${entry.label} chart`}
                  >
                    <span className="squisq-mermaid-type-thumbnail">
                      <ChartTypeThumbnail preview={entry.preview} />
                    </span>
                    <span className="squisq-mermaid-type-copy">
                      <span className="squisq-mermaid-type-title">{entry.label}</span>
                      <span className="squisq-mermaid-type-description">{entry.description}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </div>,
          document.body,
        )}

      {codeSnippetMenuAnchor &&
        createPortal(
          <div
            ref={codeSnippetMenuRef}
            className="squisq-insert-menu squisq-code-snippet-menu"
            data-theme={colorScheme}
            style={{
              position: 'fixed',
              top: codeSnippetMenuAnchor.top,
              left: codeSnippetMenuAnchor.left,
            }}
            role="menu"
            aria-label="Code snippet language"
          >
            <div className="squisq-insert-menu-header">Code Snippet</div>
            <button
              className="squisq-toolbar-overflow-item squisq-code-snippet-language"
              onClick={() => {
                handleAction('codeblock');
                closeInsertMenu();
              }}
              role="menuitem"
              aria-label="Insert Generic Code"
              disabled={!buttonAllowed('codeblock')}
            >
              <span>Generic Code</span>
              <code>plain</code>
            </button>
            {CODE_SNIPPET_LANGUAGES.map((language) => (
              <button
                key={language.fenceLanguage}
                className="squisq-toolbar-overflow-item squisq-code-snippet-language"
                onClick={() => handleCodeSnippetInsert(language)}
                role="menuitem"
                aria-label={`Insert ${language.label} code snippet`}
              >
                <span>{language.label}</span>
                <code>{language.fenceLanguage}</code>
              </button>
            ))}
          </div>,
          document.body,
        )}

      {/* Emoji picker — portaled to the document body so the toolbar's
          overflow:hidden actions row doesn't clip the popover. Position
          is computed from the trigger button's screen rect at open. */}
      {emojiPickerAnchor &&
        createPortal(
          <EmojiPicker
            open
            onSelect={handleEmojiSelect}
            onClose={closeEmojiPicker}
            anchorRef={emojiButtonRef as React.RefObject<HTMLElement>}
            theme={colorScheme === 'dark' ? 'dark' : 'light'}
            style={{
              position: 'fixed',
              top: emojiPickerAnchor.top,
              left: emojiPickerAnchor.left,
            }}
          />,
          document.body,
        )}
    </div>
  );
}
