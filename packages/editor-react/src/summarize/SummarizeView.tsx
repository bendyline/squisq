/**
 * SummarizeView — the Write tab's Summarize mode.
 *
 * Where an author chooses how the slideshow and video summarize the document:
 * None, one of the built-in styles, or Custom (core's `dynamic-slides`). The
 * choice is the document's `squisq-transform`, written through the preview
 * settings exactly as the Use toolbar's old Summarize dropdown wrote it.
 *
 * Below the choice sits what that choice makes. For Custom, that is the host's
 * designer when it supplies one (`EditorShell`'s `summarizationDesigner`), where
 * the author adjusts each slide; otherwise it is the deck the style produces,
 * drawn through the same projection the slideshow plays.
 *
 * The shell keeps this view mounted, hidden, while Use is open — as it keeps
 * the editors — so a designer's work in progress survives a look at the deck.
 */
import { useId, useMemo, type CSSProperties, type ReactNode } from 'react';
import type { ContentContainer } from '@bendyline/squisq/storage';
import { expandDocBlocks } from '@bendyline/squisq/doc';
import { BlockRenderer } from '@bendyline/squisq-react';
import { useEditorContext } from '../EditorContext';
import { usePreviewSettings } from '../PreviewControls';
import { usePreviewProjection } from '../usePreviewProjection';
import { documentTitleFromFileName } from '../buildPreviewDoc';
import { templateLabel } from '../TemplatePicker';
import { CUSTOM_SUMMARY_STYLE, SUMMARY_STYLE_OPTIONS } from './summaryStyles';

export interface SummarizeViewProps {
  /** The host's designer for the Custom style. Without one, Custom shows its slides. */
  designer?: ReactNode;
  /** Base path for resolving media URLs in the slide previews. */
  basePath: string;
  workspaceContainer?: ContentContainer | null;
  readOnly: boolean;
  /** Hidden (but mounted) while the Use view is open. */
  hidden: boolean;
}

export function SummarizeView({
  designer,
  basePath,
  workspaceContainer,
  readOnly,
  hidden,
}: SummarizeViewProps) {
  const { activeTransformStyle, setSelectedTransformStyle } = usePreviewSettings();
  const groupId = useId();
  const designing = activeTransformStyle === CUSTOM_SUMMARY_STYLE && !!designer;
  return (
    <section
      className="squisq-summarize"
      aria-label="Summarize"
      hidden={hidden}
      style={hidden ? { display: 'none' } : undefined}
      data-designing={designing ? 'true' : undefined}
    >
      <div className="squisq-summarize-inner">
        <header className="squisq-summarize-header">
          <h2 className="squisq-summarize-title">Summarize for slides and video</h2>
          <p className="squisq-summarize-intro">
            Choose how your text becomes slides when it plays as a slideshow or video. Your document
            text and narration are not changed.
          </p>
        </header>
        <fieldset className="squisq-summarize-styles" disabled={readOnly}>
          <legend className="squisq-summarize-legend">Summary style</legend>
          <div className="squisq-summarize-style-list">
            {SUMMARY_STYLE_OPTIONS.map((option) => {
              const selected = option.id === activeTransformStyle;
              const nameId = `${groupId}-${option.id || 'none'}-name`;
              const descriptionId = `${groupId}-${option.id || 'none'}-description`;
              return (
                <label
                  key={option.id || 'none'}
                  className={`squisq-summarize-style${selected ? ' squisq-summarize-style--selected' : ''}`}
                  data-style={option.id || 'none'}
                >
                  <input
                    type="radio"
                    name={groupId}
                    value={option.id}
                    checked={selected}
                    aria-labelledby={nameId}
                    aria-describedby={descriptionId}
                    onChange={() => setSelectedTransformStyle(option.id)}
                  />
                  <span className="squisq-summarize-style-copy">
                    <span id={nameId} className="squisq-summarize-style-name">
                      {option.name}
                    </span>
                    <span id={descriptionId} className="squisq-summarize-style-description">
                      {option.description}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
        <div className="squisq-summarize-body">
          {designing ? (
            designer
          ) : (
            <SummarySlides
              transformStyle={activeTransformStyle}
              basePath={basePath}
              workspaceContainer={workspaceContainer}
              active={!hidden}
            />
          )}
        </div>
      </div>
    </section>
  );
}

/** The deck the chosen style makes, one card per slide, as the slideshow draws it. */
function SummarySlides({
  transformStyle,
  basePath,
  workspaceContainer,
  active,
}: {
  transformStyle: string;
  basePath: string;
  workspaceContainer?: ContentContainer | null;
  active: boolean;
}) {
  const { doc, fileName, mediaRevision } = useEditorContext();
  const { activeTheme, activeViewport } = usePreviewSettings();
  // Idle while hidden behind Use, which runs its own projection.
  const projection = usePreviewProjection(
    active ? doc : null,
    transformStyle,
    workspaceContainer,
    documentTitleFromFileName(fileName),
    mediaRevision,
  );
  const playerDoc = projection?.playerDoc;
  const slides = useMemo(() => {
    if (!playerDoc) return [];
    try {
      // A discrete deck: one card per slide, none split or merged for pacing.
      return expandDocBlocks(playerDoc.blocks, {
        theme: activeTheme,
        viewport: activeViewport,
        audioSegments: playerDoc.audio.segments,
        customTemplates: playerDoc.customTemplates,
        splitLongBlocks: false,
        mergeShortBlocks: false,
      });
    } catch {
      return [];
    }
  }, [playerDoc, activeTheme, activeViewport]);
  const problem = projection?.contentDoc.diagnostics?.find(
    (diagnostic) => diagnostic.code === 'presentation-invalid',
  )?.message;

  if (!doc || doc.blocks.length === 0) {
    return <p className="squisq-summarize-empty">Add some text to see its slides.</p>;
  }
  if (!projection) {
    return (
      <p className="squisq-summarize-empty" role="status">
        Preparing slides…
      </p>
    );
  }
  const frameStyle: CSSProperties = {
    aspectRatio: `${activeViewport.width} / ${activeViewport.height}`,
  };
  return (
    <>
      <p className="squisq-summarize-count" role="status" aria-live="polite">
        {slides.length === 1 ? '1 slide' : `${slides.length} slides`}
      </p>
      {problem && (
        <p className="squisq-summarize-problem" role="alert">
          {problem}
        </p>
      )}
      <ol className="squisq-summarize-slides" aria-label="Slides">
        {slides.map((slide, index) => {
          const title = slide.title?.trim();
          return (
            <li key={`${slide.id}-${index}`} className="squisq-summarize-slide">
              <div
                className="squisq-summarize-slide-frame"
                style={frameStyle}
                role="img"
                aria-label={`Slide ${index + 1}${title ? `: ${title}` : ''}`}
              >
                <BlockRenderer
                  block={slide}
                  buildPlayback="all"
                  blockTime={0}
                  animationsEnabled={false}
                  basePath={basePath}
                  viewport={activeViewport}
                  theme={activeTheme}
                />
              </div>
              <span className="squisq-summarize-slide-label" aria-hidden="true">
                <span className="squisq-summarize-slide-number">{index + 1}</span>
                {slide.template ? templateLabel(slide.template, playerDoc?.customTemplates) : ''}
              </span>
            </li>
          );
        })}
      </ol>
    </>
  );
}
