import type { Editor } from '@tiptap/core';
import { parseMarkdown, parseWikiLink, type MarkdownNode } from '@bendyline/squisq/markdown';

export interface WikiLinkEdit {
  from: number;
  to: number;
  target: string;
  label: string | null;
  inTable?: boolean;
}

function at(editor: Editor, from: number): WikiLinkEdit | null {
  const node = editor.state.doc.nodeAt(from);
  if (node?.type.name !== 'wikiLink') return null;
  return {
    from,
    to: from + node.nodeSize,
    target: String(node.attrs.target),
    label: typeof node.attrs.label === 'string' ? node.attrs.label : null,
  };
}

/** Include the caret immediately after completion, before the author types on. */
export function selectedWikiLink(editor: Editor): WikiLinkEdit | null {
  const { from, to, empty, $from } = editor.state.selection;
  if (!empty) {
    const link = at(editor, from);
    return link?.to === to ? link : null;
  }
  const before = $from.nodeBefore;
  return (
    (before?.type.name === 'wikiLink' ? at(editor, from - before.nodeSize) : null) ??
    at(editor, from)
  );
}

/** Map the clicked node view to its exact document boundary, not a nearby caret. */
export function wikiLinkAtElement(editor: Editor, target: Element): WikiLinkEdit | null {
  const element = target.closest('.node-wikiLink, span[data-wiki-link]');
  if (!element?.parentNode || !editor.view.dom.contains(element)) return null;
  const index = Array.from(element.parentNode.childNodes).indexOf(element);
  return at(editor, editor.view.posAtDOM(element.parentNode, index));
}

/** Parsed positions keep code, escaped brackets, and table separators honest. */
export function sourceWikiLink(source: string, offset: number): WikiLinkEdit | null {
  let found: WikiLinkEdit | null = null;
  function visit(node: MarkdownNode, inTable: boolean): void {
    // At adjacent links, the caret belongs to the link just completed.
    if (found) return;
    const position = node.position;
    if (node.type === 'link' && node.wikiTarget !== undefined && position) {
      const from = position.start.offset;
      const to = position.end.offset;
      if (from !== undefined && to !== undefined && offset >= from && offset <= to)
        found = { from, to, target: node.wikiTarget, label: node.wikiLabel ?? null, inTable };
    }
    if ('children' in node)
      for (const child of node.children) visit(child, inTable || node.type === 'table');
  }
  visit(parseMarkdown(source), false);
  return found;
}

export function wikiEditSource(target: string, label: string, inTable = false): string | null {
  const value = target + (label ? `|${label}` : '');
  if (!parseWikiLink(value)) return null;
  return `[[${inTable ? value.replace(/\|/g, '\\|') : value}]]`;
}
