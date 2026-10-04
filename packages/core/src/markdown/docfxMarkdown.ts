import { parseMarkdown } from './parse.js';
import { stringifyMarkdown } from './stringify.js';
import { splitFrontmatterBlock, walkMarkdownTree } from './utils.js';

export interface DocfxMarkdownOptions {
  /** Image omission retains descriptive alt text. */
  images?: 'preserve' | 'omit';
}

/** Convert presentational DocFX directives to portable Markdown without fetching.
 * Includes and code transclusions remain the source adapter's responsibility.
 * All zone variants are retained with their pivot labels. Code examples and
 * frontmatter remain untouched. Unsupported directives throw instead of losing text.
 */
export function normalizeDocfxMarkdown(source: string, options: DocfxMarkdownOptions = {}): string {
  const { frontmatter, body } = splitFrontmatterBlock(source);
  const protectedSpans: Array<[number, number]> = [];
  for (const comment of body.matchAll(/<!--[\s\S]*?-->/g))
    protectedSpans.push([comment.index, comment.index + comment[0].length]);
  walkMarkdownTree(parseMarkdown(body, { frontmatter: false }), (node) => {
    if (
      (node.type === 'code' || node.type === 'inlineCode') &&
      node.position?.start.offset !== undefined &&
      node.position.end.offset !== undefined
    )
      protectedSpans.push([node.position.start.offset, node.position.end.offset]);
  });
  const escape = (text: string): string =>
    stringifyMarkdown({
      type: 'document',
      children: [{ type: 'paragraph', children: [{ type: 'text', value: text }] }],
    }).trimEnd();
  const output = body.replace(
    /(^[^\S\n]*(?:>\s*)?):::\s*([\w-]+)([^\n]*?)(?=\r?$)|(^[^\S\n]*>\s*)\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|div)\b([^\]]*)\]|:::\s*(image)\b([^\n]*?):::/gim,
    (
      match: string,
      prefix: string | undefined,
      name: string | undefined,
      raw: string | undefined,
      quote: string | undefined,
      admonition: string | undefined,
      _extra: string,
      inlineName: string | undefined,
      inlineRaw: string | undefined,
      offset: number,
    ) => {
      if (protectedSpans.some(([start, end]) => offset >= start && offset < end)) return match;
      if (admonition)
        return admonition.toLowerCase() === 'div'
          ? (quote ?? '')
          : `${quote}**${admonition[0] + admonition.slice(1).toLowerCase()}:**`;
      name ??= inlineName;
      raw ??= inlineRaw;
      const attributes = new Map<string, string>();
      for (const attr of (raw ?? '').matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
        attributes.set(attr[1], attr[2] ?? attr[3]);
      switch (name?.toLowerCase()) {
        case 'image': {
          const alt = attributes.get('alt-text') ?? '';
          const url = attributes.get('source');
          if (options.images === 'omit') return `${prefix ?? ''}${escape(alt)}`;
          if (!url) throw new Error('DocFX image has no source');
          const image = stringifyMarkdown({
            type: 'document',
            children: [{ type: 'paragraph', children: [{ type: 'image', url, alt }] }],
          }).trimEnd();
          return `${prefix ?? ''}${image}`;
        }
        case 'zone':
          return attributes.has('pivot')
            ? `${prefix ?? ''}**Applies to: ${escape(attributes.get('pivot')!)}**\n`
            : '';
        case 'zone-end':
        case 'image-end':
        case 'row':
        case 'row-end':
        case 'column':
        case 'column-end':
          return '';
        default:
          throw new Error(`Unsupported DocFX directive: ${name}`);
      }
    },
  );
  return (frontmatter ?? '') + output;
}
