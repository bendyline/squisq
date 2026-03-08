/**
 * mdast ↔ Squisq Markdown Node Conversion
 *
 * Converts between the remark/mdast AST format and the squisq
 * MarkdownDocument JSON format. This is the bridge layer that allows
 * us to use the battle-tested unified/remark ecosystem for parsing
 * and serialization while exposing our own clean, well-typed interfaces.
 *
 * The conversion is designed for perfect round-tripping:
 * toMdast(fromMdast(tree)) should produce an equivalent mdast tree.
 */

import type {
  MarkdownDocument,
  MarkdownBlockNode,
  MarkdownInlineNode,
  MarkdownListItem,
  MarkdownTableRow,
  MarkdownTableCell,
  MarkdownSourcePosition,
  HeadingTemplateAnnotation,
  MarkdownHeading,
} from './types.js';
import { parseHtmlToNodes } from './htmlParse.js';

// ============================================
// Generic mdast node shape
// ============================================

/**
 * Minimal interface for mdast/unist nodes.
 * Using a generic shape avoids hard dependency on @types/mdast
 * and handles extension nodes (GFM, math, directive) uniformly.
 */
interface MdastPosition {
  start: { line: number; column: number; offset?: number };
  end: { line: number; column: number; offset?: number };
}

interface MdastNode {
  type: string;
  position?: MdastPosition;
  children?: MdastNode[];
  value?: string;
  depth?: number;
  ordered?: boolean | null;
  start?: number | null;
  spread?: boolean | null;
  checked?: boolean | null;
  lang?: string | null;
  meta?: string | null;
  url?: string;
  title?: string | null;
  alt?: string;
  identifier?: string;
  label?: string;
  referenceType?: string;
  align?: (string | null)[];
  name?: string;
  attributes?: Record<string, string>;
  data?: Record<string, unknown>;
}

// ============================================
// Position conversion
// ============================================

function convertPosition(pos?: MdastPosition): MarkdownSourcePosition | undefined {
  if (!pos) return undefined;
  return {
    start: {
      line: pos.start.line,
      column: pos.start.column,
      ...(pos.start.offset != null ? { offset: pos.start.offset } : {}),
    },
    end: {
      line: pos.end.line,
      column: pos.end.column,
      ...(pos.end.offset != null ? { offset: pos.end.offset } : {}),
    },
  };
}

function toMdastPosition(pos: MarkdownSourcePosition): MdastPosition {
  return {
    start: {
      line: pos.start.line,
      column: pos.start.column,
      ...(pos.start.offset != null ? { offset: pos.start.offset } : {}),
    },
    end: {
      line: pos.end.line,
      column: pos.end.column,
      ...(pos.end.offset != null ? { offset: pos.end.offset } : {}),
    },
  };
}

/** Conditionally include position in node. */
function posField(
  pos?: MarkdownSourcePosition,
): { position: MarkdownSourcePosition } | Record<string, never> {
  return pos ? { position: pos } : {};
}

function mdastPosField(
  pos?: MarkdownSourcePosition,
): { position: MdastPosition } | Record<string, never> {
  return pos ? { position: toMdastPosition(pos) } : {};
}

// ============================================
// mdast → Squisq (fromMdast)
// ============================================

/**
 * Extract plain text content from an mdast node tree.
 * Used for directive labels.
 */
function extractText(node: MdastNode): string {
  if (node.value != null) return node.value;
  if (node.children) {
    return node.children.map(extractText).join('');
  }
  return '';
}

// ============================================
// Template annotation helpers
// ============================================

/**
 * Regex matching a trailing `{[templateName key=value …]}` annotation.
 * Captures the content between `{[` and `]}`.
 */
const TEMPLATE_ANNOTATION_RE = /\s*\{\[([^\]]+)\]\}\s*$/;

/**
 * Extract a `{[templateName key=value …]}` annotation from a heading's
 * inline children. Mutates the children array in-place: strips the
 * annotation text from the last text node (or removes the node entirely).
 *
 * @returns The parsed annotation, or null if none found.
 */
function extractTemplateAnnotation(
  children: MarkdownInlineNode[],
): HeadingTemplateAnnotation | null {
  // Walk backwards to find the last text node
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i];
    if (child.type === 'text') {
      const match = child.value.match(TEMPLATE_ANNOTATION_RE);
      if (match) {
        const inner = match[1].trim();
        const annotation = parseAnnotationTokens(inner);

        // Strip the matched portion from the text
        const stripped = child.value.slice(0, match.index!).replace(/\s+$/, '');
        if (stripped) {
          (child as { value: string }).value = stripped;
        } else {
          // Remove the now-empty text node
          children.splice(i, 1);
        }
        return annotation;
      }
      // Only check the last text node (trailing position)
      break;
    }
    // If the last child isn't a text node, there's no annotation
    break;
  }
  return null;
}

/**
 * Parse the inner content of a `{[…]}` annotation into template + params.
 *
 * Input: `"chart colorScheme=blue size=large"`
 * Output: `{ template: 'chart', params: { colorScheme: 'blue', size: 'large' } }`
 */
function parseAnnotationTokens(inner: string): HeadingTemplateAnnotation {
  const tokens = inner.split(/\s+/);
  const template = tokens[0];
  const params: Record<string, string> = {};

  for (let i = 1; i < tokens.length; i++) {
    const eqIdx = tokens[i].indexOf('=');
    if (eqIdx > 0) {
      params[tokens[i].slice(0, eqIdx)] = tokens[i].slice(eqIdx + 1);
    }
  }

  const result: HeadingTemplateAnnotation = { template };
  if (Object.keys(params).length > 0) {
    result.params = params;
  }
  return result;
}

/**
 * Serialize a HeadingTemplateAnnotation back to `{[templateName key=value …]}` text.
 */
function serializeTemplateAnnotation(annotation: HeadingTemplateAnnotation): string {
  let result = `{[${annotation.template}`;
  if (annotation.params) {
    for (const [key, value] of Object.entries(annotation.params)) {
      result += ` ${key}=${value}`;
    }
  }
  result += ']}';
  return result;
}

/**
 * Convert an mdast Root node to a MarkdownDocument.
 *
 * @param root - The mdast root node (from remark-parse)
 * @param options - Conversion options
 * @returns A MarkdownDocument
 */
export function fromMdast(root: MdastNode, options?: { parseHtml?: boolean }): MarkdownDocument {
  const doParseHtml = options?.parseHtml !== false;
  return {
    type: 'document',
    children: convertBlockChildren(root.children ?? [], doParseHtml),
    ...posField(convertPosition(root.position)),
  };
}

function convertBlockChildren(children: MdastNode[], parseHtml: boolean): MarkdownBlockNode[] {
  const result: MarkdownBlockNode[] = [];
  for (const child of children) {
    const node = convertBlockNode(child, parseHtml);
    if (node) result.push(node);
  }
  return result;
}

function convertInlineChildren(children: MdastNode[], parseHtml: boolean): MarkdownInlineNode[] {
  const result: MarkdownInlineNode[] = [];
  for (const child of children) {
    const node = convertInlineNode(child, parseHtml);
    if (node) result.push(node);
  }
  return result;
}

function convertBlockNode(node: MdastNode, parseHtml: boolean): MarkdownBlockNode | null {
  const pos = convertPosition(node.position);

  switch (node.type) {
    case 'heading': {
      const headingChildren = convertInlineChildren(node.children ?? [], parseHtml);
      const annotation = extractTemplateAnnotation(headingChildren);
      const result: MarkdownHeading = {
        type: 'heading',
        depth: (node.depth ?? 1) as 1 | 2 | 3 | 4 | 5 | 6,
        children: headingChildren,
        ...posField(pos),
      };
      if (annotation) {
        result.templateAnnotation = annotation;
      }
      return result;
    }

    case 'paragraph':
      return {
        type: 'paragraph',
        children: convertInlineChildren(node.children ?? [], parseHtml),
        ...posField(pos),
      };

    case 'blockquote':
      return {
        type: 'blockquote',
        children: convertBlockChildren(node.children ?? [], parseHtml),
        ...posField(pos),
      };

    case 'list':
      return {
        type: 'list',
        ordered: node.ordered ?? false,
        ...(node.start != null ? { start: node.start } : {}),
        ...(node.spread != null ? { spread: node.spread } : {}),
        children: (node.children ?? []).map((item) => convertListItem(item, parseHtml)),
        ...posField(pos),
      };

    case 'code':
      return {
        type: 'code',
        ...(node.lang != null ? { lang: node.lang } : {}),
        ...(node.meta != null ? { meta: node.meta } : {}),
        value: node.value ?? '',
        ...posField(pos),
      };

    case 'thematicBreak':
      return {
        type: 'thematicBreak',
        ...posField(pos),
      };

    case 'table':
      return {
        type: 'table',
        ...(node.align
          ? { align: node.align.map((a) => a as 'left' | 'right' | 'center' | null) }
          : {}),
        children: (node.children ?? []).map((row, i) => convertTableRow(row, i === 0, parseHtml)),
        ...posField(pos),
      };

    case 'html':
      return {
        type: 'htmlBlock',
        rawHtml: node.value ?? '',
        htmlChildren: parseHtml ? parseHtmlToNodes(node.value ?? '') : [],
        ...posField(pos),
      };

    case 'math':
      return {
        type: 'math',
        value: node.value ?? '',
        ...(node.meta != null ? { meta: node.meta } : {}),
        ...posField(pos),
      };

    case 'definition':
      return {
        type: 'definition',
        identifier: node.identifier ?? '',
        ...(node.label != null ? { label: node.label } : {}),
        url: node.url ?? '',
        ...(node.title != null ? { title: node.title } : {}),
        ...posField(pos),
      };

    case 'footnoteDefinition':
      return {
        type: 'footnoteDefinition',
        identifier: node.identifier ?? '',
        ...(node.label != null ? { label: node.label } : {}),
        children: convertBlockChildren(node.children ?? [], parseHtml),
        ...posField(pos),
      };

    case 'containerDirective': {
      const allChildren = node.children ?? [];
      let label: string | undefined;
      let contentChildren = allChildren;

      // Extract directive label (first paragraph with directiveLabel flag)
      if (
        allChildren.length > 0 &&
        allChildren[0].type === 'paragraph' &&
        allChildren[0].data?.directiveLabel === true
      ) {
        label = extractText(allChildren[0]);
        contentChildren = allChildren.slice(1);
      }

      return {
        type: 'containerDirective',
        name: node.name ?? '',
        ...(label ? { label } : {}),
        ...(node.attributes && Object.keys(node.attributes).length > 0
          ? { attributes: node.attributes }
          : {}),
        children: convertBlockChildren(contentChildren, parseHtml),
        ...posField(pos),
      };
    }

    case 'leafDirective':
      return {
        type: 'leafDirective',
        name: node.name ?? '',
        ...(node.attributes && Object.keys(node.attributes).length > 0
          ? { attributes: node.attributes }
          : {}),
        children: convertInlineChildren(node.children ?? [], parseHtml),
        ...posField(pos),
      };

    case 'yaml':
      // YAML frontmatter nodes are handled separately in parse.ts — skip silently
      return null;

    default:
      // Unknown block node — skip with a warning
      if (typeof console !== 'undefined') {
        console.warn(`[squisq/markdown] Unknown mdast block node type: "${node.type}"`);
      }
      return null;
  }
}

function convertListItem(node: MdastNode, parseHtml: boolean): MarkdownListItem {
  const pos = convertPosition(node.position);
  return {
    type: 'listItem',
    ...(node.checked != null ? { checked: node.checked } : {}),
    ...(node.spread != null ? { spread: node.spread } : {}),
    children: convertBlockChildren(node.children ?? [], parseHtml),
    ...posField(pos),
  };
}

function convertTableRow(node: MdastNode, isHeader: boolean, parseHtml: boolean): MarkdownTableRow {
  const pos = convertPosition(node.position);
  return {
    type: 'tableRow',
    children: (node.children ?? []).map((cell) => convertTableCell(cell, isHeader, parseHtml)),
    ...posField(pos),
  };
}

function convertTableCell(
  node: MdastNode,
  isHeader: boolean,
  parseHtml: boolean,
): MarkdownTableCell {
  const pos = convertPosition(node.position);
  return {
    type: 'tableCell',
    ...(isHeader ? { isHeader: true } : {}),
    children: convertInlineChildren(node.children ?? [], parseHtml),
    ...posField(pos),
  };
}

function convertInlineNode(node: MdastNode, parseHtml: boolean): MarkdownInlineNode | null {
  const pos = convertPosition(node.position);

  switch (node.type) {
    case 'text':
      return {
        type: 'text',
        value: node.value ?? '',
        ...posField(pos),
      };

    case 'emphasis':
      return {
        type: 'emphasis',
        children: convertInlineChildren(node.children ?? [], parseHtml),
        ...posField(pos),
      };

    case 'strong':
      return {
        type: 'strong',
        children: convertInlineChildren(node.children ?? [], parseHtml),
        ...posField(pos),
      };

    case 'delete':
      return {
        type: 'delete',
        children: convertInlineChildren(node.children ?? [], parseHtml),
        ...posField(pos),
      };

    case 'inlineCode':
      return {
        type: 'inlineCode',
        value: node.value ?? '',
        ...posField(pos),
      };

    case 'link':
      return {
        type: 'link',
        url: node.url ?? '',
        ...(node.title != null ? { title: node.title } : {}),
        children: convertInlineChildren(node.children ?? [], parseHtml),
        ...posField(pos),
      };

    case 'image':
      return {
        type: 'image',
        url: node.url ?? '',
        ...(node.alt != null ? { alt: node.alt } : {}),
        ...(node.title != null ? { title: node.title } : {}),
        ...posField(pos),
      };

    case 'break':
      return {
        type: 'break',
        ...posField(pos),
      };

    case 'html':
      return {
        type: 'htmlInline',
        rawHtml: node.value ?? '',
        htmlChildren: parseHtml ? parseHtmlToNodes(node.value ?? '') : [],
        ...posField(pos),
      };

    case 'inlineMath':
      return {
        type: 'inlineMath',
        value: node.value ?? '',
        ...posField(pos),
      };

    case 'footnoteReference':
      return {
        type: 'footnoteReference',
        identifier: node.identifier ?? '',
        ...(node.label != null ? { label: node.label } : {}),
        ...posField(pos),
      };

    case 'linkReference':
      return {
        type: 'linkReference',
        identifier: node.identifier ?? '',
        ...(node.label != null ? { label: node.label } : {}),
        referenceType: (node.referenceType ?? 'full') as 'full' | 'collapsed' | 'shortcut',
        children: convertInlineChildren(node.children ?? [], parseHtml),
        ...posField(pos),
      };

    case 'imageReference':
      return {
        type: 'imageReference',
        identifier: node.identifier ?? '',
        ...(node.label != null ? { label: node.label } : {}),
        referenceType: (node.referenceType ?? 'full') as 'full' | 'collapsed' | 'shortcut',
        ...(node.alt != null ? { alt: node.alt } : {}),
        ...posField(pos),
      };

    case 'textDirective':
      return {
        type: 'textDirective',
        name: node.name ?? '',
        ...(node.attributes && Object.keys(node.attributes).length > 0
          ? { attributes: node.attributes }
          : {}),
        children: convertInlineChildren(node.children ?? [], parseHtml),
        ...posField(pos),
      };

    default:
      if (typeof console !== 'undefined') {
        console.warn(`[squisq/markdown] Unknown mdast inline node type: "${node.type}"`);
      }
      return null;
  }
}

// ============================================
// Squisq → mdast (toMdast)
// ============================================

/**
 * Convert a MarkdownDocument back to an mdast Root node.
 *
 * @param doc - A MarkdownDocument
 * @returns An mdast Root node suitable for remark-stringify
 */
export function toMdast(doc: MarkdownDocument): MdastNode {
  return {
    type: 'root',
    children: doc.children.map((n) => blockToMdast(n)),
    ...mdastPosField(doc.position),
  };
}

function blockToMdast(node: MarkdownBlockNode): MdastNode {
  switch (node.type) {
    case 'heading': {
      const mdastChildren = node.children.map(inlineToMdast);
      if (node.templateAnnotation) {
        const suffix = serializeTemplateAnnotation(node.templateAnnotation);
        // Append to last text node, or create a new one
        const lastChild = mdastChildren[mdastChildren.length - 1];
        if (lastChild && lastChild.type === 'text') {
          lastChild.value = (lastChild.value ?? '') + ' ' + suffix;
        } else {
          mdastChildren.push({ type: 'text', value: ' ' + suffix });
        }
      }
      return {
        type: 'heading',
        depth: node.depth,
        children: mdastChildren,
        ...mdastPosField(node.position),
      };
    }

    case 'paragraph':
      return {
        type: 'paragraph',
        children: node.children.map(inlineToMdast),
        ...mdastPosField(node.position),
      };

    case 'blockquote':
      return {
        type: 'blockquote',
        children: node.children.map(blockToMdast),
        ...mdastPosField(node.position),
      };

    case 'list':
      return {
        type: 'list',
        ordered: node.ordered,
        ...(node.start != null ? { start: node.start } : {}),
        ...(node.spread != null ? { spread: node.spread } : {}),
        children: node.children.map(listItemToMdast),
        ...mdastPosField(node.position),
      };

    case 'code':
      return {
        type: 'code',
        ...(node.lang != null ? { lang: node.lang } : {}),
        ...(node.meta != null ? { meta: node.meta } : {}),
        value: node.value,
        ...mdastPosField(node.position),
      };

    case 'thematicBreak':
      return {
        type: 'thematicBreak',
        ...mdastPosField(node.position),
      };

    case 'table':
      return {
        type: 'table',
        ...(node.align ? { align: node.align } : {}),
        children: node.children.map(tableRowToMdast),
        ...mdastPosField(node.position),
      };

    case 'htmlBlock':
      return {
        type: 'html',
        value: node.rawHtml,
        ...mdastPosField(node.position),
      };

    case 'math':
      return {
        type: 'math',
        value: node.value,
        ...(node.meta != null ? { meta: node.meta } : {}),
        ...mdastPosField(node.position),
      };

    case 'definition':
      return {
        type: 'definition',
        identifier: node.identifier,
        ...(node.label != null ? { label: node.label } : {}),
        url: node.url,
        ...(node.title != null ? { title: node.title } : {}),
        ...mdastPosField(node.position),
      };

    case 'footnoteDefinition':
      return {
        type: 'footnoteDefinition',
        identifier: node.identifier,
        ...(node.label != null ? { label: node.label } : {}),
        children: node.children.map(blockToMdast),
        ...mdastPosField(node.position),
      };

    case 'containerDirective': {
      const children: MdastNode[] = [];

      // Reinject label as first paragraph with directiveLabel flag
      if (node.label) {
        children.push({
          type: 'paragraph',
          data: { directiveLabel: true },
          children: [{ type: 'text', value: node.label }],
        });
      }

      children.push(...node.children.map(blockToMdast));

      return {
        type: 'containerDirective',
        name: node.name,
        ...(node.attributes ? { attributes: node.attributes } : {}),
        children,
        ...mdastPosField(node.position),
      };
    }

    case 'leafDirective':
      return {
        type: 'leafDirective',
        name: node.name,
        ...(node.attributes ? { attributes: node.attributes } : {}),
        children: node.children.map(inlineToMdast),
        ...mdastPosField(node.position),
      };

    case 'definitionList':
      // Definition lists don't map to standard mdast.
      // Convert to HTML as fallback.
      return {
        type: 'html',
        value: definitionListToHtml(node),
        ...mdastPosField(node.position),
      };

    default:
      return { type: 'html', value: '' };
  }
}

function listItemToMdast(item: MarkdownListItem): MdastNode {
  return {
    type: 'listItem',
    ...(item.checked != null ? { checked: item.checked } : {}),
    ...(item.spread != null ? { spread: item.spread } : {}),
    children: item.children.map(blockToMdast),
    ...mdastPosField(item.position),
  };
}

function tableRowToMdast(row: MarkdownTableRow): MdastNode {
  return {
    type: 'tableRow',
    children: row.children.map(tableCellToMdast),
    ...mdastPosField(row.position),
  };
}

function tableCellToMdast(cell: MarkdownTableCell): MdastNode {
  return {
    type: 'tableCell',
    children: cell.children.map(inlineToMdast),
    ...mdastPosField(cell.position),
  };
}

function inlineToMdast(node: MarkdownInlineNode): MdastNode {
  switch (node.type) {
    case 'text':
      return {
        type: 'text',
        value: node.value,
        ...mdastPosField(node.position),
      };

    case 'emphasis':
      return {
        type: 'emphasis',
        children: node.children.map(inlineToMdast),
        ...mdastPosField(node.position),
      };

    case 'strong':
      return {
        type: 'strong',
        children: node.children.map(inlineToMdast),
        ...mdastPosField(node.position),
      };

    case 'delete':
      return {
        type: 'delete',
        children: node.children.map(inlineToMdast),
        ...mdastPosField(node.position),
      };

    case 'inlineCode':
      return {
        type: 'inlineCode',
        value: node.value,
        ...mdastPosField(node.position),
      };

    case 'link':
      return {
        type: 'link',
        url: node.url,
        ...(node.title != null ? { title: node.title } : {}),
        children: node.children.map(inlineToMdast),
        ...mdastPosField(node.position),
      };

    case 'image':
      return {
        type: 'image',
        url: node.url,
        ...(node.alt != null ? { alt: node.alt } : {}),
        ...(node.title != null ? { title: node.title } : {}),
        ...mdastPosField(node.position),
      };

    case 'break':
      return {
        type: 'break',
        ...mdastPosField(node.position),
      };

    case 'htmlInline':
      return {
        type: 'html',
        value: node.rawHtml,
        ...mdastPosField(node.position),
      };

    case 'inlineMath':
      return {
        type: 'inlineMath',
        value: node.value,
        ...mdastPosField(node.position),
      };

    case 'footnoteReference':
      return {
        type: 'footnoteReference',
        identifier: node.identifier,
        ...(node.label != null ? { label: node.label } : {}),
        ...mdastPosField(node.position),
      };

    case 'linkReference':
      return {
        type: 'linkReference',
        identifier: node.identifier,
        ...(node.label != null ? { label: node.label } : {}),
        referenceType: node.referenceType,
        children: node.children.map(inlineToMdast),
        ...mdastPosField(node.position),
      };

    case 'imageReference':
      return {
        type: 'imageReference',
        identifier: node.identifier,
        ...(node.label != null ? { label: node.label } : {}),
        referenceType: node.referenceType,
        ...(node.alt != null ? { alt: node.alt } : {}),
        ...mdastPosField(node.position),
      };

    case 'textDirective':
      return {
        type: 'textDirective',
        name: node.name,
        ...(node.attributes ? { attributes: node.attributes } : {}),
        children: node.children.map(inlineToMdast),
        ...mdastPosField(node.position),
      };

    default:
      return { type: 'text', value: '' };
  }
}

// ============================================
// Helpers
// ============================================

/**
 * Convert a MarkdownDefinitionList to an HTML <dl> string.
 * Fallback for serialization since mdast doesn't support definition lists.
 */
function definitionListToHtml(list: {
  children: Array<{ type: string; children?: unknown[] }>;
}): string {
  let html = '<dl>\n';
  for (const child of list.children) {
    if (child.type === 'definitionTerm') {
      // Extract plain text from inline children
      const text = (child.children as Array<{ value?: string; children?: unknown[] }>)
        .map((c) => c.value ?? '')
        .join('');
      html += `  <dt>${text}</dt>\n`;
    } else if (child.type === 'definitionDescription') {
      html += `  <dd>...</dd>\n`;
    }
  }
  html += '</dl>';
  return html;
}
