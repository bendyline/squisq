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
import type { Editor as TiptapEditor } from '@tiptap/core';
import type { IRange } from 'monaco-editor';
import { useEditorContext, type EditorView } from './EditorContext';
import { VersionHistoryPanel } from './VersionHistoryPanel';
import { RecorderEntry } from './RecorderEntry';
import { ViewMenuPanel } from './ViewMenuPanel';
import { TemplatePicker, TEMPLATE_NAMES } from './TemplatePicker';
import { profileBlockContents, recommendTemplatesForBlock } from '@bendyline/squisq/recommend';
import { findBlockSliceAtLine, findBlockSliceByHeadingIndex } from './blockSlice';
import { LinkDialog } from './LinkDialog';
import { DocumentSettingsDialog } from './DocumentSettingsDialog';
import { EmojiPicker, EMOJI_PICKER_WIDTH, EMOJI_PICKER_MAX_HEIGHT } from './EmojiPicker';
import type { PickerEntry } from './emojiData';
import { createPortal } from 'react-dom';

const VIEWS: { id: EditorView; label: string; shortLabel?: string; shortcut: string }[] = [
  { id: 'wysiwyg', label: 'Editor', shortcut: '⌘1' },
  { id: 'raw', label: 'Markdown', shortLabel: 'MD', shortcut: '⌘2' },
  { id: 'preview', label: 'Play', shortcut: '⌘3' },
];

export interface ToolbarProps {
  /** Additional class name */
  className?: string;
  /** Whether the Files panel is currently shown */
  showFiles?: boolean;
  /** Toggle the Files panel. When provided, a "Files" button appears in the toolbar. */
  onToggleFiles?: () => void;
  /** Content rendered at the left edge of the toolbar, before the view tabs. */
  slotLeft?: ReactNode;
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
}

interface ToolbarButton {
  id: string;
  label: string;
  icon: string;
  title: string;
  group: 'format' | 'lists' | 'structure' | 'insert' | 'media';
  /** CSS font style for the icon (e.g. italic for the I button) */
  iconStyle?: React.CSSProperties;
}

const BUTTONS: ToolbarButton[] = [
  // Format group — B/I/S trio.
  {
    id: 'bold',
    label: 'B',
    icon: 'B',
    title: 'Bold (Ctrl+B)',
    group: 'format',
    iconStyle: { fontWeight: 700 },
  },
  {
    id: 'italic',
    label: 'I',
    icon: 'I',
    title: 'Italic (Ctrl+I)',
    group: 'format',
    iconStyle: { fontStyle: 'italic' },
  },
  {
    id: 'strikethrough',
    label: 'S',
    icon: 'S',
    title: 'Strikethrough',
    group: 'format',
    iconStyle: { textDecoration: 'line-through' },
  },

  // Lists group — sits between format and structure so bullets/numbers
  // are adjacent to the inline formatters people reach for together.
  { id: 'ul', label: '•', icon: '•', title: 'Bullet list', group: 'lists' },
  { id: 'ol', label: '1.', icon: '1.', title: 'Numbered list', group: 'lists' },

  // Structure group
  { id: 'h1', label: 'H1', icon: 'H1', title: 'Heading 1', group: 'structure' },
  { id: 'h2', label: 'H2', icon: 'H2', title: 'Heading 2', group: 'structure' },
  { id: 'h3', label: 'H3', icon: 'H3', title: 'Heading 3', group: 'structure' },
  { id: 'h4', label: 'H4', icon: 'H4', title: 'Heading 4', group: 'structure' },
  { id: 'h5', label: 'H5', icon: 'H5', title: 'Heading 5', group: 'structure' },
  { id: 'h6', label: 'H6', icon: 'H6', title: 'Heading 6', group: 'structure' },

  // Insert group — block-level inserts (quote, code blocks, rules)
  { id: 'quote', label: '❝', icon: '❝', title: 'Blockquote', group: 'insert' },
  { id: 'codeblock', label: '{ }', icon: '{ }', title: 'Code block', group: 'insert' },
  { id: 'code', label: '</>', icon: '</>', title: 'Inline code', group: 'insert' },
  { id: 'hr', label: '—', icon: '—', title: 'Horizontal rule', group: 'insert' },

  // Media group — links, tables, images, emoji
  { id: 'link', label: '🔗', icon: '🔗', title: 'Insert link', group: 'media' },
  { id: 'table', label: 'table', icon: '', title: 'Insert table', group: 'media' },
  { id: 'image', label: '🖼', icon: '🖼', title: 'Insert image', group: 'media' },
  { id: 'emoji', label: '😊', icon: '😊', title: 'Insert emoji', group: 'media' },
];

// ─── Inline SVG icons (line-art, currentColor) ──────────

const TABLE_ICON = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 14 14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
  >
    <rect x="1" y="1" width="12" height="12" rx="1" />
    <line x1="1" y1="5" x2="13" y2="5" />
    <line x1="1" y1="9" x2="13" y2="9" />
    <line x1="5" y1="1" x2="5" y2="13" />
    <line x1="9" y1="1" x2="9" y2="13" />
  </svg>
);

const LINK_ICON = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 14 14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M5.75 8.25 L8.25 5.75" />
    <path d="M6.5 3.75 L8 2.25 a2.5 2.5 0 0 1 3.54 3.54 L10 7.25" />
    <path d="M7.5 10.25 L6 11.75 a2.5 2.5 0 0 1 -3.54 -3.54 L4 6.75" />
  </svg>
);

const IMAGE_ICON = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 14 14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="1.5" y="2.5" width="11" height="9" rx="1" />
    <circle cx="5" cy="5.5" r="0.9" />
    <path d="M2 10 L5.5 7 L8 9 L10 7.5 L12.5 10" />
  </svg>
);

const PAPERCLIP_ICON = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 14 14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M11 4 L5.5 9.5 a1.75 1.75 0 0 0 2.5 2.5 L12.5 7.5 a3 3 0 0 0 -4.25 -4.25 L3 8.5 a4.25 4.25 0 0 0 6 6 L13 10.5" />
  </svg>
);

const EMOJI_ICON = (
  <svg
    width="14"
    height="14"
    viewBox="0 0 14 14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="7" cy="7" r="5.25" />
    <circle cx="5.25" cy="5.75" r="0.6" fill="currentColor" stroke="none" />
    <circle cx="8.75" cy="5.75" r="0.6" fill="currentColor" stroke="none" />
    <path d="M4.75 8.5 a2.5 2.5 0 0 0 4.5 0" />
  </svg>
);

/** Returns an SVG element when the button id maps to one, otherwise null. */
function buttonIconSvg(id: string): React.ReactNode | null {
  switch (id) {
    case 'table':
      return TABLE_ICON;
    case 'link':
      return LINK_ICON;
    case 'image':
      return IMAGE_ICON;
    case 'emoji':
      return EMOJI_ICON;
    default:
      return null;
  }
}

// ─── Tiptap active-state map ────────────────────────────

/** Returns true if the given button id is currently active in Tiptap */
function isTiptapActive(editor: TiptapEditor, id: string): boolean {
  if (!editor) return false;
  switch (id) {
    case 'bold':
      return editor.isActive('bold');
    case 'italic':
      return editor.isActive('italic');
    case 'strikethrough':
      return editor.isActive('strike');
    case 'code':
      return editor.isActive('code');
    case 'h1':
      return editor.isActive('heading', { level: 1 });
    case 'h2':
      return editor.isActive('heading', { level: 2 });
    case 'h3':
      return editor.isActive('heading', { level: 3 });
    case 'h4':
      return editor.isActive('heading', { level: 4 });
    case 'h5':
      return editor.isActive('heading', { level: 5 });
    case 'h6':
      return editor.isActive('heading', { level: 6 });
    case 'quote':
      return editor.isActive('blockquote');
    case 'ul':
      return editor.isActive('bulletList');
    case 'ol':
      return editor.isActive('orderedList');
    case 'codeblock':
      return editor.isActive('codeBlock');
    default:
      return false;
  }
}

/**
 * Formatting toolbar.
 * - WYSIWYG: calls Tiptap chain commands (toggleBold, etc.)
 * - Raw: appends markdown syntax to the source
 */
export function Toolbar({
  className,
  showFiles,
  onToggleFiles,
  slotLeft,
  slotAfterActions,
  slotRight,
  showPlayTab = true,
}: ToolbarProps) {
  const {
    activeView,
    setActiveView,
    markdownSource,
    setMarkdownSource,
    tiptapEditor,
    monacoEditor,
    mediaProvider,
    editorMode,
    versioning,
    allowRecording,
    documentLinkProvider,
    theme,
  } = useEditorContext();
  const isCodeMode = editorMode === 'code';
  // In code mode only the raw view is meaningful; the WYSIWYG and Preview
  // surfaces aren't mounted, so hide their tabs.
  const visibleViews = VIEWS.filter((v) => {
    if (isCodeMode) return v.id === 'raw';
    if (v.id === 'preview' && !showPlayTab) return false;
    return true;
  });
  const showViewTabs = visibleViews.length > 1;

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

  // ── Narrow-screen detection ──────────────────────────
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const handler = (e: MediaQueryListEvent) => setIsNarrow(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // ── Overflow detection ────────────────────────────────
  const actionsRef = useRef<HTMLDivElement>(null);
  const [measuredOverflowIndex, setMeasuredOverflowIndex] = useState<number | null>(null);
  const [showOverflow, setShowOverflow] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);

  // Document settings (frontmatter) dialog
  const [showDocSettings, setShowDocSettings] = useState(false);

  // On narrow screens, force all buttons into the overflow menu
  const overflowIndex = isNarrow ? 0 : measuredOverflowIndex;

  useEffect(() => {
    if (isNarrow) return; // Skip measurement on narrow — everything overflows
    const container = actionsRef.current;
    if (!container) return;

    const measure = () => {
      const containerRight = container.getBoundingClientRect().right;
      const children = container.querySelectorAll<HTMLElement>(
        ':scope > .squisq-toolbar-group > .squisq-toolbar-button',
      );
      let firstHidden: number | null = null;
      children.forEach((child, i) => {
        if (firstHidden !== null) return;
        const rect = child.getBoundingClientRect();
        // A button is hidden if its right edge extends past the container
        if (rect.right > containerRight + 2) {
          firstHidden = i;
        }
      });
      setMeasuredOverflowIndex(firstHidden);
    };

    const ro = new ResizeObserver(measure);
    ro.observe(container);
    measure();
    return () => ro.disconnect();
  }, [activeView, isNarrow]);

  // Close overflow menu on outside click
  useEffect(() => {
    if (!showOverflow) return;
    const handleClick = (e: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setShowOverflow(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showOverflow]);

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
    if (!tiptapEditor) return;
    tiptapEditor.on('transaction', forceUpdate);
    return () => {
      tiptapEditor.off('transaction', forceUpdate);
    };
  }, [tiptapEditor]);

  // ── Tiptap handler ─────────────────────────────────────
  const handleTiptap = useCallback(
    (id: string) => {
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
      }
    },
    [tiptapEditor],
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
        }

        // Apply the edit via Monaco's executeEdits for proper undo support
        const range = selection;
        monacoEditor.executeEdits('toolbar', [{ range, text: replacement }]);

        // If no selection, select the placeholder text so user can type over it
        if (!hasSelection && newCursorOffset > 0) {
          const startPos = model.getPositionAt(
            model.getOffsetAt(range.getStartPosition()) + newCursorOffset,
          );
          // Just place cursor after the prefix
          monacoEditor.setPosition(startPos);
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
        }
        if (insertion) {
          setMarkdownSource(markdownSource + insertion);
        }
      }
    },
    [monacoEditor, markdownSource, setMarkdownSource],
  );

  // ── Image upload handler ───────────────────────────────
  const handleImageFile = useCallback(
    async (file: File) => {
      if (!mediaProvider) return;
      const buffer = await file.arrayBuffer();
      const relativePath = await mediaProvider.addMedia(file.name, buffer, file.type);
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
    [mediaProvider, activeView, tiptapEditor, monacoEditor, markdownSource, setMarkdownSource],
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
      if (activeView === 'wysiwyg' && tiptapEditor) {
        handleTiptap(id);
      } else {
        handleRaw(id);
      }
    },
    [
      activeView,
      tiptapEditor,
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

      if (linkDialog.target === 'wysiwyg' && tiptapEditor) {
        if (!trimmedUrl) {
          // Empty URL on update = unlink. On insert with no URL, do nothing.
          if (linkDialog.mode === 'update') {
            tiptapEditor.chain().focus().unsetLink().run();
          }
          setLinkDialog(null);
          return;
        }
        const visibleText = trimmedText || trimmedUrl;
        const chain = tiptapEditor.chain().focus();
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
    [linkDialog, tiptapEditor, monacoEditor],
  );

  const groups = ['format', 'lists', 'structure', 'insert', 'media'] as const;
  const isWysiwyg = activeView === 'wysiwyg' && tiptapEditor;
  const isPreview = activeView === 'preview';

  // ── Progressive heading disclosure ───────────────────
  // H1\u2013H3 are always visible. H4 appears once the document already
  // contains an H3, H5 once it contains an H4, and H6 once it contains
  // an H5. This keeps the toolbar compact for typical short documents
  // while letting deeply nested documents reach every level.
  const maxHeadingLevelInDoc = useMemo(() => {
    if (!markdownSource) return 0;
    let max = 0;
    let inFence = false;
    for (const rawLine of markdownSource.split('\n')) {
      const line = rawLine.trimEnd();
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
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
  useEffect(() => {
    if (!isRawView || !monacoEditor) {
      setRawTemplate(null);
      setRawHeadingLine(null);
      return;
    }
    const recompute = () => {
      const model = monacoEditor.getModel();
      const pos = monacoEditor.getPosition();
      if (!model || !pos) {
        setRawTemplate(null);
        setRawHeadingLine(null);
        return;
      }
      const line = model.getLineContent(pos.lineNumber);
      const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
      if (!headingMatch) {
        setRawTemplate(null);
        setRawHeadingLine(null);
        return;
      }
      setRawHeadingLine(pos.lineNumber);
      const annotMatch = headingMatch[1].match(/\s*\{\[([^\]]+)\]\}[\s\]}]*$/);
      if (annotMatch) {
        // First whitespace-delimited token is the template name; the rest are params.
        const name = annotMatch[1].trim().split(/\s+/)[0];
        setRawTemplate(name);
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

  const handleTemplatePick = (value: string) => {
    // Raw (Monaco) — rewrite the heading line's annotation suffix in place.
    if (isRawView && monacoEditor) {
      const model = monacoEditor.getModel();
      const pos = monacoEditor.getPosition();
      if (!model || !pos) return;
      const lineNumber = pos.lineNumber;
      const lineText = model.getLineContent(lineNumber);
      const headingMatch = lineText.match(/^(#{1,6}\s+)(.+)$/);
      if (!headingMatch) return;
      const prefix = headingMatch[1];
      // Strip any existing trailing annotation
      const bareText = headingMatch[2].replace(/\s*\{\[[^\]]+\]\}[\s\]}]*$/, '').trimEnd();
      const newLine = value === '' ? `${prefix}${bareText}` : `${prefix}${bareText} {[${value}]}`;
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
    if (value === '') {
      tiptapEditor
        .chain()
        .focus()
        .updateAttributes('heading', { dataTemplate: null, dataTemplateParams: null })
        .run();
    } else {
      tiptapEditor.chain().focus().updateAttributes('heading', { dataTemplate: value }).run();
    }
  };

  return (
    <div
      className={`squisq-toolbar ${className || ''}`}
      role="toolbar"
      aria-label="Formatting toolbar"
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
      {slotLeft}
      {/* View tabs — hidden when only one view is available (e.g. code mode). */}
      {showViewTabs && (
        <div className="squisq-toolbar-view-tabs" role="tablist" aria-label="Editor view">
          {visibleViews.map((view) => (
            <button
              key={view.id}
              role="tab"
              data-view={view.id}
              aria-selected={activeView === view.id}
              className={`squisq-toolbar-view-tab${activeView === view.id ? ' squisq-toolbar-view-tab--active' : ''}`}
              onClick={() => setActiveView(view.id)}
              data-tooltip={`${view.label} (${view.shortcut})`}
            >
              <span
                className="squisq-toolbar-view-tab-label squisq-toolbar-view-tab-label--long"
                data-label={view.label}
              >
                {view.label}
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
          ))}
        </div>
      )}
      {/* Formatting buttons — hidden in preview mode, narrow screens, and code mode */}
      {!isPreview && !isNarrow && !isCodeMode && (
        <div className="squisq-toolbar-actions" ref={actionsRef}>
          {groups.map((group, gi) => (
            <div key={group} className="squisq-toolbar-group">
              {gi > 0 && <div className="squisq-toolbar-separator" />}
              {BUTTONS.filter((b) => b.group === group && isButtonVisible(b.id)).map((btn) => {
                const active =
                  btn.id === 'emoji'
                    ? emojiPickerAnchor !== null
                    : isWysiwyg
                      ? isTiptapActive(tiptapEditor, btn.id)
                      : false;
                const disabled = btn.id === 'image' && !mediaProvider;
                return (
                  <button
                    key={btn.id}
                    ref={btn.id === 'emoji' ? emojiButtonRef : undefined}
                    className={`squisq-toolbar-button${active ? ' squisq-toolbar-button--active' : ''}`}
                    data-tooltip={disabled ? 'Insert image (requires media provider)' : btn.title}
                    onClick={() => handleAction(btn.id)}
                    aria-label={btn.title}
                    aria-pressed={active}
                    disabled={disabled}
                    style={btn.iconStyle}
                  >
                    {buttonIconSvg(btn.id) ?? btn.icon}
                  </button>
                );
              })}
            </div>
          ))}

          {/* Template picker — visible when the cursor is in a heading.
              In WYSIWYG, reads from the heading node's `dataTemplate`; in
              Markdown view, parses the `{[...]}` suffix on the cursor's line. */}
          {currentTemplate !== null && (
            <>
              <div className="squisq-toolbar-separator" />
              <div className="squisq-toolbar-group squisq-template-picker">
                <TemplatePicker
                  value={currentTemplate}
                  onChange={handleTemplatePick}
                  recommended={recommendedTemplates}
                />
              </div>
            </>
          )}

          {/* Table controls — visible when cursor is in a table (WYSIWYG) */}
          {isInTable && (
            <>
              <div className="squisq-toolbar-separator" />
              <div className="squisq-toolbar-group squisq-table-controls">
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
            </>
          )}
        </div>
      )}

      {/* Overflow menu — outside the overflow:hidden actions container */}
      {!isPreview && !isCodeMode && overflowIndex !== null && (
        <div className="squisq-toolbar-overflow" ref={overflowRef}>
          <button
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
              {BUTTONS.slice(overflowIndex)
                .filter((b) => isButtonVisible(b.id))
                .map((btn) => {
                  const active =
                    btn.id === 'emoji'
                      ? emojiPickerAnchor !== null
                      : isWysiwyg
                        ? isTiptapActive(tiptapEditor, btn.id)
                        : false;
                  const disabled = btn.id === 'image' && !mediaProvider;
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
                      {buttonIconSvg(btn.id) ?? (
                        <span className="squisq-toolbar-overflow-icon" style={btn.iconStyle}>
                          {btn.icon}
                        </span>
                      )}
                      <span>{btn.title}</span>
                    </button>
                  );
                })}

              {/* Contextual: template picker in overflow */}
              {currentTemplate !== null && (
                <div className="squisq-toolbar-overflow-item squisq-toolbar-overflow-template">
                  <span>Template:</span>
                  <TemplatePicker
                    value={currentTemplate}
                    onChange={(v) => {
                      handleTemplatePick(v);
                      setShowOverflow(false);
                    }}
                    recommended={recommendedTemplates}
                  />
                </div>
              )}

              {/* Contextual: table controls in overflow */}
              {isInTable && (
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
      {slotAfterActions}
      {/* Spacer — only needed when the actions container (which has flex:1
          and already pushes right-side items to the end) isn't rendered. */}
      {(isPreview || isNarrow || isCodeMode) && <div style={{ flex: 1 }} />}
      {/* Version history — renders only when the host enabled versioning
          and a container is wired up. The component owns its own button
          and popover; we just give it a slot in the toolbar. */}
      {versioning && !isCodeMode && <VersionHistoryPanel />}
      {/* Media recorder — surfaces when the host has a mediaProvider
          and hasn't opted out. RecorderEntry returns null when no
          provider is wired, so this stays a no-op for hosts that
          haven't enabled media at all. */}
      {allowRecording && !isCodeMode && mediaProvider && <RecorderEntry />}
      {!isCodeMode && (
        <button
          type="button"
          className="squisq-toolbar-button"
          onClick={() => setShowDocSettings(true)}
          data-tooltip="Document settings"
          aria-label="Document settings"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M3 2.5h7l3 3v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1Z"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
            <path d="M10 2.5v3h3" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            <path
              d="M5 8.5h6M5 11h4"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
      {!isCodeMode && <ViewMenuPanel />}
      {/* Files toggle — visible when callback is provided */}
      {onToggleFiles && (
        <button
          className={`squisq-toolbar-button squisq-toolbar-files-toggle${showFiles ? ' squisq-toolbar-button--active' : ''}`}
          onClick={onToggleFiles}
          data-tooltip={showFiles ? 'Hide Files panel' : 'Show Files panel'}
          aria-pressed={showFiles}
          aria-label="Toggle Files panel"
        >
          {PAPERCLIP_ICON}
        </button>
      )}
      {/* Right slot — rightmost end of toolbar */}
      {slotRight}

      {/* Document settings (frontmatter) dialog */}
      {showDocSettings && (
        <DocumentSettingsDialog
          markdownSource={markdownSource}
          onSave={(next) => {
            setMarkdownSource(next);
            setShowDocSettings(false);
          }}
          onClose={() => setShowDocSettings(false)}
        />
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
        />
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
            theme={theme === 'dark' ? 'dark' : 'light'}
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
