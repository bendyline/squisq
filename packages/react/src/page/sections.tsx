/**
 * Page section components — one variable-height HTML/CSS layout per
 * `PageSectionKind`. All styling flows through the structural
 * `PAGE_BASE_CSS` (core `doc/pageCss.ts`) + the `--squisq-page-*` custom
 * properties and token data-attributes set by `LinearDocView`, so a theme
 * changes the design without touching these components.
 */

import type { CSSProperties, ReactNode } from 'react';
import type { Block } from '@bendyline/squisq/schemas';
import type { PageMedia, PageSection } from '@bendyline/squisq/doc';
import { sanitizeUrl } from '@bendyline/squisq/markdown';
import { MarkdownRenderer } from '../MarkdownRenderer';
import { InlineVideoPlayer } from '../InlineVideoPlayer';
import { useMediaUrl } from '../hooks/MediaContext';
import { usePageView } from './PageViewContext';

// ── Shared bits ────────────────────────────────────────────────────

export interface SectionProps {
  section: PageSection;
  /** Source block (prose headings/bodies render its markdown nodes). */
  block?: Block;
}

/** Media-resolved, lazy `<img>` for section media slots. */
function PageImg({
  media,
  eager,
  className,
}: {
  media: Extract<PageMedia, { type: 'image' }>;
  eager?: boolean;
  className?: string;
}) {
  const { basePath } = usePageView();
  const safeSrc = sanitizeUrl(media.src, 'media');
  const resolved = useMediaUrl(safeSrc ?? '', basePath);
  if (!safeSrc) return null;
  return (
    <img
      className={className}
      src={resolved}
      alt={media.alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      width={media.width}
      height={media.height}
    />
  );
}

/** Full-bleed backdrop video (muted ambient loop). */
function BackdropVideo({ media }: { media: Extract<PageMedia, { type: 'video' }> }) {
  const { basePath } = usePageView();
  const safeSrc = sanitizeUrl(media.src, 'media');
  const resolvedSrc = useMediaUrl(safeSrc ?? '', basePath);
  const safePoster = media.posterSrc ? sanitizeUrl(media.posterSrc, 'media') : undefined;
  const resolvedPoster = useMediaUrl(safePoster ?? '', basePath);
  if (!safeSrc) return null;
  return (
    <video
      src={resolvedSrc}
      poster={safePoster ? resolvedPoster : undefined}
      muted
      loop
      autoPlay
      playsInline
      preload="metadata"
    />
  );
}

function Eyebrow({ section }: { section: PageSection }) {
  if (!section.slots.eyebrow) return null;
  return <span className="squisq-page-eyebrow">{section.slots.eyebrow}</span>;
}

function MediaCredit({ media }: { media?: PageMedia }) {
  if (!media || media.type === 'canvas' || !media.credit) return null;
  return (
    <span className="squisq-page-media-credit">
      {media.credit}
      {media.license ? ` · ${media.license}` : ''}
    </span>
  );
}

// ── Hero ───────────────────────────────────────────────────────────

export function HeroSection({ section }: SectionProps) {
  const { pageStyle } = usePageView();
  const media = section.slots.media;
  const image = media?.type === 'image' ? media : undefined;
  const heroStyle = pageStyle.tokens.heroStyle;

  const body = (
    <div className="squisq-page-hero-body">
      <Eyebrow section={section} />
      <h1 className="squisq-page-hero-title">{section.slots.title}</h1>
      {section.slots.subtitle && (
        <p className="squisq-page-hero-subtitle">{section.slots.subtitle}</p>
      )}
    </div>
  );

  if (image && heroStyle === 'split') {
    return (
      <div className="squisq-page-hero-grid">
        {body}
        <div className="squisq-page-hero-media squisq-page-media-frame">
          <PageImg media={image} eager />
          <MediaCredit media={image} />
        </div>
      </div>
    );
  }

  return (
    <>
      {image && section.background === 'media' && (
        <div className="squisq-page-hero-backdrop">
          <PageImg media={image} eager />
        </div>
      )}
      {body}
    </>
  );
}

// ── Banner (sectionHeader) ─────────────────────────────────────────

export function BannerSection({ section }: SectionProps) {
  const media = section.slots.media;
  const image = media?.type === 'image' ? media : undefined;
  return (
    <>
      {image && section.background === 'media' && (
        <div className="squisq-page-hero-backdrop">
          <PageImg media={image} />
        </div>
      )}
      <div className="squisq-page-banner-body">
        <Eyebrow section={section} />
        <h2 className="squisq-page-section-title squisq-page-banner-title">
          {section.slots.title}
        </h2>
      </div>
    </>
  );
}

// ── Stat band ──────────────────────────────────────────────────────

export function StatBandSection({ section }: SectionProps) {
  const items = section.slots.items ?? [];
  const comparison = section.variant === 'comparison';
  const numericValues = items.map((item) =>
    typeof item.value === 'number' ? item.value : Number.parseFloat(String(item.value ?? '')),
  );
  const maxValue = Math.max(1, ...numericValues.filter((value) => Number.isFinite(value)));

  return (
    <>
      <div className="squisq-page-stats">
        {items.map((item, i) => (
          <div key={i} className={`squisq-page-stat${comparison ? ' squisq-page-stat--bars' : ''}`}>
            <span className="squisq-page-stat-value">{item.value}</span>
            {comparison && Number.isFinite(numericValues[i]) && (
              <div
                className="squisq-page-stat-bar"
                style={{ width: `${Math.max(4, (numericValues[i] / maxValue) * 100)}%` }}
              />
            )}
            {item.title && <span className="squisq-page-stat-title">{item.title}</span>}
            {item.body && <span className="squisq-page-stat-body">{item.body}</span>}
          </div>
        ))}
      </div>
      {section.slots.meta && <div className="squisq-page-stat-meta">{section.slots.meta}</div>}
    </>
  );
}

// ── Quote band ─────────────────────────────────────────────────────

export function QuoteBandSection({ section }: SectionProps) {
  const media = section.slots.media;
  const backdrop = section.background === 'media' && media && media.type !== 'canvas';
  return (
    <>
      {backdrop && (
        <div className="squisq-page-quote-backdrop">
          {media.type === 'image' ? <PageImg media={media} /> : <BackdropVideo media={media} />}
        </div>
      )}
      {section.slots.title && <h2 className="squisq-page-section-title">{section.slots.title}</h2>}
      <figure className="squisq-page-quote-figure" style={{ margin: 0 }}>
        <blockquote className="squisq-page-quote">{section.slots.body?.text}</blockquote>
        {section.slots.attribution && (
          <figcaption className="squisq-page-quote-attribution">
            {section.slots.attribution}
          </figcaption>
        )}
      </figure>
    </>
  );
}

// ── Feature split ──────────────────────────────────────────────────

export function FeatureSplitSection({
  section,
  flip,
}: SectionProps & {
  /** Alternation override from the theme's `alternate` hint. */
  flip?: boolean;
}) {
  const media = section.slots.media;
  const image = media?.type === 'image' ? media : undefined;
  const mediaRight = flip ? section.variant !== 'media-right' : section.variant === 'media-right';
  return (
    <div className={`squisq-page-feature${mediaRight ? ' squisq-page-feature--media-right' : ''}`}>
      <div className="squisq-page-feature-media squisq-page-media-frame">
        {image && <PageImg media={image} />}
        <MediaCredit media={image} />
      </div>
      <div className="squisq-page-feature-text">
        <Eyebrow section={section} />
        {section.slots.title && (
          <h3 className="squisq-page-section-title squisq-page-feature-title">
            {section.slots.title}
          </h3>
        )}
        {section.slots.body?.text && (
          <p className="squisq-page-feature-body">{section.slots.body.text}</p>
        )}
      </div>
    </div>
  );
}

// ── Media figure ───────────────────────────────────────────────────

export function MediaFigureSection({ section }: SectionProps) {
  const { basePath } = usePageView();
  const media = section.slots.media;
  if (!media || media.type === 'canvas') return null;
  return (
    <figure className="squisq-page-figure">
      <div className="squisq-page-media-frame">
        {media.type === 'image' ? (
          <PageImg media={media} />
        ) : (
          <InlineVideoPlayer src={media.src} poster={media.posterSrc} basePath={basePath} />
        )}
      </div>
      {(section.slots.caption || media.credit) && (
        <figcaption>
          {section.slots.caption}
          {media.credit && (
            <>
              {section.slots.caption ? ' ' : ''}
              <MediaCredit media={media} />
            </>
          )}
        </figcaption>
      )}
    </figure>
  );
}

// ── Gallery ────────────────────────────────────────────────────────

export function GallerySection({ section }: SectionProps) {
  const items = section.slots.items ?? [];
  if (items.length === 0) {
    // No images yet — keep the authored heading/body visible instead of an
    // empty band (core fills these fallback slots for imageless galleries).
    return (
      <div className="squisq-page-gallery-empty">
        {section.slots.title && (
          <h2 className="squisq-page-section-title">{section.slots.title}</h2>
        )}
        {section.slots.body?.text && <p>{section.slots.body.text}</p>}
        {section.slots.caption && (
          <div className="squisq-page-gallery-caption">{section.slots.caption}</div>
        )}
      </div>
    );
  }
  return (
    <>
      <div className="squisq-page-gallery">
        {items.map((item, i) =>
          item.media?.type === 'image' ? (
            <div key={i} className="squisq-page-media-frame">
              <PageImg media={item.media} />
            </div>
          ) : null,
        )}
      </div>
      {section.slots.caption && (
        <div className="squisq-page-gallery-caption">{section.slots.caption}</div>
      )}
    </>
  );
}

// ── Callout ────────────────────────────────────────────────────────

export function CalloutSection({ section }: SectionProps) {
  const media = section.slots.media;
  const image = media?.type === 'image' ? media : undefined;
  const framing = section.hints?.framing;
  return (
    <div
      className="squisq-page-callout"
      data-hint-framing={typeof framing === 'string' ? framing : undefined}
    >
      {image && (
        <div className="squisq-page-media-frame">
          <PageImg media={image} />
        </div>
      )}
      <div>
        <Eyebrow section={section} />
        {section.slots.title && (
          <h3 className="squisq-page-callout-title">{section.slots.title}</h3>
        )}
        {section.slots.body?.text && (
          <p className="squisq-page-callout-body">{section.slots.body.text}</p>
        )}
        {section.slots.meta && <div className="squisq-page-callout-meta">{section.slots.meta}</div>}
      </div>
    </div>
  );
}

// ── Card grid ──────────────────────────────────────────────────────

export function CardGridSection({ section }: SectionProps) {
  const { theme } = usePageView();
  const items = section.slots.items ?? [];
  return (
    <>
      {section.slots.title && (
        <h2 className="squisq-page-section-title squisq-page-cards-title">{section.slots.title}</h2>
      )}
      <div className="squisq-page-cards">
        {items.map((item, i) => {
          const scheme = item.accentScheme ? theme.colorSchemes?.[item.accentScheme] : undefined;
          return (
            <div
              key={i}
              className="squisq-page-card"
              style={
                scheme
                  ? ({ '--squisq-page-card-accent': scheme.accent } as CSSProperties)
                  : undefined
              }
            >
              {item.title && <h3 className="squisq-page-card-title">{item.title}</h3>}
              {item.body && <p className="squisq-page-card-body">{item.body}</p>}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ── Item list ──────────────────────────────────────────────────────

export function ItemListSection({ section }: SectionProps) {
  const { theme, showCodeCopyButton, onCopyCode, fenceRenderers, htmlPolicy, linkSchemes } =
    usePageView();
  const items = section.slots.items ?? [];
  return (
    <>
      {section.slots.title && (
        <h2 className="squisq-page-section-title squisq-page-items-title">{section.slots.title}</h2>
      )}
      <ol className="squisq-page-items">
        {items.map((item, i) => (
          <li key={i}>
            {item.markdown ? (
              <MarkdownRenderer
                nodes={item.markdown}
                theme={theme}
                showCodeCopyButton={showCodeCopyButton}
                onCopyCode={onCopyCode}
                fenceRenderers={fenceRenderers}
                htmlPolicy={htmlPolicy}
                linkSchemes={linkSchemes}
              />
            ) : (
              item.body
            )}
          </li>
        ))}
      </ol>
    </>
  );
}

// ── Timeline rail (dateEvent) ──────────────────────────────────────

export function TimelineRailSection({ section }: SectionProps) {
  const milestone = section.slots.milestone;
  if (!milestone) return null;
  return (
    <div className="squisq-page-milestone" data-mood={milestone.mood}>
      <div className="squisq-page-milestone-date">{milestone.date}</div>
      <div className="squisq-page-milestone-rail" aria-hidden="true" />
      <div className="squisq-page-milestone-body">
        {milestone.description}
        {milestone.footer && <div className="squisq-page-milestone-footer">{milestone.footer}</div>}
      </div>
    </div>
  );
}

// ── Table section ──────────────────────────────────────────────────

export function TableSection({ section }: SectionProps) {
  const table = section.slots.table;
  if (!table) return null;
  const alignFor = (i: number): 'left' | 'right' | 'center' | undefined =>
    table.align?.[i] ?? undefined;
  return (
    <>
      {section.slots.title && (
        <h2 className="squisq-page-section-title squisq-page-table-title">{section.slots.title}</h2>
      )}
      <div className="squisq-page-table-scroll">
        <table className="squisq-page-table">
          <thead>
            <tr>
              {table.headers.map((header, i) => (
                <th key={i} style={{ textAlign: alignFor(i) }}>
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} style={{ textAlign: alignFor(c) }}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── Prose ──────────────────────────────────────────────────────────

export function ProseSection({ section, block }: SectionProps) {
  const { theme, showCodeCopyButton, onCopyCode, fenceRenderers, htmlPolicy, linkSchemes } =
    usePageView();
  // The title slot may be deliberately suppressed (e.g. cover dedupe), so
  // gate the heading on it rather than on the source heading alone.
  const heading: ReactNode =
    section.slots.title !== undefined && block?.sourceHeading ? (
      <MarkdownRenderer
        nodes={[block.sourceHeading]}
        theme={theme}
        showCodeCopyButton={showCodeCopyButton}
        onCopyCode={onCopyCode}
        htmlPolicy={htmlPolicy}
        linkSchemes={linkSchemes}
      />
    ) : null;
  const bodyNodes = section.slots.body?.markdown ?? block?.contents;
  return (
    <div className="squisq-page-prose">
      {heading}
      {bodyNodes && bodyNodes.length > 0 && (
        <MarkdownRenderer
          nodes={bodyNodes}
          theme={theme}
          showCodeCopyButton={showCodeCopyButton}
          onCopyCode={onCopyCode}
          fenceRenderers={fenceRenderers}
          htmlPolicy={htmlPolicy}
          linkSchemes={linkSchemes}
        />
      )}
    </div>
  );
}

// ── Footer band ────────────────────────────────────────────────────

export function FooterSection({ section }: SectionProps) {
  return (
    <div>
      <Eyebrow section={section} />
      {section.slots.title && <h2 className="squisq-page-section-title">{section.slots.title}</h2>}
      {section.slots.body?.text && <p>{section.slots.body.text}</p>}
    </div>
  );
}
