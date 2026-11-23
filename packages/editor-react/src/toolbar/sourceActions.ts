/**
 * sourceActions
 *
 * What a toolbar action does in the Source view: it types the Markdown for
 * the action. With text selected, an inline action wraps it and a block
 * action prefixes each selected line; with none, the action inserts
 * placeholder text and puts the caret where the author fills it in.
 *
 * Link is the exception: it opens the link dialog rather than typing, so
 * {@link applySourceAction} returns what the dialog should open with and the
 * toolbar, which owns the dialog, opens it.
 *
 * Plain functions over Monaco's editor (types only: no runtime import), kept
 * out of Toolbar.tsx, which is at its line budget.
 */

import type { IRange, editor as MonacoEditor } from 'monaco-editor';
import { chartStarterMarkdown, DEFAULT_CHART_TYPE } from '../chart/chartTypes';
import { sourceWikiLink, type WikiLinkEdit } from '../wikiLinkEditing';
import {
  DIAGRAM_STARTER_MARKDOWN,
  LAYOUT_STARTER_MARKDOWN,
  MERMAID_STARTER_MARKDOWN,
  TIMELINE_STARTER_MARKDOWN,
  TREE_STARTER_MARKDOWN,
} from './sceneBlockInserts';
import { TASK_LIST_MARKDOWN } from './toolbarButtons';

/** What the link dialog opens with when Link is chosen in the Source view. */
export interface SourceLinkRequest {
  mode: 'insert' | 'update';
  /** A `[[wiki link]]` under the caret, edited in place. */
  wiki?: WikiLinkEdit;
  wikiSource?: string;
  wikiModel?: MonacoEditor.ITextModel;
  initialText: string;
  initialUrl: string;
  /** The `[text](url)` under the caret to replace; null uses the selection. */
  rawRange: IRange | null;
}

/**
 * Apply toolbar action `id` at the Monaco selection as one undoable edit.
 * Returns the link dialog's request for Link, which edits nothing itself.
 */
export function applySourceAction(
  monacoEditor: MonacoEditor.ICodeEditor,
  id: string,
): SourceLinkRequest | null {
  const selection = monacoEditor.getSelection();
  const model = monacoEditor.getModel();
  if (!selection || !model) return null;

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
    // Markdown has no delimiter for vertical alignment — the source form
    // is inline HTML, which core's parser folds back into a real node.
    case 'superscript':
      wrapInline('<sup>', '</sup>', '1');
      break;
    case 'subscript':
      wrapInline('<sub>', '</sub>', '2');
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
      const source = model.getValue();
      const startOffset = model.getOffsetAt(selection.getStartPosition());
      const wiki = sourceWikiLink(source, startOffset + (selection.isEmpty() ? 0 : 1));
      if (wiki) {
        const start = model.getPositionAt(wiki.from);
        const end = model.getPositionAt(wiki.to);
        return {
          mode: 'update',
          wiki,
          wikiSource: source,
          wikiModel: model,
          initialText: wiki.label ?? '',
          initialUrl: wiki.target,
          rawRange: {
            startLineNumber: start.lineNumber,
            startColumn: start.column,
            endLineNumber: end.lineNumber,
            endColumn: end.column,
          },
        };
      }
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
      // No edit here — the dialog applies its own on confirm.
      return {
        mode: existing ? 'update' : 'insert',
        initialText: existing ? existing.text : hasSelection ? selectedText : '',
        initialUrl: existing ? existing.url : '',
        rawRange: existing ? existing.range : null,
      };
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
  return null;
}

/**
 * The Markdown appended to the document for action `id` when the Source view
 * has no Monaco editor to type into; empty when the action has none.
 */
export function appendedSourceMarkdown(id: string): string {
  switch (id) {
    case 'bold':
      return '**bold text**';
    case 'italic':
      return '*italic text*';
    case 'strikethrough':
      return '~~strikethrough~~';
    case 'superscript':
      return '<sup>1</sup>';
    case 'subscript':
      return '<sub>2</sub>';
    case 'code':
      return '`code`';
    case 'h1':
      return '\n# Heading 1\n';
    case 'h2':
      return '\n## Heading 2\n';
    case 'h3':
      return '\n### Heading 3\n';
    case 'quote':
      return '\n> Quote\n';
    case 'ul':
      return '\n- Item\n';
    case 'ol':
      return '\n1. Item\n';
    case 'codeblock':
      return '\n```\ncode\n```\n';
    case 'hr':
      return '\n---\n';
    case 'link':
      return '[link text](url)';
    case 'table':
      return '\n| Header 1 | Header 2 | Header 3 |\n| --- | --- | --- |\n| Cell | Cell | Cell |\n| Cell | Cell | Cell |\n';
    case 'tasklist':
      return `\n${TASK_LIST_MARKDOWN}\n`;
    case 'chart':
      return chartStarterMarkdown(DEFAULT_CHART_TYPE);
    case 'diagram':
      return DIAGRAM_STARTER_MARKDOWN;
    case 'complexdiagram':
      return MERMAID_STARTER_MARKDOWN;
    case 'tree':
      return TREE_STARTER_MARKDOWN;
    case 'timeline':
      return TIMELINE_STARTER_MARKDOWN;
    case 'drawing':
      return '\n## Drawing {[drawing]}\n';
    case 'layout':
      return LAYOUT_STARTER_MARKDOWN;
    default:
      return '';
  }
}
