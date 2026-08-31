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
 *   image, break, inlineMath, htmlInline, footnoteReference,
 *   superscript, subscript
 *
 * All elements use the `squisq-md-*` CSS class prefix for styling.
 */

import { Component, Fragment, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Theme } from '@bendyline/squisq/schemas';
import type { FenceRendererMap } from '@bendyline/squisq/fence';
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
import { useMediaProvider, useMediaUrl } from './hooks/MediaContext';
import { useFenceRenderers } from './hooks/FenceRendererContext';
import { InlineVideoPlayer } from './InlineVideoPlayer.js';
import { InlineAudioPlayer } from './InlineAudioPlayer.js';
import { MermaidDiagram } from './mermaid/MermaidDiagram.js';

// ── Props ──────────────────────────────────────────────────────────

export interface CodeBlockCopyContext {
  /** Authored fence language, when one was supplied. */
  language?: string;
}

/**
 * Host-owned clipboard adapter for fenced code blocks.
 *
 * The callback runs directly from the button's click handler so Electron
 * bridges and browser Clipboard APIs retain their user-gesture context.
 */
export type CodeBlockCopyHandler = (
  code: string,
  context: CodeBlockCopyContext,
) => void | Promise<void>;

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
  /** Resolved Squisq theme inherited by embedded Mermaid diagrams. */
  theme?: Theme;
  /** Show a subtle Copy button on ordinary fenced code blocks (default: false). */
  showCodeCopyButton?: boolean;
  /**
   * Optional host clipboard adapter. When omitted, enabled copy buttons use
   * `navigator.clipboard.writeText`. Supply this for Electron, native shells,
   * or hosts with their own clipboard permission/error handling.
   */
  onCopyCode?: CodeBlockCopyHandler;
  /**
   * Host fence-renderer registry (`@bendyline/squisq/fence`): fenced code
   * blocks whose language is claimed render through the host's widget
   * instead of the default code block. Wins over the built-in mermaid
   * handling and over an ambient `FenceRendererContext`; a renderer that
   * throws falls back to the plain code block via an error boundary.
   */
  fenceRenderers?: FenceRendererMap;
}

/** Options threaded through the recursive renderers. */
interface RenderCtx {
  htmlPolicy: HtmlPolicy;
  linkSchemes?: readonly string[];
  theme?: Theme;
  showCodeCopyButton?: boolean;
  onCopyCode?: CodeBlockCopyHandler;
  fenceRenderers?: FenceRendererMap;
  accessoryPaths?: ReadonlySet<string>;
}

const DEFAULT_CTX: RenderCtx = { htmlPolicy: 'sanitize' };

type CodeCopyStatus = 'idle' | 'copying' | 'copied' | 'failed';

const CODE_COPY_LABELS: Record<CodeCopyStatus, string> = {
  idle: 'Copy',
  copying: 'Copying\u2026',
  copied: 'Copied',
  failed: 'Copy failed',
};

async function writeCodeToClipboard(
  code: string,
  language: string | undefined,
  onCopyCode: CodeBlockCopyHandler | undefined,
): Promise<void> {
  if (onCopyCode) {
    await onCopyCode(code, language === undefined ? {} : { language });
    return;
  }
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    throw new Error('Clipboard access is unavailable in this host');
  }
  await navigator.clipboard.writeText(code);
}

function CodeBlock({
  value,
  language,
  ctx,
}: {
  value: string;
  language?: string | null;
  ctx: RenderCtx;
}) {
  const [status, setStatus] = useState<CodeCopyStatus>('idle');
  const resetTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(
    () => () => {
      if (resetTimer.current !== undefined) clearTimeout(resetTimer.current);
    },
    [],
  );

  const pre = (
    <pre className="squisq-md-code-block">
      <code className={language ? `language-${language}` : undefined}>{value}</code>
    </pre>
  );

  if (!ctx.showCodeCopyButton) return pre;

  const handleCopy = async () => {
    if (status === 'copying') return;
    setStatus('copying');
    try {
      await writeCodeToClipboard(value, language ?? undefined, ctx.onCopyCode);
      setStatus('copied');
    } catch {
      setStatus('failed');
    }
    if (resetTimer.current !== undefined) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setStatus('idle'), 1600);
  };

  return (
    <div className="squisq-md-code-frame">
      {pre}
      <button
        type="button"
        className="squisq-md-code-copy"
        data-copy-state={status}
        disabled={status === 'copying'}
        onClick={() => void handleCopy()}
        aria-label="Copy code to clipboard"
      >
        {CODE_COPY_LABELS[status]}
      </button>
    </div>
  );
}

/**
 * Containment for host fence widgets: a renderer that throws during
 * render falls back to the plain code block, so one broken widget never
 * takes the whole document down.
 */
class FenceWidgetBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function HostFence({
  node,
  lang,
  ctx,
}: {
  node: Extract<MarkdownBlockNode, { type: 'code' }>;
  lang: string;
  ctx: RenderCtx;
}) {
  const renderer = ctx.fenceRenderers?.[lang];
  if (!renderer) return null;
  return (
    <div className={`squisq-md-fence-widget squisq-md-fence-widget-${lang}`} data-fence-lang={lang}>
      {
        renderer({
          lang,
          ...(node.meta != null ? { meta: node.meta } : {}),
          value: node.value,
          ...(ctx.theme ? { theme: ctx.theme } : {}),
          mode: 'read',
        }) as ReactNode
      }
    </div>
  );
}

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

      case 'superscript':
        return (
          <sup key={key} className="squisq-md-sup">
            {renderInline(node.children, key, ctx)}
          </sup>
        );

      case 'subscript':
        return (
          <sub key={key} className="squisq-md-sub">
            {renderInline(node.children, key, ctx)}
          </sub>
        );

      case 'inlineCode':
        return (
          <code key={key} className="squisq-md-inline-code">
            {node.value}
          </code>
        );

      case 'link': {
        if (ctx.accessoryPaths?.has(node.url)) {
          return (
            <span
              key={key}
              className="squisq-md-attachment"
              data-attachment-path={node.url}
              title={node.title ?? `Attachment: ${node.url}`}
            >
              <i className="fa-solid fa-paperclip" aria-hidden="true" />
              <span className="squisq-md-attachment-label">
                {renderInline(node.children, key, ctx)}
              </span>
            </span>
          );
        }
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

      case 'inlineIcon':
        return (
          <i
            key={key}
            className={`fa-${node.family} fa-${node.name}`}
            data-icon={node.token}
            aria-hidden="true"
          />
        );

      case 'htmlInline':
        if (ctx.htmlPolicy === 'strip') return null;
        // Reconstruct every subtree as React. Besides routing media through
        // MediaContext, this keeps event-handler attributes and unsafe URLs
        // out of the DOM even when the caller selected `trusted` structure.
        return (
          <span key={key} className="squisq-md-html-inline">
            {renderHtmlNodes(resolveHtmlNodes(node.htmlChildren, ctx.htmlPolicy), `${key}h`, ctx)}
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

    case 'code': {
      const fenceLang = node.lang?.trim().toLowerCase();
      // Host-registered renderers win over the built-in mermaid handling —
      // that's the point of registering. A throwing renderer degrades to
      // the plain code block via the boundary.
      if (fenceLang && ctx.fenceRenderers?.[fenceLang]) {
        return (
          <FenceWidgetBoundary
            key={key}
            fallback={<CodeBlock value={node.value} language={node.lang} ctx={ctx} />}
          >
            <HostFence node={node} lang={fenceLang} ctx={ctx} />
          </FenceWidgetBoundary>
        );
      }
      if (fenceLang === 'mermaid') {
        return (
          <MermaidDiagram
            key={key}
            source={node.value}
            className="squisq-md-mermaid"
            ariaLabel="Mermaid diagram"
            theme={ctx.theme}
          />
        );
      }
      return <CodeBlock key={key} value={node.value} language={node.lang} ctx={ctx} />;
    }

    case 'thematicBreak':
      return <hr key={key} className="squisq-md-hr" />;

    case 'table':
      return renderTable(node.children, node.align, key, ctx);

    case 'htmlBlock':
      if (ctx.htmlPolicy === 'strip') return null;
      // The structural walker is deliberately the only rendering path: raw
      // HTML strings never bypass the tag, attribute, and URL policy below.
      return (
        <div key={key} className="squisq-md-html-block">
          {renderHtmlNodes(resolveHtmlNodes(node.htmlChildren, ctx.htmlPolicy), `${key}h`, ctx)}
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

/** Apply the caller's structural HTML policy before React reconstruction. */
function resolveHtmlNodes(nodes: HtmlNode[], htmlPolicy: HtmlPolicy): HtmlNode[] {
  if (htmlPolicy === 'strip') return [];
  if (htmlPolicy === 'trusted') return nodes;
  return sanitizeHtmlNodes(nodes);
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

/** A pragmatic shortlist of HTML attributes the raw-HTML walker
 *  passes through to React when reconstructing a non-media element.
 *  Anything outside this list is silently dropped. */
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

/** Link targets that reuse an existing browsing context, so carry no
 *  `window.opener` exposure and need no `rel="noopener"`. An empty target is
 *  equivalent to `_self`. */
const RE_USED_TARGETS = new Set(['', '_self', '_parent', '_top']);

function reactPropsFromAttrs(
  attrs: Record<string, string>,
  ctx: RenderCtx,
): Record<string, unknown> {
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
    if (propName === 'href') {
      const href = sanitizeUrl(value, 'link', { extraLinkSchemes: ctx.linkSchemes });
      if (href) out.href = href;
      continue;
    }
    if (propName === 'src') {
      const src = sanitizeUrl(value, 'media');
      if (src) out.src = src;
      continue;
    }
    out[propName] = value;
  }

  // A target that opens a NEW browsing context (`_blank`, or any named frame
  // that does not yet exist) hands the destination a live `window.opener`
  // handle to this page unless `noopener` is set — the classic
  // reverse-tabnabbing vector. Markdown-native links hardcode
  // `rel="noopener noreferrer"`; authored raw HTML must not be able to opt out.
  // `_self`/`_parent`/`_top` reuse an existing context and are unaffected.
  // Only `noopener` is forced: `noreferrer` is a privacy choice that stays the
  // author's, and an explicit `opener` token is dropped as it contradicts.
  if (typeof out.target === 'string' && !RE_USED_TARGETS.has(out.target.toLowerCase())) {
    const rel = typeof out.rel === 'string' ? out.rel : '';
    const tokens = rel.split(/\s+/).filter((t) => t && t.toLowerCase() !== 'opener');
    if (!tokens.some((t) => t.toLowerCase() === 'noopener')) tokens.push('noopener');
    out.rel = tokens.join(' ');
  }

  return out;
}

function renderHtmlElement(el: HtmlElement, key: string, ctx: RenderCtx): React.ReactNode {
  const tagName = el.tagName.toLowerCase();
  // Never reconstruct a host-affecting element (e.g. a <style> that would
  // leak globally), whatever the policy.
  if (DANGEROUS_HTML_TAGS.has(tagName)) return null;
  if (tagName === 'video') {
    const src = sanitizeUrl(el.attributes.src ?? '', 'media') ?? '';
    const poster = sanitizeUrl(el.attributes.poster ?? '', 'media') ?? undefined;
    return (
      <InlineVideoPlayer
        key={key}
        src={src}
        width={el.attributes.width}
        height={el.attributes.height}
        poster={poster}
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
    const src = sanitizeUrl(el.attributes.src ?? '', 'media') ?? '';
    return (
      <InlineAudioPlayer
        key={key}
        src={src}
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
  const props = reactPropsFromAttrs(el.attributes, ctx);
  if (el.selfClosing) {
    return <Tag key={key} {...props} />;
  }
  return (
    <Tag key={key} {...props}>
      {renderHtmlNodes(el.children, `${key}c`, ctx)}
    </Tag>
  );
}

function renderHtmlNodes(
  nodes: HtmlNode[],
  keyPrefix: string,
  ctx: RenderCtx = DEFAULT_CTX,
): React.ReactNode[] {
  return nodes.map((node, i) => {
    const key = `${keyPrefix}${i}`;
    switch (node.type) {
      case 'htmlElement':
        return renderHtmlElement(node, key, ctx);
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

/**
 * Shared empty accessory set. Clearing through `clearAccessoryPaths` keeps the
 * identity stable, so a renderer with no media provider settles in ONE render
 * pass instead of always re-rendering once on mount — which matters because
 * host fence renderers are invoked during render.
 */
const NO_ACCESSORY_PATHS: ReadonlySet<string> = new Set<string>();

const clearAccessoryPaths = (prev: ReadonlySet<string>): ReadonlySet<string> =>
  prev.size === 0 ? prev : NO_ACCESSORY_PATHS;

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
  theme,
  showCodeCopyButton = false,
  onCopyCode,
  fenceRenderers,
}: MarkdownRendererProps) {
  // Ambient registry fallback: the explicit prop always wins (pass `{}`
  // to opt a surface out under a provider).
  const ambientFenceRenderers = useFenceRenderers();
  const mediaProvider = useMediaProvider();
  const [accessoryPaths, setAccessoryPaths] = useState<ReadonlySet<string>>(NO_ACCESSORY_PATHS);
  useEffect(() => {
    if (!mediaProvider) {
      setAccessoryPaths(clearAccessoryPaths);
      return;
    }

    let cancelled = false;
    mediaProvider.listMedia().then(
      (entries) => {
        if (!cancelled) setAccessoryPaths(new Set(entries.map((entry) => entry.name)));
      },
      () => {
        if (!cancelled) setAccessoryPaths(clearAccessoryPaths);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [mediaProvider]);
  if (!nodes || nodes.length === 0) return null;

  return (
    <div className={`squisq-md ${className || ''}`}>
      {renderBlocks(nodes, '', {
        htmlPolicy,
        linkSchemes,
        theme,
        showCodeCopyButton,
        onCopyCode,
        accessoryPaths,
        fenceRenderers: fenceRenderers ?? ambientFenceRenderers ?? undefined,
      })}
    </div>
  );
}
