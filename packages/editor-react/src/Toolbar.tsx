/**
 * Toolbar
 *
 * Formatting toolbar that provides common markdown editing actions.
 * In WYSIWYG mode, uses Tiptap's chain commands to toggle marks / set nodes.
 * In Raw mode, appends markdown syntax at the cursor (or end of source).
 * Hidden in Preview mode.
 */

import { useCallback } from 'react';
import { useEditorContext } from './EditorContext';
import { getAvailableTemplates } from '@bendyline/squisq/doc';

export interface ToolbarProps {
  /** Additional class name */
  className?: string;
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
];

// ─── Tiptap active-state map ────────────────────────────

/** Returns true if the given button id is currently active in Tiptap */
function isTiptapActive(editor: any, id: string): boolean {
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
export function Toolbar({ className }: ToolbarProps) {
  const { activeView, markdownSource, setMarkdownSource, tiptapEditor, monacoEditor } =
    useEditorContext();

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
            chain.setLink?.({ href: url }).run();
          }
          break;
        }
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
        }
        if (insertion) {
          setMarkdownSource(markdownSource + insertion);
        }
      }
    },
    [monacoEditor, markdownSource, setMarkdownSource],
  );

  const handleAction = useCallback(
    (id: string) => {
      if (activeView === 'wysiwyg' && tiptapEditor) {
        handleTiptap(id);
      } else {
        handleRaw(id);
      }
    },
    [activeView, tiptapEditor, monacoEditor, handleTiptap, handleRaw],
  );

  if (activeView === 'preview') return null;

  const groups = ['format', 'structure', 'insert'] as const;
  const isWysiwyg = activeView === 'wysiwyg' && tiptapEditor;

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
      {groups.map((group, gi) => (
        <div key={group} className="squisq-toolbar-group">
          {gi > 0 && <div className="squisq-toolbar-separator" />}
          {BUTTONS.filter((b) => b.group === group).map((btn) => {
            const active = isWysiwyg ? isTiptapActive(tiptapEditor, btn.id) : false;
            return (
              <button
                key={btn.id}
                className={`squisq-toolbar-button${active ? ' squisq-toolbar-button--active' : ''}`}
                title={btn.title}
                onClick={() => handleAction(btn.id)}
                aria-label={btn.title}
                aria-pressed={active}
                style={btn.iconStyle}
              >
                {btn.icon}
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
            <label className="squisq-template-picker-label" title="Block template for this heading">
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
    </div>
  );
}
