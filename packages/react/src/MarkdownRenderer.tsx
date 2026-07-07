/**
 * MarkdownRenderer Component
 *
 * Converts a MarkdownBlockNode[] AST into React elements for rendering
 * markdown content as readable HTML. Used by LinearDocView to display
 * non-annotated document sections as flowing text.
 *
 * Supports all block and inline node types from the markdown DOM:
 * - Block: paragraph, heading, blockquote, list, code, table,
 *   thematicBreak, math, htmlBlock, definitionList, directives
 * - Inline: text, emphasis, strong, delete, inlineCode, link,
 *   image, break, inlineMath, htmlInline, footnoteReference
 *
 * All elements use the `squisq-md-*` CSS class prefix for styling.
 */

import { Fragment } from 'react';
import {
  sanitizeHtmlNodes,
  sanitizeUrl,
  type HtmlPolicy,
  type HtmlElement,
  type HtmlNode,
  MarkdownBlockNode,
  MarkdownInlineNode,
  MarkdownListItem,
  MarkdownTableRow,
  MarkdownTableCell,
} from '@bendyline/squisq/markdown';
import { useMediaUrl } from './hooks/MediaContext';
import { InlineVideoPlayer } from './InlineVideoPlayer.js';
import { InlineAudioPlayer } from './InlineAudioPlayer.js';

// ── Props ──────────────────────────────────────────────────────────

export interface MarkdownRendererProps {
  /** Block-level AST nodes to render */
  nodes: MarkdownBlockNode[];
  /** Optional CSS class for the wrapper element */
  className?: string;
  /**
   * Raw HTML policy. Defaults to `sanitize`, which removes unsafe tags,
   * event handlers, and executable URL schemes before rendering.
   */
  htmlPolicy?: HtmlPolicy;
  /**
   * Extra URL schemes to allow on links (e.g. a host app's internal
   * navigation scheme it intercepts on click). Executable schemes are
   * never allowed regardless. See {@link SanitizeUrlOptions}.
   */
  linkSchemes?: readonly string[];
}

/** Options threaded through the recursive renderers. */
interface RenderCtx {
  htmlPolicy: HtmlPolicy;
  linkSchemes?: readonly string[];
}

const DEFAULT_CTX: RenderCtx = { htmlPolicy: 'sanitize' };

// ── Inline Renderer ────────────────────────────────────────────────

/** Render an array of inline nodes into React elements. */
function renderInline(
  nodes: MarkdownInlineNode[],
  keyPrefix = '',
  ctx: RenderCtx = DEFAULT_CTX,
): React.ReactNode[] {
  return nodes.map((node, i) => {
    const key = `${keyPrefix}i${i}`;
    switch (node.type) {
      case 'text': {
        // Soft breaks (newlines without two trailing spaces) become \n in
        // text nodes. HTML collapses \n to whitespace, which loses the visual
        // line break the author wanted, so render <br> for each newline.
        if (!node.value.includes('\n')) {
          return <Fragment key={key}>{node.value}</Fragment>;
        }
        const parts = node.value.split('\n');
        return (
          <Fragment key={key}>
            {parts.map((part, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {part}
              </Fragment>
            ))}
          </Fragment>
        );
      }

      case 'emphasis':
        return (
          <em key={key} className="squisq-md-em">
            {renderInline(node.children, key, ctx)}
          </em>
        );

      case 'strong':
        return (
          <strong key={key} className="squisq-md-strong">
            {renderInline(node.children, key, ctx)}
          </strong>
        );

      case 'delete':
        return (
          <del key={key} className="squisq-md-del">
            {renderInline(node.children, key, ctx)}
          </del>
        );

      case 'inlineCode':
        return (
          <code key={key} className="squisq-md-inline-code">
            {node.value}
          </code>
        );

      case 'link': {
        const href = sanitizeUrl(node.url, 'link', { extraLinkSchemes: ctx.linkSchemes });
        if (!href) {
          return (
            <span key={key} className="squisq-md-link squisq-md-link--blocked">
              {renderInline(node.children, key, ctx)}
            </span>
          );
        }
        return (
          <a
            key={key}
            className="squisq-md-link"
            href={href}
            title={node.title ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
          >
            {renderInline(node.children, key, ctx)}
          </a>
        );
      }

      case 'image':
        return (
          <MdImage key={key} src={node.url} alt={node.alt ?? ''} title={node.title ?? undefined} />
        );

      case 'break':
        return <br key={key} />;

      case 'inlineMath':
        return (
          <code key={key} className="squisq-md-inline-math">
            {node.value}
          </code>
        );

      case 'htmlInline':
        if (ctx.htmlPolicy === 'strip') return null;
        // Fast path: no <video>/<audio> in the subtree → use the original
        // rawHtml passthrough (preserves arbitrary HTML for custom embeds).
        if (
          ctx.htmlPolicy === 'trusted' &&
          !containsMediaTag(node.htmlChildren) &&
          !containsDangerousTag(node.htmlChildren) &&
          !hasDangerousRawHtml(node.rawHtml)
        ) {
          return (
            <span
              key={key}
              className="squisq-md-html-inline"
              dangerouslySetInnerHTML={{ __html: node.rawHtml }}
            />
          );
        }
        // Otherwise reconstruct the subtree as React so <video>/<audio>
        // go through MediaContext-aware player components.
        return (
          <span key={key} className="squisq-md-html-inline">
            {renderHtmlNodes(resolveHtmlNodes(node.htmlChildren, ctx.htmlPolicy), `${key}h`)}
          </span>
        );

      case 'footnoteReference':
        return (
          <sup key={key} className="squisq-md-footnote-ref">
            <a href={`#fn-${node.identifier}`}>[{node.label ?? node.identifier}]</a>
          </sup>
        );

      case 'linkReference':
        // Render as plain text (definition targets not available at render time)
        return (
          <span key={key} className="squisq-md-link-ref">
            {renderInline(node.children, key, ctx)}
          </span>
        );

      case 'imageReference':
        return (
          <span key={key} className="squisq-md-image-ref">
            [{node.alt ?? node.identifier}]
          </span>
        );

      case 'textDirective':
        return (
          <span key={key} className="squisq-md-text-directive" data-directive={node.name}>
            {renderInline(node.children, key, ctx)}
          </span>
        );

      case 'mention':
        return (
          <span
            key={key}
            className="squisq-md-mention mention"
            data-mention="true"
            data-kind={node.targetKind}
            data-id={node.targetId}
            data-label={node.displayName}
          >
            @{node.displayName}
          </span>
        );

      default:
        return null;
    }
  });
}

// ── Block Renderer ─────────────────────────────────────────────────

/** Render a single block-level node into a React element. */
function renderBlock(
  node: MarkdownBlockNode,
  key: string,
  ctx: RenderCtx = DEFAULT_CTX,
): React.ReactNode {
  switch (node.type) {
    case 'paragraph':
      return (
        <p key={key} className="squisq-md-p">
          {renderInline(node.children, key, ctx)}
        </p>
      );

    case 'heading': {
      const Tag = `h${node.depth}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      return (
        <Tag key={key} className={`squisq-md-heading squisq-md-h${node.depth}`}>
          {renderInline(node.children, key, ctx)}
        </Tag>
      );
    }

    case 'blockquote':
      return (
        <blockquote key={key} className="squisq-md-blockquote">
          {renderBlocks(node.children, key, ctx)}
        </blockquote>
      );

    case 'list':
      if (node.ordered) {
        return (
          <ol key={key} className="squisq-md-list squisq-md-ol" start={node.start ?? undefined}>
            {node.children.map((item, i) => renderListItem(item, `${key}li${i}`, ctx))}
          </ol>
        );
      }
      return (
        <ul key={key} className="squisq-md-list squisq-md-ul">
          {node.children.map((item, i) => renderListItem(item, `${key}li${i}`, ctx))}
        </ul>
      );

    case 'code':
      return (
        <pre key={key} className="squisq-md-code-block">
          <code className={node.lang ? `language-${node.lang}` : undefined}>{node.value}</code>
        </pre>
      );

    case 'thematicBreak':
      return <hr key={key} className="squisq-md-hr" />;

    case 'table':
      return renderTable(node.children, node.align, key, ctx);

    case 'htmlBlock':
      if (ctx.htmlPolicy === 'strip') return null;
      // Fast path: no <video>/<audio> → preserve the existing rawHtml
      // passthrough so arbitrary HTML embeds still survive verbatim.
      if (
        ctx.htmlPolicy === 'trusted' &&
        !containsMediaTag(node.htmlChildren) &&
        !containsDangerousTag(node.htmlChildren) &&
        !hasDangerousRawHtml(node.rawHtml)
      ) {
        return (
          <div
            key={key}
            className="squisq-md-html-block"
            dangerouslySetInnerHTML={{ __html: node.rawHtml }}
          />
        );
      }
      // Otherwise reconstruct subtree as React so <video>/<audio>
      // route through the player components and resolve via MediaContext.
      return (
        <div key={key} className="squisq-md-html-block">
          {renderHtmlNodes(resolveHtmlNodes(node.htmlChildren, ctx.htmlPolicy), `${key}h`)}
        </div>
      );

    case 'math':
      return (
        <pre key={key} className="squisq-md-math-block">
          <code>{node.value}</code>
        </pre>
      );

    case 'definition':
      // Link definitions aren't rendered visually
      return null;

    case 'footnoteDefinition':
      return (
        <div key={key} className="squisq-md-footnote-def" id={`fn-${node.identifier}`}>
          <sup>{node.label ?? node.identifier}</sup>
          {renderBlocks(node.children, key, ctx)}
        </div>
      );

    case 'containerDirective':
      return (
        <div
          key={key}
          className={`squisq-md-directive squisq-md-directive-${node.name}`}
          data-directive={node.name}
        >
          {node.label && <div className="squisq-md-directive-label">{node.label}</div>}
          {renderBlocks(node.children, key, ctx)}
        </div>
      );

    case 'leafDirective':
      return (
        <div
          key={key}
          className={`squisq-md-directive squisq-md-directive-${node.name}`}
          data-directive={node.name}
        >
          {renderInline(node.children, key, ctx)}
        </div>
      );

    case 'definitionList':
      return (
        <dl key={key} className="squisq-md-dl">
          {node.children.map((child, i) => {
            if (child.type === 'definitionTerm') {
              return (
                <dt key={`${key}dt${i}`} className="squisq-md-dt">
                  {renderInline(child.children, `${key}dt${i}`, ctx)}
                </dt>
              );
            }
            return (
              <dd key={`${key}dd${i}`} className="squisq-md-dd">
                {renderBlocks(child.children, `${key}dd${i}`, ctx)}
              </dd>
            );
          })}
        </dl>
      );

    default:
      return null;
  }
}

/** Render a list item, including task-list checkbox support. */
function renderListItem(
  item: MarkdownListItem,
  key: string,
  ctx: RenderCtx = DEFAULT_CTX,
): React.ReactNode {
  const isTask = item.checked !== null && item.checked !== undefined;
  return (
    <li key={key} className={`squisq-md-li${isTask ? ' squisq-md-task' : ''}`}>
      {isTask && (
        <input type="checkbox" checked={!!item.checked} readOnly className="squisq-md-checkbox" />
      )}
      {renderBlocks(item.children, key, ctx)}
    </li>
  );
}

/** Render a table from rows and alignment data. */
function renderTable(
  rows: MarkdownTableRow[],
  align: (('left' | 'right' | 'center') | null)[] | undefined,
  key: string,
  ctx: RenderCtx = DEFAULT_CTX,
): React.ReactNode {
  const [headerRow, ...bodyRows] = rows;
  return (
    <table key={key} className="squisq-md-table">
      {headerRow && (
        <thead>
          <tr>
            {headerRow.children.map((cell: MarkdownTableCell, ci: number) => (
              <th
                key={`${key}th${ci}`}
                className="squisq-md-th"
                style={align?.[ci] ? { textAlign: align[ci]! } : undefined}
              >
                {renderInline(cell.children, `${key}th${ci}`, ctx)}
              </th>
            ))}
          </tr>
        </thead>
      )}
      {bodyRows.length > 0 && (
        <tbody>
          {bodyRows.map((row, ri) => (
            <tr key={`${key}tr${ri}`}>
              {row.children.map((cell: MarkdownTableCell, ci: number) => (
                <td
                  key={`${key}td${ri}-${ci}`}
                  className="squisq-md-td"
                  style={align?.[ci] ? { textAlign: align[ci]! } : undefined}
                >
                  {renderInline(cell.children, `${key}td${ri}-${ci}`, ctx)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      )}
    </table>
  );
}

/** Render an array of block-level nodes. */
function renderBlocks(
  nodes: MarkdownBlockNode[],
  keyPrefix = '',
  ctx: RenderCtx = DEFAULT_CTX,
): React.ReactNode[] {
  return nodes.map((node, i) => renderBlock(node, `${keyPrefix}b${i}`, ctx));
}

// ── Image with MediaProvider resolution ───────────────────────────

/** Renders an <img> that resolves its src through the MediaProvider when available. */
function MdImage({ src, alt, title }: { src: string; alt: string; title?: string }) {
  const safeSrc = sanitizeUrl(src, 'media');
  const resolved = useMediaUrl(safeSrc ?? '', '.');
  if (!safeSrc) return null;
  return <img className="squisq-md-image" src={resolved} alt={alt} title={title} />;
}

// ── Raw-HTML walker (intercepts <video>/<audio>) ─────────────────

/** True when the htmlElement subtree contains a tag we want to swap
 *  for a React component. Cheap recursive scan — lets us keep the
 *  `dangerouslySetInnerHTML` fast path for everything else. */
function resolveHtmlNodes(nodes: HtmlNode[], htmlPolicy: HtmlPolicy): HtmlNode[] {
  if (htmlPolicy === 'strip') return [];
  if (htmlPolicy === 'trusted') return nodes;
  return sanitizeHtmlNodes(nodes);
}

function containsMediaTag(nodes: HtmlNode[]): boolean {
  for (const node of nodes) {
    if (node.type !== 'htmlElement') continue;
    const tagName = node.tagName.toLowerCase();
    if (tagName === 'video' || tagName === 'audio') return true;
    if (containsMediaTag(node.children)) return true;
  }
  return false;
}

/**
 * Tags that can escape their container and affect the whole host
 * document — global styling, script execution, external/resource loads,
 * or framing. Markdown content is frequently untrusted (LLM output,
 * pasted snippets), and these tags have no business mutating the page
 * they're embedded in, so they are *always* dropped — even under the
 * `'trusted'` policy. "Trusted" means "render this HTML's structure
 * verbatim," not "let it restyle or script the host." A stray `<style>`
 * applies document-wide (CSS has no per-element scoping outside shadow
 * DOM / iframes), which is exactly how an embedded game's `<style>`
 * leaked onto the surrounding app chrome.
 */
const DANGEROUS_HTML_TAGS = new Set([
  'base',
  'embed',
  'iframe',
  'link',
  'meta',
  'object',
  'script',
  'style',
  'title',
]);

/** True when the subtree contains any host-affecting tag (see
 *  {@link DANGEROUS_HTML_TAGS}). Mirrors {@link containsMediaTag}: keeps
 *  such content off the verbatim `dangerouslySetInnerHTML` fast path so
 *  it routes through the React reconstruction, which drops the tag. */
function containsDangerousTag(nodes: HtmlNode[]): boolean {
  for (const node of nodes) {
    if (node.type !== 'htmlElement') continue;
    if (DANGEROUS_HTML_TAGS.has(node.tagName.toLowerCase())) return true;
    if (containsDangerousTag(node.children)) return true;
  }
  return false;
}

/**
 * Raw-string backstop for {@link DANGEROUS_HTML_TAGS}. The structural
 * {@link containsDangerousTag} check covers the normal case, but a block
 * parsed with `parseHtml: false` carries an empty `htmlChildren` while
 * `rawHtml` still holds the markup — so the verbatim fast path scans the
 * raw string too, guaranteeing a `<style>`/`<script>` can never be
 * injected into the host document by that path no matter how the node
 * was produced. The `\b` keeps `<styled-thing>` from matching `<style>`.
 */
const DANGEROUS_RAW_HTML_RE =
  /<\s*\/?\s*(?:base|embed|iframe|link|meta|object|script|style|title)\b/i;

function hasDangerousRawHtml(rawHtml: string): boolean {
  return DANGEROUS_RAW_HTML_RE.test(rawHtml);
}

/** A pragmatic shortlist of HTML attributes the raw-HTML walker
 *  passes through to React when reconstructing a non-media element.
 *  Anything outside this list is silently dropped — the media-tag
 *  fast path means most authors will never hit this code, so we
 *  keep the surface narrow to avoid React warnings about unknown
 *  attributes. */
const PASSTHROUGH_ATTRS: Record<string, string> = {
  // common
  class: 'className',
  id: 'id',
  title: 'title',
  style: 'style',
  // media-adjacent (used when video/audio appear inside other wrappers)
  width: 'width',
  height: 'height',
  src: 'src',
  alt: 'alt',
  loading: 'loading',
  decoding: 'decoding',
  // anchor
  href: 'href',
  target: 'target',
  rel: 'rel',
};

function reactPropsFromAttrs(attrs: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(attrs)) {
    const propName = PASSTHROUGH_ATTRS[name];
    if (!propName) continue;
    if (propName === 'style') {
      // We can't safely parse arbitrary `style="..."` strings without
      // an HTML parser; preserve as a data attribute so authors can
      // see it survived round-trip without crashing React.
      out['data-style'] = value;
      continue;
    }
    out[propName] = value;
  }
  return out;
}

function renderHtmlElement(el: HtmlElement, key: string): React.ReactNode {
  const tagName = el.tagName.toLowerCase();
  // Final safety net: never reconstruct a host-affecting element (e.g. a
  // <style> that would leak globally), whatever the policy. The fast path
  // is gated by containsDangerousTag, so trusted content carrying these
  // tags lands here — drop the tag and keep the rest of the subtree.
  if (DANGEROUS_HTML_TAGS.has(tagName)) return null;
  if (tagName === 'video') {
    return (
      <InlineVideoPlayer
        key={key}
        src={el.attributes.src ?? ''}
        width={el.attributes.width}
        height={el.attributes.height}
        poster={el.attributes.poster}
        // The `controls` attribute is a boolean — present means true,
        // even if its value is an empty string.
        controls={'controls' in el.attributes}
        preload={
          el.attributes.preload === 'none' ||
          el.attributes.preload === 'metadata' ||
          el.attributes.preload === 'auto'
            ? el.attributes.preload
            : undefined
        }
      />
    );
  }
  if (tagName === 'audio') {
    return (
      <InlineAudioPlayer
        key={key}
        src={el.attributes.src ?? ''}
        controls={'controls' in el.attributes}
        preload={
          el.attributes.preload === 'none' ||
          el.attributes.preload === 'metadata' ||
          el.attributes.preload === 'auto'
            ? el.attributes.preload
            : undefined
        }
      />
    );
  }

  const Tag = tagName as keyof JSX.IntrinsicElements;
  const props = reactPropsFromAttrs(el.attributes);
  if (el.selfClosing) {
    return <Tag key={key} {...props} />;
  }
  return (
    <Tag key={key} {...props}>
      {renderHtmlNodes(el.children, `${key}c`)}
    </Tag>
  );
}

function renderHtmlNodes(nodes: HtmlNode[], keyPrefix: string): React.ReactNode[] {
  return nodes.map((node, i) => {
    const key = `${keyPrefix}${i}`;
    switch (node.type) {
      case 'htmlElement':
        return renderHtmlElement(node, key);
      case 'htmlText':
        return <Fragment key={key}>{node.value}</Fragment>;
      case 'htmlComment':
        // Comments don't render in React; ignore.
        return null;
      default:
        return null;
    }
  });
}

// ── Main Component ─────────────────────────────────────────────────

/**
 * Renders MarkdownBlockNode[] AST as React HTML elements.
 *
 * @example
 * ```tsx
 * <MarkdownRenderer nodes={block.contents} />
 * ```
 */
export function MarkdownRenderer({
  nodes,
  className,
  htmlPolicy = 'sanitize',
  linkSchemes,
}: MarkdownRendererProps) {
  if (!nodes || nodes.length === 0) return null;

  return (
    <div className={`squisq-md ${className || ''}`}>
      {renderBlocks(nodes, '', { htmlPolicy, linkSchemes })}
    </div>
  );
}
