/**
 * Shared Markdown fidelity reporting for exporters that intentionally support
 * only a subset of the core Markdown AST. Keeping the capability profiles in
 * one exhaustive table prevents each exporter from silently drifting as the
 * core AST grows.
 */

import type {
  MarkdownBlockNode,
  MarkdownDocument,
  MarkdownInlineNode,
} from '@bendyline/squisq/markdown';

type ContentNodeType = MarkdownBlockNode['type'] | MarkdownInlineNode['type'];
export type MarkdownExportProfile = 'docx' | 'pdf' | 'pptx' | 'epub';

/**
 * Exhaustive by construction: adding a Markdown node type in core makes this
 * package fail typechecking until its export fidelity is considered here.
 */
const CONTENT_NODE_TYPES: Record<ContentNodeType, true> = {
  heading: true,
  paragraph: true,
  blockquote: true,
  list: true,
  code: true,
  thematicBreak: true,
  table: true,
  htmlBlock: true,
  math: true,
  definition: true,
  footnoteDefinition: true,
  containerDirective: true,
  leafDirective: true,
  definitionList: true,
  text: true,
  emphasis: true,
  strong: true,
  delete: true,
  superscript: true,
  subscript: true,
  inlineCode: true,
  link: true,
  image: true,
  break: true,
  htmlInline: true,
  inlineMath: true,
  footnoteReference: true,
  linkReference: true,
  imageReference: true,
  textDirective: true,
  mention: true,
  inlineIcon: true,
};

const COMMON_SUPPORTED: readonly ContentNodeType[] = [
  'heading',
  'paragraph',
  'blockquote',
  'list',
  'code',
  'thematicBreak',
  'table',
  'htmlBlock',
  'math',
  'text',
  'emphasis',
  'strong',
  'delete',
  'superscript',
  'subscript',
  'inlineCode',
  'link',
  'image',
  'break',
  'htmlInline',
  'inlineMath',
];

const PROFILE_SUPPORT: Record<MarkdownExportProfile, ReadonlySet<ContentNodeType>> = {
  docx: new Set([...COMMON_SUPPORTED, 'footnoteDefinition', 'footnoteReference']),
  pdf: new Set([...COMMON_SUPPORTED, 'footnoteDefinition', 'footnoteReference']),
  pptx: new Set(COMMON_SUPPORTED),
  epub: new Set(COMMON_SUPPORTED),
};

const PROFILE_LABELS: Record<MarkdownExportProfile, string> = {
  docx: 'DOCX',
  pdf: 'PDF',
  pptx: 'PPTX',
  epub: 'EPUB',
};

interface AstLikeNode {
  type?: string;
  children?: unknown;
}

/** Return a user-facing warning when an exporter will omit Markdown nodes. */
export function markdownFidelityWarnings(
  document: MarkdownDocument,
  profile: MarkdownExportProfile,
): string[] {
  const supported = PROFILE_SUPPORT[profile];
  const omitted = new Map<ContentNodeType, number>();

  const visit = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== 'object') return;
    const node = candidate as AstLikeNode;
    const type = node.type as ContentNodeType | undefined;

    if (type && Object.prototype.hasOwnProperty.call(CONTENT_NODE_TYPES, type)) {
      if (!supported.has(type)) {
        // The exporter drops this whole subtree, so report the highest-fidelity
        // boundary once instead of inflating the count with its descendants.
        omitted.set(type, (omitted.get(type) ?? 0) + 1);
        return;
      }
    }

    if (Array.isArray(node.children)) {
      for (const child of node.children) visit(child);
    }
  };

  for (const child of document.children) visit(child);
  if (omitted.size === 0) return [];

  const total = [...omitted.values()].reduce((sum, count) => sum + count, 0);
  const details = [...omitted].map(([type, count]) => `${type} (${count})`).join(', ');
  return [
    `${PROFILE_LABELS[profile]} export omitted ${total} unsupported Markdown node(s): ${details}.`,
  ];
}
