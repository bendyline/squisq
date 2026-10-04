import { parseMarkdown } from './parse.js';
import { stringifyHtmlNodes } from './htmlParse.js';
import { stringifyMarkdown } from './stringify.js';
import { getChildren, splitFrontmatterBlock } from './utils.js';
import type { HtmlNode, MarkdownNode, MarkdownBlockNode, MarkdownInlineNode } from './types.js';

export interface MarkdownReferenceOptions {
  /** Return undefined to retain a URL. The caller owns source-specific resolution. */
  rewriteUrl?: (url: string, kind: 'link' | 'image') => string | undefined;
  /** Omit image nodes, retaining their alternative text; default preserve. */
  images?: 'preserve' | 'omit';
}

/**
 * Rewrite references using the Markdown and HTML trees. Only changed node
 * spans are serialized: frontmatter, prose, and code outside those spans stay
 * byte-identical. Handles inline and reference links, images, and raw HTML.
 * Does not fetch resources and is not an HTML sanitizer.
 */
export function rewriteMarkdownReferences(
  source: string,
  options: MarkdownReferenceOptions = {},
): string {
  const { frontmatter, body } = splitFrontmatterBlock(source);
  const document = parseMarkdown(body, { frontmatter: false });
  const html = (
    nodes: HtmlNode[],
    insidePicture = false,
  ): { nodes: HtmlNode[]; changed: boolean } => {
    let changed = false;
    const output = nodes.flatMap((node): HtmlNode[] => {
      if (node.type !== 'htmlElement') return [node];
      if (options.images === 'omit' && node.tagName === 'picture') {
        changed = true;
        return html(node.children, true).nodes;
      }
      if (
        options.images === 'omit' &&
        (node.tagName === 'img' || (node.tagName === 'source' && insidePicture))
      ) {
        changed = true;
        const alt = node.tagName === 'img' ? node.attributes.alt : undefined;
        return alt
          ? [
              {
                type: 'htmlText',
                value: alt.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
              },
            ]
          : [];
      }
      const child = html(node.children);
      changed ||= child.changed;
      const copy = { ...node, attributes: { ...node.attributes }, children: child.nodes };
      const key = node.tagName === 'a' ? 'href' : node.tagName === 'img' ? 'src' : undefined;
      if (key && node.attributes[key]) {
        const value = options.rewriteUrl?.(node.attributes[key], key === 'href' ? 'link' : 'image');
        if (value !== undefined && value !== node.attributes[key]) {
          copy.attributes[key] = value;
          changed = true;
        }
      }
      return [copy];
    });
    return { nodes: output, changed };
  };
  type Edit = { start: number; end: number; text: string };
  type Result = { node: MarkdownNode; changed: boolean; pending: boolean; edits: Edit[] };
  const blocks = new Set([
    'heading',
    'paragraph',
    'blockquote',
    'code',
    'thematicBreak',
    'list',
    'table',
    'htmlBlock',
    'mathBlock',
    'definition',
    'footnoteDefinition',
    'containerDirective',
    'leafDirective',
    'definitionList',
  ]);
  const structural = new Set([
    'listItem',
    'tableRow',
    'tableCell',
    'definitionTerm',
    'definitionDescription',
  ]);
  const render = (node: MarkdownNode): string => {
    if (node.type === 'document') return stringifyMarkdown(node).trimEnd();
    return stringifyMarkdown({
      type: 'document',
      children: blocks.has(node.type)
        ? [node as MarkdownBlockNode]
        : [{ type: 'paragraph', children: [node as MarkdownInlineNode] }],
    }).trimEnd();
  };
  const visit = (node: MarkdownNode): Result => {
    const children = getChildren(node).map(visit);
    const childChanged = children.some((child) => child.changed);
    let clone: MarkdownNode =
      childChanged && 'children' in node
        ? ({ ...node, children: children.map((child) => child.node) } as MarkdownNode)
        : node;
    let ownChange = false;
    if ((node.type === 'image' || node.type === 'imageReference') && options.images === 'omit') {
      clone = { type: 'text', value: node.alt ?? '' };
      ownChange = true;
    } else if (node.type === 'htmlBlock' || node.type === 'htmlInline') {
      const transformed = html(node.htmlChildren);
      if (transformed.changed) {
        clone = {
          ...node,
          htmlChildren: transformed.nodes,
          rawHtml: stringifyHtmlNodes(transformed.nodes),
        };
        ownChange = true;
      }
    } else if (clone.type === 'link' || clone.type === 'image' || clone.type === 'definition') {
      const url = options.rewriteUrl?.(clone.url, clone.type === 'image' ? 'image' : 'link');
      if (url !== undefined && url !== clone.url) {
        clone = { ...clone, url };
        ownChange = true;
      }
    }
    const changed = ownChange || childChanged;
    const pending = ownChange || children.some((child) => child.pending);
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    // Parsers can synthesize autolinks without source positions (for example,
    // an escaped bare domain in emphasis). Reprint the nearest positioned
    // ancestor instead of guessing offsets or silently skipping its edit.
    if (pending && start !== undefined && end !== undefined && !structural.has(node.type)) {
      return { node: clone, changed, pending: false, edits: [{ start, end, text: render(clone) }] };
    }
    return { node: clone, changed, pending, edits: children.flatMap((child) => child.edits) };
  };
  const result = visit(document);
  if (result.pending) throw new Error('Reference edit has no positioned ancestor');
  const edits = result.edits;
  let output = body;
  let boundary = body.length;
  for (const e of edits.sort((a, b) => b.start - a.start)) {
    if (e.end > boundary) throw new Error('Overlapping reference edits');
    output = output.slice(0, e.start) + e.text + output.slice(e.end);
    boundary = e.start;
  }
  return (frontmatter ?? '') + output;
}
