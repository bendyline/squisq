/**
 * SummaryDesigner — the Custom summary style's designer, shown in Write ›
 * Summarize while Custom (core's `dynamic-slides`) is chosen.
 *
 * Custom slides are generated from the document's current text on every
 * projection. What persists is the author's INTENT, in
 * `squisq-presentation-hints`: how dense the slides are, a layout per section,
 * slides to hide, and wording for a section's opening slide — each keyed to
 * the exact passage it was written for, so changing the text returns that
 * slide to an automatic summary rather than showing stale words. Generated
 * slides are never saved.
 *
 * Summarize is a mode the author can leave at any moment, so each change is
 * written as it is made. The Write editor stays mounted behind the view, so
 * each write is a step Write can undo, and an undo there flows back here.
 *
 * AI is optional: a host that lends a `SummarizationAssistant` gets "Suggest
 * with AI", which words and lays out the slides one at a time, each suggestion
 * saved with the passage it summarizes.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { BlockRenderer, MediaContext } from '@bendyline/squisq-react';
import {
  markdownToDoc,
  resolveAudioMapping,
  buildPreviewDoc,
  expandDocBlocks,
  flattenRenderableBlocks,
  getPinnedBlockMeta,
  previewBlockTemplate,
  PRESENTATION_LAYOUT_LABELS,
} from '@bendyline/squisq/doc';
import { parseMarkdown, setFrontmatterValues } from '@bendyline/squisq/markdown';
import { VIEWPORT_PRESETS, type Doc } from '@bendyline/squisq/schemas';
import {
  compilePresentationPlan,
  createPresentationPlan,
  defaultPresentationHints,
  parsePresentationHints,
  serializePresentationHints,
  presentationSections,
  PRESENTATION_HINTS_KEY,
  PRESENTATION_LAYOUTS,
  AUTHORED_PRESENTATION_LAYOUT,
  presentationBeatExtras,
  presentationLayoutNeeds,
  presentationPassageKey,
  type PresentationHints,
  type PresentationBlockHint,
  type PresentationBeat,
  type PresentationBeatLayout,
} from '@bendyline/squisq/transform';
import { useEditorContext } from '../EditorContext';
import { usePreviewSettingsOptional } from '../PreviewControls';
import { templateLabel } from '../TemplatePicker';
import { setBlockDurationInSource, setBlockStartTimeInSource } from '../timelineSource';
import { Icon } from '../Icon';
import type { SummarizationAssistant } from './summarizationAssistant';

/** What a layout is called in the designer. Squisq names its own layouts
 * (`PRESENTATION_LAYOUT_LABELS`), so one it adds is named here without a change. */
function summaryLayoutLabel(layout: string): string {
  return (
    (PRESENTATION_LAYOUT_LABELS as Record<string, { label: string } | undefined>)[layout]?.label ??
    layout
  );
}
/** What a chosen layout shows, and which slides it can apply to: Squisq's
 * description of the layout, then what a slide needs for it to apply. */
function layoutHelp(layout: PresentationBeatLayout): string {
  if (layout === AUTHORED_PRESENTATION_LAYOUT)
    return 'Shows this section as written, as one slide for its whole narration. To change its block type, use the block picker in the editor.';
  const described = (
    PRESENTATION_LAYOUT_LABELS as Record<string, { description: string } | undefined>
  )[layout]?.description;
  const needs = presentationLayoutNeeds(layout, { points: 'highlights' });
  return [described, needs ? `Used on slides with ${needs}.` : ''].filter(Boolean).join(' ');
}

type Sections = ReturnType<typeof presentationSections>;
/** Where a suggestion run stands; `active` is the slide a request is open for. */
interface SuggestionProgress {
  done: number;
  total: number;
  active: { sourceStart: number; sourceEnd: number } | null;
  /** The deck's layouts are being planned together; no slide has been asked for yet. */
  planning: boolean;
}
function sectionAt(sections: Sections, offset: number) {
  return sections.find((item) => offset >= item.sourceStart && offset < item.sourceEnd);
}
/** Store one accepted suggestion keyed to the exact passage it summarizes, so
 * Squisq reapplies it only while that passage is unchanged. */
function withSuggestion(
  current: PresentationHints,
  sections: Sections,
  sourceText: string,
  item: PresentationBeat,
): PresentationHints {
  const parent = sectionAt(sections, item.sourceStart);
  if (!parent || item.layout === AUTHORED_PRESENTATION_LAYOUT) return current;
  const source = sourceText.slice(item.sourceStart, item.sourceEnd);
  const existing = current.blocks.find((block) => block.blockId === parent.blockId);
  const target: PresentationBlockHint = {
    ...(existing ?? { blockId: parent.blockId }),
    ai: [
      ...(existing?.ai ?? []).filter((entry) => entry.source !== source),
      {
        source,
        layout: item.layout,
        headline: item.headline,
        points: [...item.points],
        // A hub's centre and a matrix's axes are part of the suggestion.
        ...presentationBeatExtras(item.layout, item),
      },
    ].slice(-80),
  };
  return {
    ...current,
    blocks: [...current.blocks.filter((block) => block.blockId !== parent.blockId), target],
  };
}

/** A design as the designer writes it: canonical JSON, or null when it is not valid. */
function hintsJson(hints: PresentationHints): string | null {
  try {
    return serializePresentationHints(hints);
  } catch {
    return null;
  }
}
const EMPTY_HINTS = defaultPresentationHints();
const DEFAULT_HINTS_JSON = hintsJson(EMPTY_HINTS)!;
/** The design the document holds. No key is the default design, and so is an
 * unreadable one, which the first change then replaces. */
function storedHints(markdown: string): string {
  const raw = parseMarkdown(markdown).frontmatter?.[PRESENTATION_HINTS_KEY];
  const hints = raw === undefined ? null : parsePresentationHints(raw);
  return (hints && hintsJson(hints)) ?? DEFAULT_HINTS_JSON;
}
/** The AI wording a design holds, as text, for a host's report control. */
function suggestionsText(hints: PresentationHints): string {
  return hints.blocks
    .flatMap((block) => block.ai ?? [])
    .map((entry) => [entry.headline, ...entry.points.map((point) => `- ${point}`)].join('\n'))
    .join('\n\n');
}

/** The assistant's readiness: undefined while checking, null when ready, else why not. */
function useAssistantReadiness(assistant?: SummarizationAssistant): string | null | undefined {
  const [reason, setReason] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!assistant) return;
    let live = true;
    setReason(undefined);
    const read = () => {
      Promise.resolve()
        .then(() => assistant.readiness())
        .then(
          (next) => {
            if (live) setReason(next);
          },
          (cause: unknown) => {
            if (live) setReason(cause instanceof Error ? cause.message : String(cause));
          },
        );
    };
    read();
    const stop = assistant.onReadinessChange?.(read);
    return () => {
      live = false;
      stop?.();
    };
  }, [assistant]);
  return reason;
}

export interface SummaryDesignerProps {
  /** The host's AI, for "Suggest with AI". Without one the designer has no AI. */
  assistant?: SummarizationAssistant;
  /** Shows the design without letting it change. */
  readOnly?: boolean;
  /** Base path for resolving media URLs in the slide preview. */
  basePath?: string;
}

export function SummaryDesigner({
  assistant,
  readOnly = false,
  basePath = '/',
}: SummaryDesignerProps) {
  const { workspaceContainer, markdownSource, replaceAll, mediaProvider } = useEditorContext();
  const preview = usePreviewSettingsOptional();
  const viewport = preview?.activeViewport ?? VIEWPORT_PRESETS.landscape;
  const originalTextId = useId();
  const layoutHelpId = useId();
  const slidePickerId = useId();
  const readiness = useAssistantReadiness(assistant);

  // ── The design, saved as it changes ─────────────────────────────────
  const stored = useMemo(() => storedHints(markdownSource), [markdownSource]);
  const storedRef = useRef(stored);
  storedRef.current = stored;
  const sourceRef = useRef(markdownSource);
  sourceRef.current = markdownSource;
  const [hints, setHints] = useState<PresentationHints>(() => parsePresentationHints(stored)!);
  const [error, setError] = useState<string | null>(null);
  /** Designs written but not yet read back from the document, oldest first. */
  const pending = useRef<string[]>([]);
  // Save each change as it is made. Reads the document through refs: when the
  // design changes because the document did (below), there is nothing to save.
  useEffect(() => {
    const json = hintsJson(hints);
    if (json === null) {
      setError('The slide design is too large to save. Reset the design or hide fewer slides.');
      return;
    }
    if (json === storedRef.current) return;
    try {
      // The default design is no design: leave no key behind.
      const value = json === DEFAULT_HINTS_JSON ? null : json;
      replaceAll(setFrontmatterValues(sourceRef.current, { [PRESENTATION_HINTS_KEY]: value }));
      pending.current.push(json);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [hints, replaceAll]);
  // Follow the document when it changes the design itself: an undo in Write, or
  // an edit in Source. Each design this view wrote is skipped as it reads back.
  useEffect(() => {
    const ours = pending.current.indexOf(stored);
    if (ours >= 0) {
      pending.current.splice(0, ours + 1);
      return;
    }
    pending.current = [];
    setHints((current) =>
      hintsJson(current) === stored ? current : parsePresentationHints(stored)!,
    );
  }, [stored]);

  // One slide per section never adds supporting slides, so their controls rest.
  const perSection = hints.density === 'section';
  const [loaded, setLoaded] = useState<{ doc: Doc; source: string } | null>(null);
  const [selectedSourceStart, setSelectedSourceStart] = useState(0);
  const [notice, setNotice] = useState('');
  const [progress, setProgress] = useState<SuggestionProgress | null>(null);
  const controller = useRef<AbortController | null>(null);
  /** Show each slide as it is suggested until the person picks one themselves. */
  const follow = useRef(false);
  const suggestButton = useRef<HTMLButtonElement>(null);
  const stopButton = useRef<HTMLButtonElement>(null);
  const slidesRef = useRef<HTMLElement>(null);
  useEffect(() => {
    let disposed = false;
    const parsed = markdownToDoc(parseMarkdown(markdownSource));
    const load = workspaceContainer
      ? resolveAudioMapping(parsed, workspaceContainer)
      : Promise.resolve(parsed);
    void load
      .then((doc) => {
        if (!disposed) setLoaded({ doc, source: markdownSource });
      })
      .catch((cause: unknown) => {
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      disposed = true;
    };
  }, [markdownSource, workspaceContainer]);
  // Each saved change rewrites the document, so a run of suggestions outlives
  // many loads; only leaving the designer stops it.
  useEffect(() => () => controller.current?.abort(), []);
  const running = progress !== null;
  const locked = running || readOnly;
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current === running) return;
    wasRunning.current = running;
    // The Suggest button leaves for the run and Stop takes its place; keep
    // keyboard focus with them instead of dropping it on the page.
    if (document.activeElement === null || document.activeElement === document.body)
      (running ? stopButton.current : suggestButton.current)?.focus();
  }, [running]);

  // Every saved change reloads the document. Keep showing the last one until
  // the reload lands, rather than blanking the slides on each change.
  const doc = loaded?.doc ?? null;
  const current = loaded?.source === markdownSource;
  const generated = useMemo(() => {
    if (!doc) return null;
    try {
      return { plan: createPresentationPlan(doc, hints), error: null };
    } catch (cause: unknown) {
      return { plan: null, error: cause instanceof Error ? cause.message : String(cause) };
    }
  }, [doc, hints]);
  const plan = generated?.plan;
  const sections = useMemo(() => (doc ? presentationSections(doc) : []), [doc]);
  const projection = useMemo(() => {
    if (!doc || !plan) return null;
    // A hidden slide still previews, so it can be judged and shown again; the
    // deck itself leaves it out.
    const every = { ...plan, beats: plan.beats.map(({ hidden: _hidden, ...beat }) => beat) };
    // Through the deck's own slide projection, so an authored section previews
    // with the template and content the slideshow and video will use.
    const expand = (projected: Doc) => {
      const slides = buildPreviewDoc(projected);
      return expandDocBlocks(slides.blocks, {
        theme: preview?.activeTheme,
        viewport,
        audioSegments: slides.audio.segments,
        customTemplates: projected.customTemplates,
      });
    };
    try {
      const projected = compilePresentationPlan(doc, every);
      return { doc: projected, blocks: expand(projected), error: null };
    } catch (cause: unknown) {
      // A narration problem must not blank the slides: preview them at reading
      // pace while the alert explains what stops them following the narration.
      let blocks: ReturnType<typeof expand> = [];
      try {
        const untimed: Doc = {
          ...doc,
          presentationNarration: undefined,
          documentMedia: doc.documentMedia?.filter((clip) => clip.anchor !== 'document'),
        };
        blocks = expand(compilePresentationPlan(untimed, every));
      } catch {
        // The plan itself no longer fits the document; the alert says so.
      }
      return {
        doc: null,
        blocks,
        error: cause instanceof Error ? cause.message : String(cause),
      };
    }
  }, [doc, plan, preview?.activeTheme, viewport]);
  // Pinned section times stop a deck from following its narration, and they
  // are invisible in Write view, so the alert offers to remove them.
  const pinnedLines = useMemo(
    () =>
      doc?.presentationNarration
        ? flattenRenderableBlocks(doc.blocks).flatMap((block) => {
            const pin = getPinnedBlockMeta(block);
            const line = block.sourceHeading?.position?.start.line;
            return line !== undefined && (pin.duration !== undefined || pin.startTime !== undefined)
              ? [line]
              : [];
          })
        : [],
    [doc],
  );
  const removePins = () => {
    let next = markdownSource;
    for (const line of pinnedLines) {
      next = setBlockDurationInSource(next, line, null) ?? next;
      next = setBlockStartTimeInSource(next, line, null) ?? next;
    }
    if (next !== markdownSource) replaceAll(next);
  };
  // Stored AI wording per section, keyed by the passage it summarizes. Squisq
  // applies an entry only while its passage is unchanged, so this is also what
  // marks a slide in the list as AI-suggested.
  const aiEntries = useMemo(() => {
    const entries = new Map<string, Map<string, PresentationBeat['layout']>>();
    for (const block of hints.blocks)
      entries.set(
        block.blockId,
        new Map((block.ai ?? []).map((entry) => [entry.source, entry.layout])),
      );
    return entries;
  }, [hints]);
  // Names the block type each section renders with when shown as authored.
  const authoredLabels = useMemo(() => {
    const labels = new Map<string, string>();
    if (!doc) return labels;
    for (const block of flattenRenderableBlocks(doc.blocks))
      labels.set(
        block.id,
        `As authored (${templateLabel(previewBlockTemplate(block, doc), doc.customTemplates)})`,
      );
    return labels;
  }, [doc]);
  const layoutLabel = (layout: PresentationBeatLayout, blockId: string | undefined) =>
    layout === AUTHORED_PRESENTATION_LAYOUT
      ? (authoredLabels.get(blockId ?? '') ?? 'As authored')
      : summaryLayoutLabel(layout);
  // Layout changes can split or merge slides. Follow the source passage rather
  // than a slide number, which could now belong to a different section.
  const selectedIndex = Math.max(
    0,
    plan?.beats.findIndex(
      (item) => selectedSourceStart >= item.sourceStart && selectedSourceStart < item.sourceEnd,
    ) ?? -1,
  );
  const beat = plan?.beats[selectedIndex];
  const section = beat && sectionAt(sections, beat.sourceStart);
  const hint = hints.blocks.find((item) => item.blockId === section?.blockId);
  const visual = projection?.blocks.find((block) => block.id === beat?.id);
  // What the slide list and the small-panel picker both say about each slide.
  const slideTags = !plan
    ? []
    : plan.beats.map((item) => {
        const owner = sectionAt(sections, item.sourceStart);
        const layout =
          owner &&
          aiEntries
            .get(owner.blockId)
            ?.get(plan.sourceText.slice(item.sourceStart, item.sourceEnd));
        const active = progress?.active;
        return {
          layout: layoutLabel(item.layout, owner?.blockId),
          suggested:
            item.layout !== AUTHORED_PRESENTATION_LAYOUT &&
            layout !== undefined &&
            (layout !== 'image' || !!item.imageSrc),
          pending:
            !!active &&
            active.sourceStart === item.sourceStart &&
            active.sourceEnd === item.sourceEnd,
        };
      });
  /** Select a slide by position; the person chose it, so stop following the AI run. */
  const selectSlide = (index: number) => {
    const next = plan?.beats[Math.max(0, Math.min(plan.beats.length - 1, index))];
    if (!next) return;
    follow.current = false;
    setSelectedSourceStart(next.sourceStart);
  };
  const handleSlideKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.nativeEvent.isComposing ||
      (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
    )
      return;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.closest('input, textarea, select') || target.isContentEditable)
    )
      return;
    if (!plan?.beats.length) return;
    event.preventDefault();
    event.stopPropagation();
    const nextIndex = Math.max(
      0,
      Math.min(plan.beats.length - 1, selectedIndex + (event.key === 'ArrowRight' ? 1 : -1)),
    );
    selectSlide(nextIndex);
    // Absent from the layout in a small panel, where the picker stands in.
    const button = slidesRef.current?.querySelectorAll('button')[nextIndex];
    button?.focus({ preventScroll: true });
    button?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  const updateHint = (patch: Partial<PresentationBlockHint>) => {
    if (!section) return;
    const entry = { ...hint, blockId: section.blockId, ...patch };
    if (entry.wording && entry.wording.headline === undefined && entry.wording.points === undefined)
      delete entry.wording;
    const next = {
      ...hints,
      blocks: [...hints.blocks.filter((item) => item.blockId !== section.blockId), entry],
    };
    if (!parsePresentationHints(next)) {
      setError(
        'Use a headline of at most 110 characters and up to four highlights of at most 180 characters each.',
      );
      return;
    }
    setError(null);
    setHints(next);
  };
  const hiddenCount = plan?.beats.filter((item) => item.hidden).length ?? 0;
  const shownCount = (plan?.beats.length ?? 0) - hiddenCount;
  const slideCount = `${shownCount} ${shownCount === 1 ? 'slide' : 'slides'}${hiddenCount ? ` · ${hiddenCount} hidden` : ''}`;
  /** Hide or show the selected slide, remembered by its exact source passage. */
  const setHidden = (hide: boolean) => {
    if (!plan || !beat) return;
    const key = presentationPassageKey(plan.sourceText.slice(beat.sourceStart, beat.sourceEnd));
    const rest = (hint?.hidden ?? []).filter((item) => item !== key);
    const hidden = hide ? [...rest, key].slice(-80) : rest;
    updateHint({ hidden: hidden.length ? hidden : undefined });
  };
  const suggest = async () => {
    if (!assistant || !plan || controller.current || readOnly) return;
    const run = new AbortController();
    controller.current = run;
    follow.current = true;
    const total = plan.beats.length;
    const outcome = { done: 0, refined: 0, retained: 0 };
    setError(null);
    setNotice('');
    // From the click, not from the first slide. A deck of several slides is
    // planned in one request before any slide is asked for, and until that
    // answers the designer would otherwise look idle.
    setProgress({ done: 0, total, active: null, planning: true });
    try {
      await assistant.suggestSlides(plan, {
        signal: run.signal,
        onProgress: (done) => {
          outcome.done = done;
          const next = plan.beats[done];
          setProgress({
            done,
            total,
            active: next ? { sourceStart: next.sourceStart, sourceEnd: next.sourceEnd } : null,
            planning: false,
          });
          if (next && follow.current) setSelectedSourceStart(next.sourceStart);
        },
        // Each accepted slide reaches the list, the preview and the document as
        // soon as it resolves, so stopping early keeps everything so far.
        onBeat: (_index, item) => {
          // A suggestion the design could not hold (no section of its own, or
          // wording past the limits) keeps the automatic slide.
          const alone = item && withSuggestion(EMPTY_HINTS, sections, plan.sourceText, item);
          if (!item || !alone?.blocks.length || !parsePresentationHints(alone)) {
            outcome.retained++;
            return;
          }
          outcome.refined++;
          setHints((latest) => withSuggestion(latest, sections, plan.sourceText, item));
        },
      });
      run.signal.throwIfAborted();
      setNotice(
        outcome.retained
          ? `Kept automatic summaries for ${outcome.retained} slides because the AI suggestions could not be validated.`
          : 'AI summaries are ready to review. Each is saved with the passage it summarizes.',
      );
    } catch (cause: unknown) {
      if (!run.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
      else if (controller.current === run)
        setNotice(
          `Stopped after ${outcome.done} of ${total} slides. ${
            outcome.refined === 0
              ? 'No slides changed.'
              : outcome.refined === 1
                ? 'The one AI suggestion is kept.'
                : `The ${outcome.refined} AI suggestions are kept.`
          }`,
        );
    } finally {
      if (controller.current === run) {
        controller.current = null;
        setProgress(null);
      }
    }
  };
  const aiReady = readiness === null;
  const report =
    notice && !running && assistant?.renderReport && hints.blocks.some((block) => block.ai?.length)
      ? assistant.renderReport(suggestionsText(hints))
      : null;

  return (
    <section
      className="squisq-summary-designer"
      aria-label="Summarization designer"
      onKeyDown={handleSlideKeyDown}
    >
      <div className="squisq-summary-designer-inner">
        <div className="squisq-summary-designer-header">
          <div className="squisq-summary-designer-fields squisq-summary-designer-preferences">
            <label>
              Summary density
              <select
                value={hints.density}
                disabled={locked}
                onChange={(event) =>
                  setHints({
                    ...hints,
                    density: event.target.value as PresentationHints['density'],
                  })
                }
              >
                <option value="concise">Concise — shorter passages per slide</option>
                <option value="balanced">Balanced</option>
                <option value="detailed">Detailed — longer passages per slide</option>
                <option value="section">
                  One slide per section — no splits or supporting slides
                </option>
              </select>
            </label>
            <label className="squisq-summary-designer-toggle">
              <input
                type="checkbox"
                checked={hints.inbetweens && !perSection}
                disabled={locked || perSection}
                onChange={(event) => setHints({ ...hints, inbetweens: event.target.checked })}
              />{' '}
              Add supporting visual slides where useful
            </label>
          </div>
          <div className="squisq-summary-designer-actions">
            <button
              type="button"
              disabled={locked}
              title="Return every slide to its automatic summary."
              onClick={() => {
                setHints(defaultPresentationHints());
                setSelectedSourceStart(0);
                setError(null);
                setNotice('');
              }}
            >
              Reset design
            </button>
            {assistant && !progress && (
              <button
                ref={suggestButton}
                type="button"
                disabled={!plan || !aiReady || readOnly}
                title={
                  readiness === undefined
                    ? 'Checking whether AI is available…'
                    : (readiness ??
                      'Suggest layouts and shorter slide wording from the current text.')
                }
                onClick={() => void suggest()}
              >
                Suggest with AI
              </button>
            )}
            {assistant && progress && (
              <>
                <div className="squisq-summary-designer-progress" role="status">
                  <span className="squisq-summary-designer-spinner" aria-hidden="true" />
                  <span>
                    {progress.planning
                      ? 'Planning the slides…'
                      : `Suggesting slide ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`}
                  </span>
                  {/* No value while planning: the bar shows activity, not an amount. */}
                  <progress
                    max={progress.total}
                    value={progress.planning ? undefined : progress.done}
                    aria-label="Slides suggested so far"
                  />
                </div>
                <button
                  ref={stopButton}
                  type="button"
                  title="Stop suggesting. Slides already suggested keep their new wording."
                  onClick={() => controller.current?.abort()}
                >
                  Stop
                </button>
              </>
            )}
          </div>
        </div>
        <p className="squisq-summary-designer-status" role="status" aria-live="polite">
          {plan && projection?.doc
            ? `${slideCount} · ${projection.doc.duration.toFixed(1)} seconds · ${doc?.presentationNarration ? 'Follows narration' : 'Estimated pacing — add narration to synchronize'}`
            : plan && projection?.error
              ? `${slideCount} · Not synchronized with the narration`
              : 'Preparing slides…'}
        </p>
        {(error || generated?.error || projection?.error) && (
          <p className="squisq-summary-designer-alert" role="alert">
            {error ?? generated?.error ?? projection?.error}
            {!error && !generated?.error && projection?.error && pinnedLines.length > 0 && (
              <>
                {' '}
                <button type="button" disabled={locked || !current} onClick={removePins}>
                  Remove pinned times
                </button>
              </>
            )}
          </p>
        )}
        {notice && (
          <p className="squisq-summary-designer-status" role="status">
            {notice}
            {report && <> {report}</>}
          </p>
        )}
        {plan && beat && section && (
          <div className="squisq-summary-designer-workspace">
            <nav
              ref={slidesRef}
              className="squisq-summary-designer-slides"
              aria-label="Presentation slides"
            >
              {plan.beats.map((item, index) => {
                const { layout, suggested, pending: requested } = slideTags[index]!;
                return (
                  <button
                    type="button"
                    key={item.id}
                    className={item.hidden ? 'squisq-summary-designer-slide--hidden' : undefined}
                    aria-current={index === selectedIndex ? 'step' : undefined}
                    title={item.headline}
                    onClick={() => selectSlide(index)}
                  >
                    <span className="squisq-summary-designer-slide-title">
                      {index + 1}. {item.headline}
                    </span>
                    <span className="squisq-summary-designer-slide-tags">
                      <small>{layout}</small>
                      {item.hidden && <small>Hidden</small>}
                      {requested ? (
                        <small className="squisq-summary-designer-slide-ai">
                          <span className="squisq-summary-designer-spinner" aria-hidden="true" />
                          Suggesting…
                        </small>
                      ) : suggested ? (
                        <small className="squisq-summary-designer-slide-ai">
                          <span className="squisq-sr-only">Suggested by </span>AI
                        </small>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </nav>
            {/* Stands in for the list when the panel is too narrow or short for
                two columns (the stylesheet decides, from the panel's own size). */}
            <div className="squisq-summary-designer-picker">
              <label htmlFor={slidePickerId}>Slide</label>
              <div className="squisq-summary-designer-picker-row">
                <button
                  type="button"
                  aria-label="Previous slide"
                  title="Previous slide"
                  disabled={selectedIndex === 0}
                  onClick={() => selectSlide(selectedIndex - 1)}
                >
                  <Icon icon="fa-solid fa-chevron-left" />
                </button>
                <select
                  id={slidePickerId}
                  value={selectedIndex}
                  onChange={(event) => selectSlide(Number(event.target.value))}
                >
                  {plan.beats.map((item, index) => {
                    const { layout, suggested, pending: requested } = slideTags[index]!;
                    const status = [
                      layout,
                      item.hidden && 'Hidden',
                      requested ? 'Suggesting…' : suggested && 'Suggested by AI',
                    ].filter(Boolean);
                    return (
                      <option key={item.id} value={index}>
                        {`${index + 1}. ${item.headline} · ${status.join(' · ')}`}
                      </option>
                    );
                  })}
                </select>
                <button
                  type="button"
                  aria-label="Next slide"
                  title="Next slide"
                  disabled={selectedIndex >= plan.beats.length - 1}
                  onClick={() => selectSlide(selectedIndex + 1)}
                >
                  <Icon icon="fa-solid fa-chevron-right" />
                </button>
              </div>
            </div>
            <div className="squisq-summary-designer-detail">
              <div
                className={`squisq-summary-designer-preview${beat.hidden ? ' squisq-summary-designer-preview--hidden' : ''}`}
                style={{ aspectRatio: `${viewport.width} / ${viewport.height}` }}
                role="img"
                aria-label={`Slide ${selectedIndex + 1}${beat.hidden ? ' (hidden)' : ''}: ${beat.headline}`}
              >
                <MediaContext.Provider value={mediaProvider ?? null}>
                  {visual && (
                    <BlockRenderer
                      block={visual}
                      blockTime={1}
                      animationsEnabled={false}
                      basePath={basePath}
                      viewport={viewport}
                      theme={preview?.activeTheme}
                    />
                  )}
                </MediaContext.Provider>
              </div>
              <label className="squisq-summary-designer-toggle">
                <input
                  type="checkbox"
                  checked={!!beat.hidden}
                  // A deck needs at least one slide.
                  disabled={locked || (!beat.hidden && shownCount <= 1)}
                  onChange={(event) => setHidden(event.target.checked)}
                />{' '}
                Hide this slide in the presentation
              </label>
              <div className="squisq-summary-designer-fields">
                <label>
                  Layout preference for this section
                  <select
                    value={hint?.layout ?? ''}
                    disabled={locked}
                    aria-describedby={hint?.layout ? layoutHelpId : undefined}
                    onChange={(event) =>
                      updateHint({
                        layout: (event.target.value || undefined) as
                          PresentationBeatLayout | undefined,
                      })
                    }
                  >
                    <option value="">Automatic</option>
                    <option value={AUTHORED_PRESENTATION_LAYOUT}>
                      {layoutLabel(AUTHORED_PRESENTATION_LAYOUT, section.blockId)}
                    </option>
                    <optgroup label="Summary layouts">
                      {PRESENTATION_LAYOUTS.filter(
                        (layout) => layout !== 'image' || beat.imageSrc,
                      ).map((layout) => (
                        <option key={layout} value={layout}>
                          {summaryLayoutLabel(layout)}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </label>
                {!perSection && beat.layout !== AUTHORED_PRESENTATION_LAYOUT && (
                  <label>
                    Supporting slides for this section
                    <select
                      value={hint?.inbetweens === undefined ? '' : String(hint.inbetweens)}
                      disabled={locked}
                      onChange={(event) =>
                        updateHint({
                          inbetweens:
                            event.target.value === '' ? undefined : event.target.value === 'true',
                        })
                      }
                    >
                      <option value="">Use document preference</option>
                      <option value="true">Allow</option>
                      <option value="false">Do not add</option>
                    </select>
                  </label>
                )}
              </div>
              {hint?.layout && (
                <p id={layoutHelpId} className="squisq-summary-designer-layout-help">
                  {layoutHelp(hint.layout)}
                </p>
              )}
              <section className="squisq-summary-designer-source" aria-labelledby={originalTextId}>
                <div className="squisq-summary-designer-source-label">
                  <h3 id={originalTextId}>Original document text</h3>
                  <span>Read only</span>
                </div>
                <p>{section.text}</p>
              </section>
              {beat.sourceStart === section.sourceStart &&
                beat.layout !== AUTHORED_PRESENTATION_LAYOUT && (
                  <details className="squisq-summary-designer-wording">
                    <summary>Customize slide wording (slides only)</summary>
                    <p>
                      This section’s opening slide can use your wording. If you change the section
                      text, it returns to an automatic summary.
                    </p>
                    <label>
                      Slide headline
                      <input
                        key={beat.headline}
                        defaultValue={beat.headline}
                        maxLength={110}
                        disabled={locked}
                        onBlur={(event) =>
                          updateHint({
                            wording: {
                              ...(hint?.wording?.source === section.text ? hint.wording : {}),
                              source: section.text,
                              headline: event.target.value.trim() || undefined,
                            },
                          })
                        }
                      />
                    </label>
                    <label>
                      Slide highlights, one per line
                      <textarea
                        rows={3}
                        key={beat.points.join('\n')}
                        defaultValue={beat.points.join('\n')}
                        disabled={locked}
                        onBlur={(event) =>
                          updateHint({
                            wording: {
                              ...(hint?.wording?.source === section.text ? hint.wording : {}),
                              source: section.text,
                              points: event.target.value.split('\n').filter(Boolean),
                            },
                          })
                        }
                      />
                    </label>
                  </details>
                )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
