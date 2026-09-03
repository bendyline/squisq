/**
 * Binds the grid's view state (sort/filter) to the OWNING heading's
 * `{[dataTable …]}` annotation params — the document-persisted half of the
 * "author's sort IS part of the document" contract.
 *
 * Persistence guard: params are written ONLY when the owning heading's
 * template resolves into `TABLE_FED_TEMPLATES` AND its `src` equals the
 * card's href — a data-link paragraph under a template-less heading gets
 * SESSION-ONLY view state rather than a fabricated annotation.
 *
 * Writes go through the established single-transaction pattern
 * (`tr.setNodeAttribute(pos, 'dataTemplateParams', serialized || null)`,
 * see scene/commands/drawingCommands.ts) with canonical
 * `key=quoteAttrValue(value)` serialization; existing params keep their
 * order, `sort`/`filter` update in place or append — `paramsEqual` in
 * docToMarkdown is order-insensitive, so repeat writes stay byte-stable.
 */

import type { Editor } from '@tiptap/react';
import {
  needsQuoting,
  quoteAttrValue,
  splitKeyValueToken,
  tokenizeAttrTokens,
  unquoteAttrValue,
} from '@bendyline/squisq/markdown';
import { parseTableViewState, serializeTableViewState } from '@bendyline/squisq/table';
import type { TableViewState } from '@bendyline/squisq/table';
import { TABLE_FED_TEMPLATES, resolveTemplateName } from '@bendyline/squisq/doc';
import { findOwningHeadingPosition } from '../blockTagActivity';

export interface HeadingViewBinding {
  /** Heading node position, when an owning heading exists. */
  headingPos: number | null;
  /** True when sort/filter writes persist to the document. */
  persisted: boolean;
  /** All annotation params on the heading (raw, unquoted values). */
  params: Record<string, string>;
  /** Raw sort/filter param values, for `parseTableViewState`. */
  sortRaw?: string;
  filterRaw?: string;
}

interface HeadingAttrs {
  dataTemplate?: string | null;
  dataTemplateParams?: string | null;
}

function paramsOf(inner: string | null | undefined): Record<string, string> {
  const params: Record<string, string> = {};
  if (!inner) return params;
  for (const token of tokenizeAttrTokens(inner)) {
    const pair = splitKeyValueToken(token);
    if (pair) params[pair.key] = unquoteAttrValue(pair.value);
  }
  return params;
}

/** Resolve the owning heading + persistence eligibility for a card. */
export function readHeadingViewBinding(
  editor: Editor,
  cardPos: number,
  href: string,
): HeadingViewBinding {
  const headingPos = findOwningHeadingPosition(editor.state.doc, cardPos);
  if (headingPos === null) {
    return { headingPos: null, persisted: false, params: {} };
  }
  const node = editor.state.doc.nodeAt(headingPos);
  if (!node || node.type.name !== 'heading') {
    return { headingPos: null, persisted: false, params: {} };
  }
  const attrs = node.attrs as HeadingAttrs;
  const params = paramsOf(attrs.dataTemplateParams);
  const template = attrs.dataTemplate ? resolveTemplateName(attrs.dataTemplate) : null;
  const persisted = template !== null && TABLE_FED_TEMPLATES.has(template) && params.src === href;
  return {
    headingPos,
    persisted,
    params,
    ...(params.sort !== undefined ? { sortRaw: params.sort } : {}),
    ...(params.filter !== undefined ? { filterRaw: params.filter } : {}),
  };
}

function serializeParams(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([key, value]) => `${key}=${needsQuoting(value) ? quoteAttrValue(value) : value}`)
    .join(' ');
}

/**
 * Write the view state onto the heading annotation (one transaction,
 * PM-undoable). Returns false when the write couldn't apply (stale pos).
 */
export function writeHeadingViewState(
  editor: Editor,
  cardPos: number,
  href: string,
  view: TableViewState,
): boolean {
  if (!editor.isEditable) return false;
  const binding = readHeadingViewBinding(editor, cardPos, href);
  if (binding.headingPos === null || !binding.persisted) return false;

  const raw = serializeTableViewState(view);
  const params = { ...binding.params };
  if (raw.sort !== undefined) params.sort = raw.sort;
  else delete params.sort;
  if (raw.filter !== undefined) params.filter = raw.filter;
  else delete params.filter;

  const serialized = serializeParams(params);
  const pos = binding.headingPos;
  return editor
    .chain()
    .command(({ tr }) => {
      const node = tr.doc.nodeAt(pos);
      if (!node || node.type.name !== 'heading') return false;
      tr.setNodeAttribute(pos, 'dataTemplateParams', serialized.length > 0 ? serialized : null);
      return true;
    })
    .run();
}

/** Parse the binding's raw params into a `TableViewState` for the grid. */
export function viewStateFromBinding(
  binding: HeadingViewBinding,
  headers: readonly string[],
): TableViewState {
  return parseTableViewState(binding.sortRaw, binding.filterRaw, headers).view;
}
