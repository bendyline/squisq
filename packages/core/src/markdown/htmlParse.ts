/**
 * HTML ↔ HtmlNode Conversion
 *
 * Parses raw HTML strings into the squisq HtmlNode tree representation
 * using hast-util-from-html (parse5-backed), and serializes HtmlNode trees
 * back to HTML strings with a lightweight custom serializer.
 */

import { fromHtml } from 'hast-util-from-html';
import type { HtmlNode } from './types.js';

// ============================================
// Hast → HtmlNode conversion
// ============================================

/**
 * Mapping from hast DOM-style property names to HTML attribute names.
 * Only includes names where the property and attribute differ.
 */
const HAST_PROP_TO_ATTR: Record<string, string> = {
  className: 'class',
  htmlFor: 'for',
  httpEquiv: 'http-equiv',
  acceptCharset: 'accept-charset',
};

/** HTML void elements that are self-closing. */
const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/**
 * Convert a hast property name to an HTML attribute name.
 */
function propertyToAttribute(prop: string): string {
  if (HAST_PROP_TO_ATTR[prop]) return HAST_PROP_TO_ATTR[prop];

  // data-* attributes: dataFooBar → data-foo-bar
  if (prop.length > 4 && prop.startsWith('data') && prop[4] >= 'A' && prop[4] <= 'Z') {
    return (
      'data-' +
      prop
        .slice(4)
        .replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())
        .replace(/^-/, '')
    );
  }

  // aria-* attributes: ariaLabel → aria-label
  if (prop.length > 4 && prop.startsWith('aria') && prop[4] >= 'A' && prop[4] <= 'Z') {
    return (
      'aria-' +
      prop
        .slice(4)
        .replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())
        .replace(/^-/, '')
    );
  }

  // Most HTML attributes are lowercase (tabIndex → tabindex, readOnly → readonly, etc.)
  return prop.toLowerCase();
}

/**
 * Convert hast element properties to a flat HTML attribute map.
 */
function convertHastProperties(properties: Record<string, unknown>): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value === false || value === undefined || value === null) continue;

    const attrName = propertyToAttribute(key);

    if (value === true) {
      attrs[attrName] = '';
    } else if (Array.isArray(value)) {
      attrs[attrName] = value.join(' ');
    } else {
      attrs[attrName] = String(value);
    }
  }
  return attrs;
}

/**
 * Recursively convert hast child nodes to HtmlNode[].
 */
function hastChildrenToNodes(children: unknown[]): HtmlNode[] {
  const result: HtmlNode[] = [];
  for (const child of children) {
    const node = hastNodeToHtmlNode(child as Record<string, unknown>);
    if (node) result.push(node);
  }
  return result;
}

/**
 * Convert a single hast node to an HtmlNode.
 */
function hastNodeToHtmlNode(node: Record<string, unknown>): HtmlNode | null {
  switch (node.type) {
    case 'element': {
      const tagName = node.tagName as string;
      const properties = (node.properties ?? {}) as Record<string, unknown>;
      const children = (node.children ?? []) as unknown[];
      return {
        type: 'htmlElement',
        tagName,
        attributes: convertHastProperties(properties),
        children: hastChildrenToNodes(children),
        selfClosing: VOID_ELEMENTS.has(tagName) && children.length === 0,
      };
    }
    case 'text':
      return {
        type: 'htmlText',
        value: node.value as string,
      };
    case 'comment':
      return {
        type: 'htmlComment',
        value: node.value as string,
      };
    case 'doctype':
      // Doctype nodes are rare in markdown HTML; skip them
      return null;
    default:
      return null;
  }
}

// ============================================
// Public API
// ============================================

/**
 * Parse a raw HTML string into an HtmlNode[] tree.
 *
 * Uses the HTML5 parsing algorithm (via parse5) for correct handling of
 * self-closing tags, optional end tags, entity decoding, etc.
 *
 * @param html - Raw HTML string to parse
 * @returns Array of top-level HtmlNode elements
 */
export function parseHtmlToNodes(html: string): HtmlNode[] {
  if (!html || !html.trim()) return [];

  try {
    const tree = fromHtml(html, { fragment: true });
    return hastChildrenToNodes(tree.children as unknown[]);
  } catch {
    // If parsing fails, return the raw text as a single text node
    return [{ type: 'htmlText', value: html }];
  }
}

/**
 * Escape special characters in HTML attribute values.
 */
function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Serialize an HtmlNode back to an HTML string.
 */
function stringifyNode(node: HtmlNode): string {
  switch (node.type) {
    case 'htmlElement': {
      const attrs = Object.entries(node.attributes)
        .map(([k, v]) => (v === '' ? k : `${k}="${escapeHtmlAttr(v)}"`))
        .join(' ');
      const open = attrs ? `<${node.tagName} ${attrs}>` : `<${node.tagName}>`;

      if (node.selfClosing) return open;

      const inner = node.children.map(stringifyNode).join('');
      return `${open}${inner}</${node.tagName}>`;
    }
    case 'htmlText':
      return node.value;
    case 'htmlComment':
      return `<!--${node.value}-->`;
  }
}

/**
 * Serialize an HtmlNode[] tree back to an HTML string.
 *
 * @param nodes - Array of HtmlNode elements to serialize
 * @returns HTML string
 */
export function stringifyHtmlNodes(nodes: HtmlNode[]): string {
  return nodes.map(stringifyNode).join('');
}
