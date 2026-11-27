/**
 * SummarizeView — the Summaries view (View menu › Edit › Summaries).
 *
 * Where an author chooses how the slideshow and video summarize the document:
 * None, Custom (core's `dynamic-slides`), or one of the built-in styles, from
 * the Summary style dropdown. The choice is the document's `squisq-transform`,
 * written through the preview settings exactly as the Use toolbar's old
 * Summarize dropdown wrote it.
 *
 * The choice heads one row of controls. For Custom, the built-in designer's
 * own controls (the summary length, supporting slides, Reset design, Suggest
 * with AI) join it there, through a slot the designer fills, so the choices
 * that shape the deck sit on one line above it. The row wraps in a narrow
 * panel.
 *
 * Below the row sits what the choice makes. For a built-in style, that is
 * the deck the style produces, drawn through the same projection the slideshow
 * plays. For Custom, it is the designer, where the author picks a slide and
 * changes its layout and wording, hides it, or — when the host lends an AI
 * `SummarizationAssistant` — asks for suggestions. A host may replace the
 * designer outright (`EditorShell`'s `summarizationDesigner`).
 *
 * The shell keeps this view mounted, hidden, while Use is open — as it keeps
 * the editors — so a designer's work in progress survives a look at the deck.
 */
import {
  lazy,
  Suspense,
  useId,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type { ContentContainer } from '@bendyline/squisq/storage';
import type { Block, Doc } from '@bendyline/squisq/schemas';
import { expandDocBlocks } from '@bendyline/squisq/doc';
import { BlockRenderer } from '@bendyline/squisq-react';
import { useEditorContext } from '../EditorContext';
import { usePreviewSettings } from '../PreviewControls';
import { usePreviewProjection } from '../usePreviewProjection';
import { documentTitleFromFileName } from '../buildPreviewDoc';
import { templateLabel } from '../TemplatePicker';
import { CUSTOM_SUMMARY_STYLE, SUMMARY_STYLE_OPTIONS } from './summaryStyles';
import { SummaryStylePicker } from './SummaryStylePicker';
import type { SummarizationAssistant } from './summarizationAssistant';

// Loaded the first time Custom is open: most visits to Summarize never design.
const SummaryDesigner = lazy(() =>
  import('./SummaryDesigner').then((module) => ({ default: module.SummaryDesigner })),
);

export interface SummarizeViewProps {
  /** Replaces the built-in Custom designer. */
  designer?: ReactNode;
  /** The host's AI for the built-in designer's "Suggest with AI". */
  assistant?: SummarizationAssistant;
  /** Base path for resolving media URLs in the slide previews. */
  basePath: string;
  workspaceContainer?: ContentContainer | null;
  readOnly: boolean;
  /** Hidden (but mounted) while the Use view is open. */
  hidden: boolean;
}

export function SummarizeView({
  designer,
  assistant,
  basePath,
  workspaceContainer,
  readOnly,
  hidden,
}: SummarizeViewProps) {
  const { activeTransformStyle, setSelectedTransformStyle } = usePreviewSettings();
  const designing = activeTransformStyle === CUSTOM_SUMMARY_STYLE;
  // The built-in designer puts its controls on the style's row; a host's own
  // designer keeps to the body, under a row that holds the style alone.
  const builtIn = designing && !designer;
  const [controlsSlot, setControlsSlot] = useState<HTMLElement | null>(null);
  return (
    <section
      className="squisq-summarize"
      aria-label="Summaries"
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
        {/* With the built-in designer, the row and the body are the designer:
            its controls are on the row, its slides in the body. */}
        <div
          className="squisq-summarize-main"
          {...(builtIn ? { role: 'region', 'aria-label': 'Summarization designer' } : {})}
        >
          <div className="squisq-summarize-controls">
            <SummaryStylePicker
              value={activeTransformStyle}
              options={SUMMARY_STYLE_OPTIONS}
              onChange={setSelectedTransformStyle}
              disabled={readOnly}
              showDescription={!builtIn}
            />
            {builtIn && (
              <div
                ref={setControlsSlot}
                className="squisq-summarize-controls-slot squisq-summary-designer-bar"
              />
            )}
          </div>
          <div className="squisq-summarize-body">
            {designing ? (
              (designer ?? (
                <Suspense
                  fallback={
                    <p className="squisq-summarize-empty" role="status">
                      Preparing slides…
                    </p>
                  }
                >
                  <SummaryDesigner
                    assistant={assistant}
                    readOnly={readOnly}
                    basePath={basePath}
                    controlsSlot={controlsSlot}
                  />
                </Suspense>
              ))
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
      </div>
    </section>
  );
}

/** A run of consecutive slides made from one block of the document, or added. */
interface SlideGroup {
  key: string;
  name: string;
  first: number;
  slides: Block[];
}

/** Each block's heading by id, nested blocks included. */
function blockNames(doc: Doc): Map<string, string> {
  const names = new Map<string, string>();
  const visit = (blocks: readonly Block[]) => {
    for (const block of blocks) {
      // A heading-less block holds the text before the first heading.
      names.set(block.id, block.title?.trim() || 'Text before the first heading');
      if (block.children?.length) visit(block.children);
    }
  };
  visit(doc.blocks);
  return names;
}

/**
 * Groups a style's slides by the block of the document each was made from: a
 * slide a style derived carries its block as `sourceBlockId`, and one shown as
 * written is the block itself. The rest were added around the text (a style's
 * opening and closing title slides, and pictures spread through the deck), and
 * are named for what they are.
 */
function groupSlides(slides: readonly Block[], doc: Doc): SlideGroup[] {
  const names = blockNames(doc);
  const groups: SlideGroup[] = [];
  slides.forEach((slide, index) => {
    const source = slide.sourceBlockId ?? slide.id;
    const name =
      names.get(source) ??
      (slide.template === 'imageWithCaption'
        ? 'Picture from your document'
        : slide.template === 'title' || slide.template === 'sectionHeader'
          ? 'Document title'
          : 'Added slide');
    const key = names.has(source) ? source : `added:${name}`;
    const last = groups[groups.length - 1];
    if (last?.key === key) last.slides.push(slide);
    else groups.push({ key, name, first: index, slides: [slide] });
  });
  return groups;
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
  const groups = useMemo(() => (doc ? groupSlides(slides, doc) : []), [slides, doc]);
  const groupId = useId();
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
      {/* Each block of the document beside the slides the style made from it. */}
      <div className="squisq-summarize-deck" role="group" aria-label="Slides">
        {groups.map((group, groupIndex) => {
          const labelId = `${groupId}-${groupIndex}`;
          const count = group.slides.length;
          return (
            <div
              key={`${group.key}-${group.first}`}
              className="squisq-summarize-group"
              role="group"
              aria-labelledby={labelId}
              data-added={group.key.startsWith('added:') ? 'true' : undefined}
            >
              <div id={labelId} className="squisq-summarize-group-source">
                <span className="squisq-summarize-group-name">{group.name}</span>{' '}
                <small>{count === 1 ? '1 slide' : `${count} slides`}</small>
              </div>
              <ol className="squisq-summarize-slides" start={group.first + 1}>
                {group.slides.map((slide, offset) => {
                  const index = group.first + offset;
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
                        {slide.template
                          ? templateLabel(slide.template, playerDoc?.customTemplates)
                          : ''}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          );
        })}
      </div>
    </>
  );
}
