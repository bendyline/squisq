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
import type {
  MarkdownBlockNode,
  MarkdownInlineNode,
  MarkdownListItem,
  MarkdownTableRow,
  MarkdownTableCell,
  HtmlNode,
  HtmlElement,
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
}

// ── Inline Renderer ────────────────────────────────────────────────

/** Render an array of inline nodes into React elements. */
function renderInline(nodes: MarkdownInlineNode[], keyPrefix = ''): React.ReactNode[] {
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
            {renderInline(node.children, key)}
          </em>
        );

      case 'strong':
        return (
          <strong key={key} className="squisq-md-strong">
            {renderInline(node.children, key)}
          </strong>
        );

      case 'delete':
        return (
          <del key={key} className="squisq-md-del">
            {renderInline(node.children, key)}
          </del>
        );

      case 'inlineCode':
        return (
          <code key={key} className="squisq-md-inline-code">
            {node.value}
          </code>
        );

      case 'link':
        return (
          <a
            key={key}
            className="squisq-md-link"
            href={node.url}
            title={node.title ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
          >
            {renderInline(node.children, key)}
          </a>
        );

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
        // Fast path: no <video>/<audio> in the subtree → use the original
        // rawHtml passthrough (preserves arbitrary HTML for custom embeds).
        if (!containsMediaTag(node.htmlChildren)) {
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
            {renderHtmlNodes(node.htmlChildren, `${key}h`)}
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
            {renderInline(node.children, key)}
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
            {renderInline(node.children, key)}
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
function renderBlock(node: MarkdownBlockNode, key: string): React.ReactNode {
  switch (node.type) {
    case 'paragraph':
      return (
        <p key={key} className="squisq-md-p">
          {renderInline(node.children, key)}
        </p>
      );

    case 'heading': {
      const Tag = `h${node.depth}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      return (
        <Tag key={key} className={`squisq-md-heading squisq-md-h${node.depth}`}>
          {renderInline(node.children, key)}
        </Tag>
      );
    }

    case 'blockquote':
      return (
        <blockquote key={key} className="squisq-md-blockquote">
          {renderBlocks(node.children, key)}
        </blockquote>
      );

    case 'list':
      if (node.ordered) {
        return (
          <ol key={key} className="squisq-md-list squisq-md-ol" start={node.start ?? undefined}>
            {node.children.map((item, i) => renderListItem(item, `${key}li${i}`))}
          </ol>
        );
      }
      return (
        <ul key={key} className="squisq-md-list squisq-md-ul">
          {node.children.map((item, i) => renderListItem(item, `${key}li${i}`))}
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
      return renderTable(node.children, node.align, key);

    case 'htmlBlock':
      // Fast path: no <video>/<audio> → preserve the existing rawHtml
      // passthrough so arbitrary HTML embeds still survive verbatim.
      if (!containsMediaTag(node.htmlChildren)) {
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
          {renderHtmlNodes(node.htmlChildren, `${key}h`)}
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
          {renderBlocks(node.children, key)}
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
          {renderBlocks(node.children, key)}
        </div>
      );

    case 'leafDirective':
      return (
        <div
          key={key}
          className={`squisq-md-directive squisq-md-directive-${node.name}`}
          data-directive={node.name}
        >
          {renderInline(node.children, key)}
        </div>
      );

    case 'definitionList':
      return (
        <dl key={key} className="squisq-md-dl">
          {node.children.map((child, i) => {
            if (child.type === 'definitionTerm') {
              return (
                <dt key={`${key}dt${i}`} className="squisq-md-dt">
                  {renderInline(child.children, `${key}dt${i}`)}
                </dt>
              );
            }
            return (
              <dd key={`${key}dd${i}`} className="squisq-md-dd">
                {renderBlocks(child.children, `${key}dd${i}`)}
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
function renderListItem(item: MarkdownListItem, key: string): React.ReactNode {
  const isTask = item.checked !== null && item.checked !== undefined;
  return (
    <li key={key} className={`squisq-md-li${isTask ? ' squisq-md-task' : ''}`}>
      {isTask && (
        <input type="checkbox" checked={!!item.checked} readOnly className="squisq-md-checkbox" />
      )}
      {renderBlocks(item.children, key)}
    </li>
  );
}

/** Render a table from rows and alignment data. */
function renderTable(
  rows: MarkdownTableRow[],
  align: (('left' | 'right' | 'center') | null)[] | undefined,
  key: string,
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
                {renderInline(cell.children, `${key}th${ci}`)}
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
                  {renderInline(cell.children, `${key}td${ri}-${ci}`)}
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
function renderBlocks(nodes: MarkdownBlockNode[], keyPrefix = ''): React.ReactNode[] {
  return nodes.map((node, i) => renderBlock(node, `${keyPrefix}b${i}`));
}

// ── Image with MediaProvider resolution ───────────────────────────

/** Renders an <img> that resolves its src through the MediaProvider when available. */
function MdImage({ src, alt, title }: { src: string; alt: string; title?: string }) {
  const resolved = useMediaUrl(src, '.');
  return <img className="squisq-md-image" src={resolved} alt={alt} title={title} />;
}

// ── Raw-HTML walker (intercepts <video>/<audio>) ─────────────────

/** True when the htmlElement subtree contains a tag we want to swap
 *  for a React component. Cheap recursive scan — lets us keep the
 *  `dangerouslySetInnerHTML` fast path for everything else. */
function containsMediaTag(nodes: HtmlNode[]): boolean {
  for (const node of nodes) {
    if (node.type !== 'htmlElement') continue;
    if (node.tagName === 'video' || node.tagName === 'audio') return true;
    if (containsMediaTag(node.children)) return true;
  }
  return false;
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
  if (el.tagName === 'video') {
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
  if (el.tagName === 'audio') {
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

  const Tag = el.tagName as keyof JSX.IntrinsicElements;
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
export function MarkdownRenderer({ nodes, className }: MarkdownRendererProps) {
  if (!nodes || nodes.length === 0) return null;

  return <div className={`squisq-md ${className || ''}`}>{renderBlocks(nodes)}</div>;
}
