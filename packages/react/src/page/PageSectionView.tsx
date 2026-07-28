/**
 * PageSectionView — dispatches one `PageSection` (from core
 * `materializePageSections`) to its HTML section component, and emits the
 * shared `<section>` chrome: kind/background/emphasis/variant classes,
 * data attributes (including the legacy `.squisq-linear-section` hook that
 * hosts and the editor's scroll-sync rely on), and the per-section accent
 * custom properties.
 */

import type { CSSProperties, ReactNode } from 'react';
import type { PageSection, PageSectionMaterialization } from '@bendyline/squisq/doc';
import { usePageView } from './PageViewContext';
import { CanvasSection } from './CanvasSection';
import { MarkdownRenderer } from '../MarkdownRenderer';
import {
  BannerSection,
  CalloutSection,
  CardGridSection,
  FeatureSplitSection,
  FooterSection,
  GallerySection,
  HeroSection,
  ItemListSection,
  MediaFigureSection,
  ProseSection,
  QuoteBandSection,
  StatBandSection,
  TableSection,
  TimelineRailSection,
} from './sections';

/** True when the hero renders its media as a full-bleed backdrop. */
function heroHasBackdrop(section: PageSection, heroStyle: string): boolean {
  return (
    section.kind === 'hero' &&
    section.background === 'media' &&
    section.slots.media?.type === 'image' &&
    heroStyle !== 'split'
  );
}

export interface PageSectionViewProps {
  entry: PageSectionMaterialization;
  /** Alternation flip for feature-split sections (theme `alternate` hint). */
  featureFlip?: boolean;
  /** True when this is the doc's lead prose section (drop-cap target). */
  isLeadProse?: boolean;
}

/** Per-section accent custom properties from the resolved color scheme. */
function accentVars(section: PageSection): CSSProperties | undefined {
  const scheme = section.accent.scheme;
  if (!scheme) return undefined;
  return {
    '--squisq-page-accent': scheme.accent,
    '--squisq-page-accent-bg': scheme.bg,
    '--squisq-page-accent-text': scheme.text,
  } as CSSProperties;
}

function sectionBody(
  entry: PageSectionMaterialization,
  featureFlip: boolean | undefined,
): ReactNode {
  const { section, block } = entry;
  switch (section.kind) {
    case 'hero':
      return <HeroSection section={section} block={block} />;
    case 'banner':
      return <BannerSection section={section} block={block} />;
    case 'stat-band':
      return <StatBandSection section={section} block={block} />;
    case 'quote-band':
      return <QuoteBandSection section={section} block={block} />;
    case 'feature-split':
      return <FeatureSplitSection section={section} block={block} flip={featureFlip} />;
    case 'media-figure':
      return <MediaFigureSection section={section} block={block} />;
    case 'gallery':
      return <GallerySection section={section} block={block} />;
    case 'callout':
      return <CalloutSection section={section} block={block} />;
    case 'card-grid':
      return <CardGridSection section={section} block={block} />;
    case 'item-list':
      return <ItemListSection section={section} block={block} />;
    case 'timeline-rail':
      return <TimelineRailSection section={section} block={block} />;
    case 'table-section':
      return <TableSection section={section} block={block} />;
    case 'canvas-embed':
      return <CanvasSection section={section} />;
    case 'footer':
      return <FooterSection section={section} block={block} />;
    case 'prose':
    default:
      return <ProseSection section={section} block={block} />;
  }
}

export function PageSectionView({ entry, featureFlip, isLeadProse }: PageSectionViewProps) {
  const { pageStyle, theme, showCodeCopyButton, onCopyCode } = usePageView();
  const { section } = entry;
  const richContent = section.slots.richContent?.markdown;

  const classes = [
    'squisq-linear-section',
    'squisq-page-section',
    `squisq-page-section--${section.kind}`,
    `squisq-page-section--bg-${section.background}`,
    `squisq-page-section--em-${section.emphasis}`,
  ];
  if (section.variant) classes.push(`squisq-page-section--v-${section.variant}`);
  if (heroHasBackdrop(section, pageStyle.tokens.heroStyle)) {
    classes.push('squisq-page-section--hero-media');
  }

  const hintAttrs: Record<string, string> = {};
  if (section.hints?.vignette) hintAttrs['data-hint-vignette'] = '';
  if (section.hints?.dropCap && isLeadProse) hintAttrs['data-hint-drop-cap'] = '';

  return (
    <section
      className={classes.join(' ')}
      data-section-kind={section.kind}
      data-block-id={section.blockId}
      data-block-index={section.index}
      data-template={section.template}
      style={accentVars(section)}
      {...hintAttrs}
    >
      <div className="squisq-page-section-inner">
        {sectionBody(entry, featureFlip)}
        {richContent && richContent.length > 0 && (
          <div className="squisq-page-rich-content">
            <MarkdownRenderer
              nodes={richContent}
              theme={theme}
              showCodeCopyButton={showCodeCopyButton}
              onCopyCode={onCopyCode}
            />
          </div>
        )}
      </div>
    </section>
  );
}
