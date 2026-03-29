/**
 * Toolbar
 *
 * Formatting toolbar that provides common markdown editing actions.
 * In WYSIWYG mode, uses Tiptap's chain commands to toggle marks / set nodes.
 * In Raw mode, appends markdown syntax at the cursor (or end of source).
 * Hidden in Preview mode.
 */

import type { ReactNode } from 'react';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { Editor as TiptapEditor } from '@tiptap/core';
import { useEditorContext, type EditorView } from './EditorContext';
import { getAvailableTemplates } from '@bendyline/squisq/doc';

const VIEWS: { id: EditorView; label: string; shortcut: string }[] = [
  { id: 'wysiwyg', label: 'Editor', shortcut: '⌘1' },
  { id: 'raw', label: 'Raw', shortcut: '⌘2' },
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
}

interface ToolbarButton {
  id: string;
  label: string;
  icon: string;
  title: string;
  group: 'format' | 'structure' | 'insert';
  /** CSS font style for the icon (e.g. italic for the I button) */
  iconStyle?: React.CSSProperties;
}

const BUTTONS: ToolbarButton[] = [
  // Format group
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
  { id: 'code', label: '<>', icon: '`', title: 'Inline code', group: 'format' },

  // Structure group
  { id: 'h1', label: 'H1', icon: 'H1', title: 'Heading 1', group: 'structure' },
  { id: 'h2', label: 'H2', icon: 'H2', title: 'Heading 2', group: 'structure' },
  { id: 'h3', label: 'H3', icon: 'H3', title: 'Heading 3', group: 'structure' },
  { id: 'quote', label: '❝', icon: '❝', title: 'Blockquote', group: 'structure' },

  // Insert group
  { id: 'ul', label: '•', icon: '•', title: 'Bullet list', group: 'insert' },
  { id: 'ol', label: '1.', icon: '1.', title: 'Numbered list', group: 'insert' },
  { id: 'codeblock', label: '{ }', icon: '{ }', title: 'Code block', group: 'insert' },
  { id: 'hr', label: '—', icon: '—', title: 'Horizontal rule', group: 'insert' },
  { id: 'link', label: '🔗', icon: '🔗', title: 'Insert link', group: 'insert' },
  { id: 'table', label: 'table', icon: '', title: 'Insert table', group: 'insert' },
  { id: 'image', label: '🖼', icon: '🖼', title: 'Insert image', group: 'insert' },
];

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
}: ToolbarProps) {
  const {
    activeView,
    setActiveView,
    markdownSource,
    setMarkdownSource,
    tiptapEditor,
    monacoEditor,
    mediaProvider,
  } = useEditorContext();

  // Hidden file input for image picker
  const imageInputRef = useRef<HTMLInputElement>(null);

  // ── Overflow detection ────────────────────────────────
  const actionsRef = useRef<HTMLDivElement>(null);
  const [overflowIndex, setOverflowIndex] = useState<number | null>(null);
  const [showOverflow, setShowOverflow] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = actionsRef.current;
    if (!container) return;

    const measure = () => {
      const containerRight = container.getBoundingClientRect().right;
      const children = container.querySelectorAll<HTMLElement>(':scope > .squisq-toolbar-group > .squisq-toolbar-button');
      let firstHidden: number | null = null;
      children.forEach((child, i) => {
        if (firstHidden !== null) return;
        const rect = child.getBoundingClientRect();
        // A button is hidden if its right edge extends past the container
        if (rect.right > containerRight + 2) {
          firstHidden = i;
        }
      });
      setOverflowIndex(firstHidden);
    };

    const ro = new ResizeObserver(measure);
    ro.observe(container);
    measure();
    return () => ro.disconnect();
  }, [activeView]);

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
          const url = window.prompt('URL:');
          if (url) {
            (chain as unknown as Record<string, (opts: { href: string }) => typeof chain>)
              .setLink?.({ href: url })
              .run();
          }
          break;
        }
        case 'table':
          tiptapEditor
            .chain()
            .focus()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run();
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
            if (hasSelection) {
              replacement = '[' + selectedText + '](url)';
            } else {
              replacement = '[link text](url)';
              newCursorOffset = 1; // inside the []
            }
            break;
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
          const _placeholderLen =
            replacement.length -
            newCursorOffset -
            (replacement.length -
              replacement.lastIndexOf(replacement.charAt(replacement.length - 1)));
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
        tiptapEditor
          .chain()
          .focus()
          .setImage({ src: relativePath, alt: altText })
          .run();
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
      if (activeView === 'wysiwyg' && tiptapEditor) {
        handleTiptap(id);
      } else {
        handleRaw(id);
      }
    },
    [activeView, tiptapEditor, handleTiptap, handleRaw],
  );

  const groups = ['format', 'structure', 'insert'] as const;
  const isWysiwyg = activeView === 'wysiwyg' && tiptapEditor;
  const isPreview = activeView === 'preview';

  // Detect whether cursor is inside a table (WYSIWYG mode only)
  const isInTable = isWysiwyg ? tiptapEditor.isActive('table') : false;

  // Detect current heading template (WYSIWYG mode only)
  const currentTemplate = isWysiwyg
    ? tiptapEditor.isActive('heading')
      ? (tiptapEditor.getAttributes('heading')?.dataTemplate ?? '')
      : null
    : null;

  const handleTemplatePick = (value: string) => {
    if (!tiptapEditor) return;
    if (value === '') {
      // Clear template
      tiptapEditor
        .chain()
        .focus()
        .updateAttributes('heading', { dataTemplate: null, dataTemplateParams: null })
        .run();
    } else {
      tiptapEditor.chain().focus().updateAttributes('heading', { dataTemplate: value }).run();
    }
  };

  const templateNames = getAvailableTemplates();

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
      {/* View tabs */}
      <div className="squisq-toolbar-view-tabs" role="tablist" aria-label="Editor view">
        {VIEWS.map((view) => (
          <button
            key={view.id}
            role="tab"
            data-view={view.id}
            aria-selected={activeView === view.id}
            className={`squisq-toolbar-view-tab${activeView === view.id ? ' squisq-toolbar-view-tab--active' : ''}`}
            onClick={() => setActiveView(view.id)}
            title={`${view.label} (${view.shortcut})`}
          >
            {view.label}
          </button>
        ))}
      </div>
      {/* Formatting buttons — hidden in preview mode */}
      {!isPreview && (
        <div className="squisq-toolbar-actions" ref={actionsRef}>
          {groups.map((group, gi) => (
            <div key={group} className="squisq-toolbar-group">
              {gi > 0 && <div className="squisq-toolbar-separator" />}
              {BUTTONS.filter((b) => b.group === group).map((btn) => {
                const active = isWysiwyg ? isTiptapActive(tiptapEditor, btn.id) : false;
                const disabled = btn.id === 'image' && !mediaProvider;
                return (
                  <button
                    key={btn.id}
                    className={`squisq-toolbar-button${active ? ' squisq-toolbar-button--active' : ''}`}
                    title={disabled ? 'Insert image (requires media provider)' : btn.title}
                    onClick={() => handleAction(btn.id)}
                    aria-label={btn.title}
                    aria-pressed={active}
                    disabled={disabled}
                    style={btn.iconStyle}
                  >
                    {btn.id === 'table' ? (
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                        <rect x="1" y="1" width="12" height="12" rx="1" />
                        <line x1="1" y1="5" x2="13" y2="5" />
                        <line x1="1" y1="9" x2="13" y2="9" />
                        <line x1="5" y1="1" x2="5" y2="13" />
                        <line x1="9" y1="1" x2="9" y2="13" />
                      </svg>
                    ) : (
                      btn.icon
                    )}
                  </button>
                );
              })}
            </div>
          ))}

          {/* Template picker — visible when cursor is in a heading (WYSIWYG) */}
          {currentTemplate !== null && (
            <>
              <div className="squisq-toolbar-separator" />
              <div className="squisq-toolbar-group squisq-template-picker">
                <label
                  className="squisq-template-picker-label"
                  title="Block template for this heading"
                >
                  Template:
                  <select
                    className="squisq-template-picker-select"
                    value={currentTemplate}
                    onChange={(e) => handleTemplatePick(e.target.value)}
                  >
                    <option value="">— none —</option>
                    {templateNames.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
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
                  title="Add column before"
                  onClick={() => tiptapEditor!.chain().focus().addColumnBefore().run()}
                  aria-label="Add column before"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <rect x="7" y="2" width="8" height="12" rx="1" />
                    <line x1="11" y1="2" x2="11" y2="14" />
                    <line x1="1" y1="8" x2="4.5" y2="8" />
                    <line x1="2.75" y1="6.25" x2="2.75" y2="9.75" />
                  </svg>
                </button>
                <button
                  className="squisq-toolbar-button"
                  title="Add column after"
                  onClick={() => tiptapEditor!.chain().focus().addColumnAfter().run()}
                  aria-label="Add column after"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <rect x="1" y="2" width="8" height="12" rx="1" />
                    <line x1="5" y1="2" x2="5" y2="14" />
                    <line x1="11.5" y1="8" x2="15" y2="8" />
                    <line x1="13.25" y1="6.25" x2="13.25" y2="9.75" />
                  </svg>
                </button>
                <button
                  className="squisq-toolbar-button"
                  title="Delete column"
                  onClick={() => tiptapEditor!.chain().focus().deleteColumn().run()}
                  aria-label="Delete column"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <rect x="4" y="1" width="8" height="14" rx="1" />
                    <line x1="6" y1="5.5" x2="10" y2="10.5" />
                    <line x1="10" y1="5.5" x2="6" y2="10.5" />
                  </svg>
                </button>
                <button
                  className="squisq-toolbar-button"
                  title="Add row above"
                  onClick={() => tiptapEditor!.chain().focus().addRowBefore().run()}
                  aria-label="Add row above"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <rect x="2" y="6" width="12" height="9" rx="1" />
                    <line x1="2" y1="10.5" x2="14" y2="10.5" />
                    <line x1="8" y1="1" x2="8" y2="4.5" />
                    <line x1="6.25" y1="2.75" x2="9.75" y2="2.75" />
                  </svg>
                </button>
                <button
                  className="squisq-toolbar-button"
                  title="Add row below"
                  onClick={() => tiptapEditor!.chain().focus().addRowAfter().run()}
                  aria-label="Add row below"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <rect x="2" y="1" width="12" height="9" rx="1" />
                    <line x1="2" y1="5.5" x2="14" y2="5.5" />
                    <line x1="8" y1="11.5" x2="8" y2="15" />
                    <line x1="6.25" y1="13.25" x2="9.75" y2="13.25" />
                  </svg>
                </button>
                <button
                  className="squisq-toolbar-button"
                  title="Delete row"
                  onClick={() => tiptapEditor!.chain().focus().deleteRow().run()}
                  aria-label="Delete row"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <rect x="1" y="4" width="14" height="8" rx="1" />
                    <line x1="5.5" y1="6" x2="10.5" y2="10" />
                    <line x1="10.5" y1="6" x2="5.5" y2="10" />
                  </svg>
                </button>
                <button
                  className="squisq-toolbar-button squisq-toolbar-button--danger"
                  title="Delete table"
                  onClick={() => tiptapEditor!.chain().focus().deleteTable().run()}
                  aria-label="Delete table"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
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

          {/* Overflow menu — shown when buttons are clipped */}
          {overflowIndex !== null && (
            <div className="squisq-toolbar-overflow" ref={overflowRef}>
              <button
                className={`squisq-toolbar-button squisq-toolbar-overflow-trigger${showOverflow ? ' squisq-toolbar-button--active' : ''}`}
                title="More actions"
                onClick={() => setShowOverflow((v) => !v)}
                aria-label="More actions"
                aria-expanded={showOverflow}
              >
                ···
              </button>
              {showOverflow && (
                <div className="squisq-toolbar-overflow-menu">
                  {BUTTONS.slice(overflowIndex).map((btn) => {
                    const active = isWysiwyg ? isTiptapActive(tiptapEditor, btn.id) : false;
                    const disabled = btn.id === 'image' && !mediaProvider;
                    return (
                      <button
                        key={btn.id}
                        className={`squisq-toolbar-overflow-item${active ? ' squisq-toolbar-overflow-item--active' : ''}`}
                        title={btn.title}
                        onClick={() => {
                          handleAction(btn.id);
                          setShowOverflow(false);
                        }}
                        disabled={disabled}
                      >
                        {btn.id === 'table' ? (
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                            <rect x="1" y="1" width="12" height="12" rx="1" />
                            <line x1="1" y1="5" x2="13" y2="5" />
                            <line x1="1" y1="9" x2="13" y2="9" />
                            <line x1="5" y1="1" x2="5" y2="13" />
                            <line x1="9" y1="1" x2="9" y2="13" />
                          </svg>
                        ) : (
                          <span className="squisq-toolbar-overflow-icon" style={btn.iconStyle}>
                            {btn.icon}
                          </span>
                        )}
                        <span>{btn.title}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {/* After-actions slot — after formatting controls */}
      {slotAfterActions}
      {/* Spacer pushes right-side buttons to the end */}
      <div style={{ flex: 1 }} />
      {/* Files toggle — visible when callback is provided */}
      {onToggleFiles && (
        <button
          className={`squisq-toolbar-button squisq-toolbar-files-toggle${showFiles ? ' squisq-toolbar-button--active' : ''}`}
          onClick={onToggleFiles}
          title={showFiles ? 'Hide Files panel' : 'Show Files panel'}
          aria-pressed={showFiles}
          aria-label="Toggle Files panel"
        >
          {'\u{1F4CE}'}
        </button>
      )}
      {/* Right slot — rightmost end of toolbar */}
      {slotRight}
    </div>
  );
}
