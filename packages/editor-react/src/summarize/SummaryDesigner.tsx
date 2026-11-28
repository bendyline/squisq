/**
 * SummaryDesigner — the Custom summary style's designer, shown in Write ›
 * Summarize while Custom (core's `dynamic-slides`) is chosen.
 *
 * Custom slides are generated from the document's current text on every
 * projection. What persists is the author's INTENT, in the document itself
 * where it can be read (core's `presentationHintsDoc.ts`): the summary length
 * and the supporting- and title-slide choices as frontmatter keys, a section's layout and
 * slide count on its heading's tag, and each designed slide as a `{[summary]}`
 * block under its
 * section — your wording for a section's opening slide (kept when the text
 * changes); your wording for any other slide, an AI suggestion or a hidden
 * slide keyed to the exact passage it was made for. Generated slides are
 * never saved.
 *
 * The document is the only copy of the design: this view reads it on every
 * change and writes each change as it is made (`writePresentationHints`), so
 * an undo in Write, an edit in Source, or a summary typed by hand flows back
 * here. A design saved the old way (the `squisq-presentation-hints` key) is
 * shown as it is and converted on the first change.
 *
 * AI is optional: a host that lends a `SummarizationAssistant` gets "Suggest
 * with AI", which words and lays out the slides one at a time; suggestions
 * are saved in batches, each with the passage it summarizes.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { BlockRenderer, MediaContext } from '@bendyline/squisq-react';
import {
  markdownToDoc,
  resolveAudioMapping,
  buildPreviewDoc,
  expandDocBlocks,
  flattenBlocks,
  flattenContentBlocks,
  flattenRenderableBlocks,
  getPinnedBlockMeta,
  isFeatureBlockTemplate,
  previewBlockTemplate,
  PRESENTATION_LAYOUT_LABELS,
} from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { VIEWPORT_PRESETS, type Doc } from '@bendyline/squisq/schemas';
import {
  bindPresentationDesigns,
  compilePresentationPlan,
  createPresentationPlan,
  createPresentationPlanReport,
  defaultPresentationHints,
  parsePresentationHints,
  presentationSections,
  presentationSlideCounts,
  presentationHintUsage,
  presentationHintsForPlan,
  readPresentationHints,
  removeSummaryBlocks,
  resetPresentationHints,
  slideHintHasWording,
  withBlockHint,
  withSlideHint,
  writePresentationHints,
  PRESENTATION_DENSITIES,
  PRESENTATION_DENSITY_LABELS,
  PRESENTATION_LAYOUTS,
  PRESENTATION_LIMITS,
  PRESENTATION_SECTION_SLIDES,
  AUTHORED_PRESENTATION_LAYOUT,
  FEATURE_PRESENTATION_LAYOUT,
  isSummaryPresentationLayout,
  presentationBeatExtras,
  presentationBeatIsSlide,
  presentationLayoutNeeds,
  presentationPassageKey,
  presentationSlideKey,
  presentationSlideStarts,
  withPresentationDensity,
  withSlideStarts,
  type PresentationHints,
  type PresentationHintIssue,
  type PresentationRollup,
  type PresentationSlideHint,
  type PresentationBeat,
  type PresentationBeatLayout,
} from '@bendyline/squisq/transform';
import { useEditorContext } from '../EditorContext';
import { useAssistantReadiness } from '../designer/useAssistantReadiness';
import { useBatchedSave } from '../designer/useBatchedSave';
import { AssistantRunControls } from '../designer/AssistantRunControls';
import { gist, sectionName } from '../designer/designerText';
import { usePreviewSettingsOptional } from '../PreviewControls';
import { resolveDataPreviews } from '../usePreviewProjection';
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
function layoutHelp(layout: PresentationBeatLayout, before: string | undefined): string {
  if (layout === AUTHORED_PRESENTATION_LAYOUT)
    return 'Shows this section as written, as one slide for its whole narration. To change its block type, use the block picker in the editor.';
  if (layout === FEATURE_PRESENTATION_LAYOUT)
    return `Draws this block beneath the headline of ${before ? `the last slide of “${before}”` : 'the slide before it'} instead of on a slide of its own. Its text is still narrated while that slide stays up.`;
  const described = (
    PRESENTATION_LAYOUT_LABELS as Record<string, { description: string } | undefined>
  )[layout]?.description;
  const needs = presentationLayoutNeeds(layout, { points: 'highlights' });
  return [described, needs ? `Used on slides with ${needs}.` : ''].filter(Boolean).join(' ');
}
/** Why a section asked to be shown on the slide before it has a slide of its own. */
function rollupProblem(
  problem: NonNullable<PresentationRollup['problem']>,
  type: string,
  before: string | undefined,
): string {
  const named = before ? `“${before}”` : 'the section before it';
  switch (problem) {
    case 'not-eligible':
      return `A ${type} block cannot be drawn on another slide, so it has a slide of its own.`;
    case 'no-section-before':
      return 'Nothing comes before this section to carry it, so it has a slide of its own.';
    case 'section-before-authored':
      return `${named[0]!.toUpperCase()}${named.slice(1)} is shown as authored, so this section has a slide of its own.`;
    case 'section-before-hidden':
      return `Every slide of ${named} is hidden, so this section has a slide of its own.`;
    case 'no-room':
      return `The last slide of ${named} already carries ${PRESENTATION_LIMITS.mediaPerBeat} things, so this section has a slide of its own.`;
  }
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
/** One AI suggestion as a slide design, or null when the design could not hold it. */
function suggestedSlide(item: PresentationBeat): PresentationSlideHint | null {
  if (!isSummaryPresentationLayout(item.layout)) return null;
  const slide: PresentationSlideHint = {
    origin: 'ai',
    layout: item.layout,
    headline: item.headline,
    points: [...item.points],
    // A hub's centre and a matrix's axes are part of the suggestion.
    ...presentationBeatExtras(item.layout, item),
  };
  const valid = parsePresentationHints({
    ...defaultPresentationHints(),
    blocks: [{ blockId: 'x', slides: [slide] }],
  });
  return valid ? slide : null;
}
/** An accepted AI suggestion: the slide it is for, and its design. */
interface Suggestion {
  blockId: string;
  /** The slide's passage key now. */
  passage: string;
  /** Where the slide begins in its section (`PresentationSlideHint.at`). */
  at?: number;
  /** The summary the slide has now, when it is keyed to an older passage. */
  replaces?: string;
  slide: PresentationSlideHint;
}
/** Store accepted suggestions, each keyed to the passage it summarizes and the
 * place its slide begins, so it stays with that slide when the text changes.
 * A slide you worded yourself keeps your wording; a hidden slide stays hidden. */
function withSuggestions(
  current: PresentationHints,
  suggestions: readonly Suggestion[],
): PresentationHints {
  let next = current;
  for (const { blockId, passage, at, replaces, slide } of suggestions) {
    const slides = next.blocks.find((block) => block.blockId === blockId)?.slides;
    const existing =
      slides?.find((entry) => entry.passage === passage) ??
      (replaces ? slides?.find((entry) => entry.passage === replaces) : undefined);
    if (existing && !existing.origin && slideHintHasWording(existing)) continue;
    // The slide's older summary gives way to the new one, keyed as it is now.
    if (existing && existing.passage !== passage)
      next = withSlideHint(next, blockId, existing.passage, null);
    next = withSlideHint(next, blockId, passage, {
      ...slide,
      ...(at !== undefined ? { at } : {}),
      ...(existing?.hidden ? { hidden: true as const } : {}),
    });
  }
  return next;
}
/**
 * A slide design that reads back as written. A hidden slide's summary whose
 * only wording is a headline would read back with that headline as the
 * slide's label (a hidden slide's lone heading only names it), so it also
 * keeps the points the slide shows.
 */
function keepingHeadline<T extends PresentationSlideHint>(slide: T, points: readonly string[]): T {
  return slide.hidden &&
    !slide.origin &&
    slide.headline !== undefined &&
    slide.points === undefined &&
    slide.layout === undefined
    ? { ...slide, points: [...points] }
    : slide;
}
/** The AI wording a design holds, as text, for a host's report control. */
function suggestionsText(hints: PresentationHints): string {
  const wording = (headline: string | undefined, points: readonly string[] | undefined) =>
    [headline ?? '', ...(points ?? []).map((point) => `- ${point}`)].join('\n').trim();
  return hints.blocks
    .flatMap((block) => [
      ...(block.slides ?? [])
        .filter((slide) => slide.origin === 'ai')
        .map((slide) => wording(slide.headline, slide.points)),
      ...(block.ai ?? []).map((entry) => wording(entry.headline, entry.points)),
    ])
    .filter(Boolean)
    .join('\n\n');
}

/**
 * What a slide says about itself in the list. Its group names the section, so
 * a slide titled with the section's heading (as automatic slides are) shows
 * the opening of the passage it covers instead, and consecutive slides of one
 * section read as the parts of it they are. A headline of its own (custom or
 * AI wording) is what the slide shows, so the list shows that.
 */
function slideLabel(item: PresentationBeat, sourceText: string, heading?: string): string {
  const title = heading?.trim() ?? '';
  const headline = item.headline.trim();
  const clipped = headline.endsWith('…') && title.startsWith(headline.slice(0, -1).trim());
  if (!title || (headline.toLowerCase() !== title.toLowerCase() && !clipped)) return headline;
  const passage = sourceText.slice(item.sourceStart, item.sourceEnd).trim();
  const rest = passage.startsWith(title) ? passage.slice(title.length) : passage;
  return gist(rest, 160) || headline;
}

export interface SummaryDesignerProps {
  /** The host's AI, for "Suggest with AI". Without one the designer has no AI. */
  assistant?: SummarizationAssistant;
  /** Shows the design without letting it change. */
  readOnly?: boolean;
  /** Base path for resolving media URLs in the slide preview. */
  basePath?: string;
  /**
   * Where the designer's own controls go (the summary length, supporting
   * slides, Reset design, Suggest with AI) when its host keeps a row for them
   * — Summaries puts them beside the Summary style. The host then also names
   * the region that holds both ("Summarization designer"), so the designer is
   * not a region of its own. Null while that row is not there yet; left out,
   * the designer heads itself with its controls.
   */
  controlsSlot?: HTMLElement | null;
}

export function SummaryDesigner({
  assistant,
  readOnly = false,
  basePath = '/',
  controlsSlot,
}: SummaryDesignerProps) {
  const { workspaceContainer, markdownSource, replaceAll, mediaProvider, mediaRevision } =
    useEditorContext();
  const preview = usePreviewSettingsOptional();
  const viewport = preview?.activeViewport ?? VIEWPORT_PRESETS.landscape;
  const originalTextId = useId();
  const layoutHelpId = useId();
  const slidePickerId = useId();
  const headingNoteId = useId();
  const countHelpId = useId();
  const rollupNoteId = useId();
  const readiness = useAssistantReadiness(assistant);

  // ── The design: read from the document, written back as it changes ──
  const sourceRef = useRef(markdownSource);
  sourceRef.current = markdownSource;
  const parsed = useMemo(() => markdownToDoc(parseMarkdown(markdownSource)), [markdownSource]);
  const read = useMemo(() => readPresentationHints(parsed), [parsed]);
  /** AI suggestions accepted but not yet written: they are saved in batches. */
  const batch = useBatchedSave<Suggestion>((pending) =>
    commit((design) => withSuggestions(design, pending)),
  );
  const hints = useMemo(
    () => withSuggestions(read.hints, batch.pending),
    [read.hints, batch.pending],
  );
  const [error, setError] = useState<string | null>(null);
  /**
   * Write one change to the design into the document, as one undo step. The
   * change applies to the design the document holds now; one saved the old
   * way becomes summaries first, keeping what still applies.
   */
  const commit = (change: (design: PresentationHints) => PresentationHints): void => {
    if (readOnly) return;
    const source = sourceRef.current;
    const doc = markdownToDoc(parseMarkdown(source));
    const current = readPresentationHints(doc);
    let base = current.hints;
    if (current.format === 'legacy') {
      try {
        base = presentationHintsForPlan(
          doc,
          current.hints,
          createPresentationPlan(doc, current.hints),
        );
      } catch {
        base = {
          ...defaultPresentationHints(),
          density: base.density,
          inbetweens: base.inbetweens,
        };
      }
      setNotice('Slide summaries are now saved in the document, under each section.');
    }
    // Summaries saved before they recorded where their slide begins learn it
    // now, while they still match their slide, so text edits keep them there.
    try {
      base = withSlideStarts(createPresentationPlan(doc, base), presentationSections(doc), base);
    } catch {
      // No deck to match them with (no text, or too many slides): they wait.
    }
    const written = writePresentationHints(source, change(base));
    if (written.result !== source) {
      sourceRef.current = written.result;
      replaceAll(written.result);
    }
    setError(written.rejected[0]?.message ?? null);
  };
  const replaceSource = (next: { result: string }) => {
    if (readOnly || next.result === sourceRef.current) return;
    sourceRef.current = next.result;
    replaceAll(next.result);
  };

  // One slide per section never adds supporting slides, so their controls rest.
  const perSection = hints.density === 'section';
  const [loaded, setLoaded] = useState<{ doc: Doc; source: string } | null>(null);
  const [selectedSourceStart, setSelectedSourceStart] = useState(0);
  const [notice, setNotice] = useState('');
  /** Slide wording starts open; closing it keeps it closed from slide to slide. */
  const [wordingOpen, setWordingOpen] = useState(true);
  const [progress, setProgress] = useState<SuggestionProgress | null>(null);
  const controller = useRef<AbortController | null>(null);
  /** Show each slide as it is suggested until the person picks one themselves. */
  const follow = useRef(false);
  const slidesRef = useRef<HTMLElement>(null);
  useEffect(() => {
    let disposed = false;
    // A chart or table that reads its rows from a file (`src=`) previews them,
    // as the preview panel does; a file that cannot be read leaves it as it is.
    const load = workspaceContainer
      ? resolveAudioMapping(parsed, workspaceContainer).then((doc) =>
          resolveDataPreviews(doc, workspaceContainer, mediaRevision ?? 0),
        )
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
  }, [markdownSource, parsed, workspaceContainer, mediaRevision]);
  // Each saved change rewrites the document, so a run of suggestions outlives
  // many loads; only leaving the designer stops it, keeping what it suggested.
  // (The batch saves what was accepted when the designer goes.)
  useEffect(() => () => controller.current?.abort(), []);
  const running = progress !== null;
  const locked = running || readOnly;

  // Every saved change reloads the document. Keep showing the last one until
  // the reload lands, rather than blanking the slides on each change.
  const doc = loaded?.doc ?? null;
  const current = loaded?.source === markdownSource;
  const generated = useMemo(() => {
    if (!doc) return null;
    try {
      const planned = createPresentationPlanReport(doc, hints);
      return { plan: planned.plan, rollups: planned.rollups, error: null };
    } catch (cause: unknown) {
      return {
        plan: null,
        rollups: [],
        error: cause instanceof Error ? cause.message : String(cause),
      };
    }
  }, [doc, hints]);
  const plan = generated?.plan;
  /** Each section asked to be shown on the slide before it, by its block. */
  const rollups = useMemo(
    () => new Map((generated?.rollups ?? []).map((rollup) => [rollup.blockId, rollup])),
    [generated],
  );
  const sections = useMemo(() => (doc ? presentationSections(doc) : []), [doc]);
  // How many slides each summary length would make, shown beside each choice.
  const lengthCounts = useMemo(
    () => (doc ? presentationSlideCounts(doc, hints) : {}),
    [doc, hints],
  );
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
  // Each slide's summary keyed to a passage, matched with its slide however
  // the text has changed since (Squisq's `bindPresentationDesigns`), and where
  // each slide begins in its section, which a summary saved for it records.
  const designs = useMemo(
    () =>
      plan
        ? bindPresentationDesigns(plan, sections, hints).slides
        : new Map<number, PresentationSlideHint>(),
    [plan, sections, hints],
  );
  const slideStarts = useMemo(
    () => (plan ? presentationSlideStarts(plan, sections) : []),
    [plan, sections],
  );
  // AI wording a legacy design keeps, keyed by the passage it summarizes.
  const legacyAi = useMemo(() => {
    const entries = new Map<string, Map<string, PresentationBeat['layout']>>();
    for (const block of hints.blocks) {
      const layouts = new Map<string, PresentationBeat['layout']>();
      for (const entry of block.ai ?? [])
        layouts.set(presentationPassageKey(entry.source), entry.layout);
      entries.set(block.blockId, layouts);
    }
    return entries;
  }, [hints]);
  // Names the block type each section renders with when shown as authored, and
  // which sections draw a picture that can go on the slide before them.
  const blockTypes = useMemo(() => {
    const types = new Map<string, { label: string; drawn: boolean }>();
    if (!doc) return types;
    for (const block of flattenRenderableBlocks(doc.blocks))
      types.set(block.id, {
        label: templateLabel(previewBlockTemplate(block, doc), doc.customTemplates),
        drawn: isFeatureBlockTemplate(block.template),
      });
    return types;
  }, [doc]);
  const typeLabel = (blockId: string | undefined) =>
    blockTypes.get(blockId ?? '')?.label ?? 'Block';
  /**
   * The section whose last slide carries `blockId` when it is shown on the
   * slide before it: the nearest section before it that makes slides.
   */
  const sectionBefore = (blockId: string): Sections[number] | undefined => {
    const named = (id: string | undefined) => sections.find((item) => item.blockId === id);
    const rollup = rollups.get(blockId);
    if (rollup) return named(rollup.ownerId);
    if (!plan) return undefined;
    const first = plan.beats.findIndex(
      (item) => sectionAt(sections, item.sourceStart)?.blockId === blockId,
    );
    for (let index = first - 1; index >= 0; index--) {
      const item = plan.beats[index]!;
      if (item.layout !== FEATURE_PRESENTATION_LAYOUT) return sectionAt(sections, item.sourceStart);
    }
    return undefined;
  };
  const beforeName = (blockId: string) => {
    const before = sectionBefore(blockId);
    return before ? sectionName(before) : undefined;
  };
  const layoutLabel = (layout: PresentationBeatLayout, blockId: string | undefined) => {
    if (layout === AUTHORED_PRESENTATION_LAYOUT)
      return blockTypes.has(blockId ?? '') ? `As authored (${typeLabel(blockId)})` : 'As authored';
    if (layout === FEATURE_PRESENTATION_LAYOUT) {
      const before = blockId ? beforeName(blockId) : undefined;
      return `${before ? `On the last slide of “${before}”` : 'On the slide before it'} (${typeLabel(blockId)})`;
    }
    return summaryLayoutLabel(layout);
  };
  // Slides number as the deck shows them; a section on another slide has no number.
  const slideNumbers = useMemo(() => {
    let counted = 0;
    return (plan?.beats ?? []).map((item) =>
      item.layout === FEATURE_PRESENTATION_LAYOUT ? null : ++counted,
    );
  }, [plan]);
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
  // Text before the first heading, or a section made by a standalone tag, has
  // no heading to hold section settings; its slides can still be worded.
  const headed = !!(
    doc &&
    section &&
    flattenContentBlocks(doc.blocks).find((block) => block.id === section.blockId)?.sourceHeading
  );
  // How many slides tell the selected section now (its title slide shows only
  // its heading, and is not one of them).
  const sectionSlides =
    plan && section
      ? plan.beats.filter(
          (item) =>
            !item.sectionTitle &&
            sectionAt(sections, item.sourceStart)?.blockId === section.blockId,
        ).length
      : 0;
  /** The selected slide is its section's title slide: the heading alone. */
  const titleSlide = !!beat?.sectionTitle;
  // Summaries in the document that the deck does not use now, and why: their
  // slide is gone (the text changed, or the summary length cuts it differently — it
  // comes back with the slide), or the summary cannot be read.
  const unused = useMemo((): PresentationHintIssue[] => {
    if (!plan || !current) return [];
    const seen = new Set<string>();
    return [
      ...read.issues.filter((issue) => issue.accessoryBlockId),
      ...presentationHintUsage(parsed, plan, read),
    ].filter((issue) => {
      if (seen.has(issue.accessoryBlockId!)) return false;
      seen.add(issue.accessoryBlockId!);
      return true;
    });
  }, [plan, current, read, parsed]);
  const summaryTitles = useMemo(
    () => new Map(flattenBlocks(parsed.blocks).map((block) => [block.id, block.title ?? ''])),
    [parsed],
  );
  const removeSummaries = (ids: string[]) =>
    replaceSource(removeSummaryBlocks(sourceRef.current, ids));
  /** The selected section, when it is shown on the slide before it. */
  const rollup = section ? rollups.get(section.blockId) : undefined;
  const rolledUp = beat?.layout === FEATURE_PRESENTATION_LAYOUT;
  const carrierIndex =
    rolledUp && plan ? plan.beats.findIndex((item) => item.id === rollup?.carrierBeatId) : -1;
  // A section on another slide previews the slide that carries it.
  const previewBeat = rolledUp ? plan?.beats[carrierIndex] : beat;
  const previewNumber = slideNumbers[rolledUp ? carrierIndex : selectedIndex];
  const visual = projection?.blocks.find((block) => block.id === previewBeat?.id);
  // What the slide list and the small-panel picker both say about each slide.
  const slideTags = !plan
    ? []
    : plan.beats.map((item, index) => {
        const owner = sectionAt(sections, item.sourceStart);
        const design = designs.get(index);
        const layout =
          design?.origin === 'ai' && design.layout
            ? design.layout
            : owner && legacyAi.get(owner.blockId)?.get(presentationSlideKey(plan, index));
        const active = progress?.active;
        const onto =
          item.layout === FEATURE_PRESENTATION_LAYOUT
            ? plan.beats.findIndex(
                (other) => other.id === rollups.get(owner?.blockId ?? '')?.carrierBeatId,
              )
            : -1;
        return {
          owner,
          number: slideNumbers[index] ?? null,
          label: slideLabel(item, plan.sourceText, owner?.heading),
          // A section on another slide is tagged with its type and that slide.
          layout: item.sectionTitle
            ? 'Section title'
            : item.layout === FEATURE_PRESENTATION_LAYOUT
              ? typeLabel(owner?.blockId)
              : layoutLabel(item.layout, owner?.blockId),
          onSlide: onto >= 0 ? (slideNumbers[onto] ?? null) : null,
          // The blocks a slide carries from the sections after it.
          carries: [...rollups.values()]
            .filter((entry) => entry.carrierBeatId === item.id)
            .map((entry) => typeLabel(entry.blockId)),
          suggested:
            isSummaryPresentationLayout(item.layout) &&
            layout !== undefined &&
            (layout !== 'image' || !!item.imageSrc),
          pending:
            !!active &&
            active.sourceStart === item.sourceStart &&
            active.sourceEnd === item.sourceEnd,
        };
      });
  /** What the list and the picker show as a slide's title. */
  const numbered = (index: number) => {
    const { number, label } = slideTags[index]!;
    return number === null ? label : `${number}. ${label}`;
  };
  // Every slide is made from one block of the document, and a block's slides
  // are consecutive, so the list groups them under the block they came from.
  const slideGroups: Array<{ key: string; name: string; indexes: number[] }> = [];
  slideTags.forEach(({ owner }, index) => {
    const last = slideGroups[slideGroups.length - 1];
    if (last && owner && last.key === owner.blockId) last.indexes.push(index);
    else
      slideGroups.push({
        key: owner?.blockId ?? `slide-${index}`,
        name: sectionName(owner),
        indexes: [index],
      });
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
  /** Change the selected slide's section's settings (on its heading). */
  const setSectionSetting = (patch: {
    layout?: PresentationBeatLayout;
    inbetweens?: boolean;
    count?: number;
  }) => {
    if (!section) return;
    commit((design) => withBlockHint(design, section.blockId, patch));
  };
  // Where your wording for the selected slide is saved. A slide summary stays
  // with its slide however the text changes (Squisq's `bindPresentationDesigns`),
  // so the summary the slide has now is the one changed, keyed again to the
  // slide's passage as it reads now and the place the slide begins. A
  // section's opening slide without one keeps your wording in the section's
  // keyless summary, which applies at every summary length.
  const beatKey = plan && beat ? presentationSlideKey(plan, selectedIndex) : undefined;
  const beatAt = slideStarts[selectedIndex];
  // After a title slide, the slide that follows it opens the section.
  const opening =
    !!plan &&
    !!section &&
    plan.beats.find(
      (item) =>
        !item.sectionTitle && sectionAt(sections, item.sourceStart)?.blockId === section.blockId,
    ) === beat;
  /** The summary keyed to a passage that the selected slide has now. */
  const bound = designs.get(selectedIndex);
  const keylessOwn = opening
    ? hint?.slides?.find((slide) => slide.passage === undefined && !slide.origin)
    : undefined;
  // Your wording goes in the slide's summary when it is yours, or an AI's that
  // your opening wording does not already override; on an opening slide
  // without one, in the keyless summary.
  const keyedWording =
    !opening ||
    (!!bound && !bound.origin && slideHintHasWording(bound)) ||
    (!!bound && !(keylessOwn && slideHintHasWording(keylessOwn)));
  const wordingPassage = keyedWording ? (bound?.passage ?? beatKey) : undefined;
  const wordingIn = (slides: readonly PresentationSlideHint[] | undefined) =>
    slides?.find((slide) =>
      keyedWording
        ? slide.passage === wordingPassage
        : slide.passage === undefined && !slide.origin,
    );
  /**
   * Save the selected slide's summary (`null` removes it). A keyed one is
   * keyed again to the slide as it is now — its passage and where it begins —
   * so it keeps matching the slide however the text changes after.
   */
  const saveSlideDesign = (
    design: PresentationHints,
    from: string | undefined,
    keyed: boolean,
    slide: Omit<PresentationSlideHint, 'passage'> | null,
  ): PresentationHints => {
    if (!section) return design;
    if (!keyed) return withSlideHint(design, section.blockId, undefined, slide);
    if (!beatKey) return design;
    const next =
      from !== undefined && from !== beatKey
        ? withSlideHint(design, section.blockId, from, null)
        : design;
    if (!slide) return withSlideHint(next, section.blockId, beatKey, null);
    const { at: _at, length: _length, ...rest } = slide;
    void _at;
    void _length;
    return withSlideHint(next, section.blockId, beatKey, {
      ...rest,
      ...(beatAt !== undefined ? { at: beatAt } : {}),
    });
  };
  const savedWording = wordingIn(hint?.slides);
  /** AI wording for this slide, which your first change to it makes yours. */
  const aiWording = savedWording?.origin === 'ai' ? savedWording : undefined;
  const ownWording = !!savedWording && !savedWording.origin && slideHintHasWording(savedWording);
  const setSlideWording = (patch: { headline?: string; points?: string[] }) => {
    if (!section || !beat) return;
    if (
      patch.points &&
      (patch.points.length > PRESENTATION_LIMITS.points ||
        patch.points.some((point) => point.length > PRESENTATION_LIMITS.point))
    ) {
      setError(
        `Use up to ${PRESENTATION_LIMITS.points} highlights of at most ${PRESENTATION_LIMITS.point} characters each.`,
      );
      return;
    }
    const shownPoints = beat.points;
    commit((design) => {
      const block = design.blocks.find((item) => item.blockId === section.blockId);
      const saved = wordingIn(block?.slides);
      // AI wording becomes yours whole, so the slide changes only where you
      // changed it, and suggesting again keeps it. Its layout comes too, unless
      // the section prefers one: that preference wins over AI, and must keep
      // winning once the wording is yours.
      const { passage: _passage, origin, ...existing } = saved ?? {};
      void _passage;
      if (origin === 'ai' && isSummaryPresentationLayout(block?.layout)) delete existing.layout;
      const next: PresentationSlideHint = { ...existing, ...patch };
      if ('headline' in patch && patch.headline === undefined) delete next.headline;
      const keep = slideHintHasWording(next) || next.hidden;
      return saveSlideDesign(
        design,
        wordingPassage,
        keyedWording,
        keep ? keepingHeadline(next, shownPoints) : null,
      );
    });
  };
  /** Back to the automatic wording. A hidden slide stays hidden. */
  const restoreAutomaticWording = () => {
    if (!section || !beat) return;
    const headline = beat.headline;
    commit((design) => {
      const saved = wordingIn(
        design.blocks.find((block) => block.blockId === section.blockId)?.slides,
      );
      return saveSlideDesign(
        design,
        wordingPassage,
        keyedWording,
        saved?.hidden ? { hidden: true, label: saved.label ?? headline } : null,
      );
    });
  };
  const hiddenCount = plan?.beats.filter((item) => item.hidden).length ?? 0;
  const rolledUpCount =
    plan?.beats.filter((item) => item.layout === FEATURE_PRESENTATION_LAYOUT).length ?? 0;
  const shownCount = plan?.beats.filter(presentationBeatIsSlide).length ?? 0;
  const slideCount = `${shownCount} ${shownCount === 1 ? 'slide' : 'slides'}${hiddenCount ? ` · ${hiddenCount} hidden` : ''}${rolledUpCount ? ` · ${rolledUpCount} on another slide` : ''}`;
  /** Hide or show the selected slide, in the summary that stays with it. */
  const setHidden = (hide: boolean) => {
    if (!plan || !beat || !section) return;
    const from = bound?.passage ?? beatKey;
    const { headline, points } = beat;
    commit((design) => {
      const existing = design.blocks
        .find((block) => block.blockId === section.blockId)
        ?.slides?.find((slide) => slide.passage === from);
      if (hide)
        return saveSlideDesign(
          design,
          from,
          true,
          keepingHeadline({ ...(existing ?? { label: headline }), hidden: true }, points),
        );
      if (!existing) return design;
      // A summary that only hid the slide goes; one with wording stays, shown.
      const { hidden: _hidden, label: _label, passage: _passage, ...rest } = existing;
      void _hidden;
      void _label;
      void _passage;
      return saveSlideDesign(design, from, true, slideHintHasWording(rest) ? rest : null);
    });
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
        onBeat: (index, item) => {
          // A suggestion the design could not hold (no section of its own, or
          // wording past the limits) keeps the automatic slide.
          const parent = item && sectionAt(sections, item.sourceStart);
          const slide = item && suggestedSlide(item);
          if (!item || !parent || !slide) {
            outcome.retained++;
            return;
          }
          outcome.refined++;
          // Keyed to the slide as it is now; the summary it had, keyed to an
          // older passage, gives way to it.
          const passage = presentationSlideKey(plan, index);
          const had = designs.get(index)?.passage;
          const at = slideStarts[index];
          const suggestion: Suggestion = {
            blockId: parent.blockId,
            passage,
            ...(at !== undefined ? { at } : {}),
            ...(had !== undefined && had !== passage ? { replaces: had } : {}),
            slide,
          };
          // Saved in batches: each save rewrites the document and is an undo step.
          batch.add(suggestion);
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
      batch.flush();
      if (controller.current === run) {
        controller.current = null;
        setProgress(null);
      }
    }
  };
  const report =
    notice &&
    !running &&
    assistant?.renderReport &&
    hints.blocks.some(
      (block) => block.ai?.length || block.slides?.some((slide) => slide.origin === 'ai'),
    )
      ? assistant.renderReport(suggestionsText(hints))
      : null;

  // The designer's own controls: at its head, or on the row its host keeps
  // for them (`controlsSlot`).
  const embedded = controlsSlot !== undefined;
  const controls = (
    <>
      <div className="squisq-summary-designer-fields squisq-summary-designer-preferences">
        <label className="squisq-summary-designer-length">
          Summary length
          <select
            value={hints.density}
            disabled={locked}
            title={`${PRESENTATION_DENSITY_LABELS[hints.density].label}: ${PRESENTATION_DENSITY_LABELS[hints.density].description}. The narration always tells the whole document.`}
            onChange={(event) =>
              // Each section is cut again: slide summaries made at this length
              // wait for it, and ones made at the chosen length apply again.
              commit((design) =>
                withPresentationDensity(design, event.target.value as PresentationHints['density']),
              )
            }
          >
            {/* From the fewest slides to the most, each with what it makes. */}
            {PRESENTATION_DENSITIES.map((density) => {
              const { label, description } = PRESENTATION_DENSITY_LABELS[density];
              const count = lengthCounts[density];
              return (
                <option key={density} value={density} title={`${label}: ${description}`}>
                  {`${label}${
                    count === undefined ? '' : ` · ${count} ${count === 1 ? 'slide' : 'slides'}`
                  }${
                    // Choosing it says so, and names a length that fits.
                    count !== undefined && count > PRESENTATION_LIMITS.beats ? ' (too many)' : ''
                  }`}
                </option>
              );
            })}
          </select>
        </label>
        <label
          className="squisq-summary-designer-toggle"
          title="Adds a slide where it shows something different: an introduction before its steps diagram, or the opening of a passage before the picture that illustrates the rest."
        >
          <input
            type="checkbox"
            checked={hints.inbetweens && !perSection}
            disabled={locked || perSection}
            onChange={(event) =>
              commit((design) => ({ ...design, inbetweens: event.target.checked }))
            }
          />{' '}
          Add supporting slides
        </label>
        <label
          className="squisq-summary-designer-toggle"
          title="Opens each section after the first with a slide that shows only its heading, on screen while the heading is read. The section's other slides then each take a headline of their own."
        >
          <input
            type="checkbox"
            checked={!!hints.sectionTitles}
            disabled={locked}
            onChange={(event) =>
              commit((design) => ({ ...design, sectionTitles: event.target.checked }))
            }
          />{' '}
          Add section title slides
        </label>
      </div>
      <div className="squisq-summary-designer-actions">
        <button
          type="button"
          disabled={locked}
          title="Return every slide to its automatic summary."
          onClick={() => {
            // Every summary, setting and key, including ones not in use.
            replaceSource(resetPresentationHints(sourceRef.current));
            batch.clear();
            setSelectedSourceStart(0);
            setError(null);
            setNotice('');
          }}
        >
          Reset design
        </button>
        {assistant && (
          <AssistantRunControls
            label="Suggest with AI"
            title="Suggest layouts and shorter slide wording from the current text."
            readiness={readiness}
            disabled={!plan}
            readOnly={readOnly}
            progress={
              progress && {
                label: progress.planning
                  ? 'Planning the slides…'
                  : `Suggesting slide ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`,
                done: progress.done,
                // While planning the bar shows activity, not an amount.
                total: progress.planning ? 0 : progress.total,
                measure: 'Slides suggested so far',
              }
            }
            stopTitle="Stop suggesting. Slides already suggested keep their new wording."
            onStart={() => void suggest()}
            onStop={() => controller.current?.abort()}
          />
        )}
      </div>
    </>
  );
  // Its host names the region when the controls sit on the host's row.
  const Root = embedded ? 'div' : 'section';

  return (
    <Root
      className="squisq-summary-designer"
      aria-label={embedded ? undefined : 'Summarization designer'}
      onKeyDown={handleSlideKeyDown}
    >
      {controlsSlot && createPortal(controls, controlsSlot)}
      <div className="squisq-summary-designer-inner">
        {!embedded && <div className="squisq-summary-designer-header">{controls}</div>}
        <p className="squisq-summary-designer-status" role="status" aria-live="polite">
          {plan && projection?.doc
            ? `${slideCount} · ${projection.doc.duration.toFixed(1)} seconds · ${doc?.presentationNarration ? 'Follows narration' : 'Estimated pacing — add narration to synchronize'}`
            : plan && projection?.error
              ? `${slideCount} · Not synchronized with the narration`
              : // A deck that could not be made says why in the alert; it is
                // not still on its way.
                error || generated?.error
                ? ''
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
        {unused.length > 0 && (
          <details className="squisq-summary-designer-unused">
            <summary>
              {/* Summaries made at another length wait for it; say so rather
                  than call them unused. */}
              {unused.every((issue) => issue.code === 'summary-other-length')
                ? unused.length === 1
                  ? '1 slide summary is for another summary length'
                  : `${unused.length} slide summaries are for another summary length`
                : unused.length === 1
                  ? '1 summary in the document is not in use'
                  : `${unused.length} summaries in the document are not in use`}
            </summary>
            <ul>
              {unused.map((issue) => (
                <li key={issue.accessoryBlockId}>
                  <span>
                    <strong>
                      {summaryTitles.get(issue.accessoryBlockId!) || 'Untitled summary'}
                    </strong>{' '}
                    — {issue.message}
                  </span>{' '}
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => removeSummaries([issue.accessoryBlockId!])}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            {unused.length > 1 && (
              <button
                type="button"
                disabled={locked}
                onClick={() => removeSummaries(unused.map((issue) => issue.accessoryBlockId!))}
              >
                Remove all
              </button>
            )}
          </details>
        )}
        {plan && beat && section && (
          <div className="squisq-summary-designer-workspace">
            <nav
              ref={slidesRef}
              className="squisq-summary-designer-slides"
              aria-label="Presentation slides"
            >
              {/* Each block of the document beside the slides made from it. The
                  slide buttons stay the list's only buttons, in deck order, so
                  ← and → still move through them by position. */}
              {slideGroups.map((group, groupIndex) => {
                const groupLabelId = `${slidePickerId}-section-${groupIndex}`;
                const count = group.indexes.length;
                return (
                  <div
                    key={group.key}
                    role="group"
                    aria-labelledby={groupLabelId}
                    className={`squisq-summary-designer-section${
                      group.indexes.includes(selectedIndex)
                        ? ' squisq-summary-designer-section--current'
                        : ''
                    }`}
                  >
                    <div id={groupLabelId} className="squisq-summary-designer-section-source">
                      <span className="squisq-summary-designer-section-name">{group.name}</span>{' '}
                      <small>
                        {group.indexes.every((index) => slideTags[index]!.number === null)
                          ? 'On another slide'
                          : count === 1
                            ? '1 slide'
                            : `${count} slides`}
                      </small>
                    </div>
                    <div className="squisq-summary-designer-section-slides">
                      {group.indexes.map((index) => {
                        const item = plan.beats[index]!;
                        const {
                          label,
                          layout,
                          onSlide,
                          carries,
                          suggested,
                          pending: requested,
                        } = slideTags[index]!;
                        const onAnother = item.layout === FEATURE_PRESENTATION_LAYOUT;
                        return (
                          <button
                            type="button"
                            key={item.id}
                            className={
                              item.hidden
                                ? 'squisq-summary-designer-slide--hidden'
                                : onAnother
                                  ? 'squisq-summary-designer-slide--rolled-up'
                                  : undefined
                            }
                            aria-current={index === selectedIndex ? 'step' : undefined}
                            title={label}
                            onClick={() => selectSlide(index)}
                          >
                            <span className="squisq-summary-designer-slide-title">
                              {numbered(index)}
                            </span>
                            <span className="squisq-summary-designer-slide-tags">
                              <small>{layout}</small>
                              {onAnother && (
                                <small>
                                  {onSlide ? `On slide ${onSlide}` : 'On another slide'}
                                </small>
                              )}
                              {carries.map((type, at) => (
                                <small key={at}>
                                  <span aria-hidden="true">+ </span>
                                  <span className="squisq-sr-only">Carries </span>
                                  {type}
                                </small>
                              ))}
                              {item.hidden && <small>Hidden</small>}
                              {requested ? (
                                <small className="squisq-summary-designer-slide-ai">
                                  <span
                                    className="squisq-summary-designer-spinner"
                                    aria-hidden="true"
                                  />
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
                    </div>
                  </div>
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
                  {slideGroups.map((group) => (
                    <optgroup key={group.key} label={group.name}>
                      {group.indexes.map((index) => {
                        const item = plan.beats[index]!;
                        const {
                          layout,
                          onSlide,
                          carries,
                          suggested,
                          pending: requested,
                        } = slideTags[index]!;
                        const status = [
                          layout,
                          item.layout === FEATURE_PRESENTATION_LAYOUT &&
                            (onSlide ? `On slide ${onSlide}` : 'On another slide'),
                          ...carries.map((type) => `+ ${type}`),
                          item.hidden && 'Hidden',
                          requested ? 'Suggesting…' : suggested && 'Suggested by AI',
                        ].filter(Boolean);
                        return (
                          <option key={item.id} value={index}>
                            {`${numbered(index)} · ${status.join(' · ')}`}
                          </option>
                        );
                      })}
                    </optgroup>
                  ))}
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
                aria-label={
                  rolledUp
                    ? `Slide ${previewNumber ?? ''}, which carries this section: ${previewBeat?.headline ?? beat.headline}`
                    : `Slide ${previewNumber ?? selectedIndex + 1}${beat.hidden ? ' (hidden)' : ''}: ${beat.headline}`
                }
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
              {/* A section on another slide has no slide of its own to hide. */}
              {!rolledUp && (
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
              )}
              <div className="squisq-summary-designer-fields">
                {/* A section shown as authored, or on another slide, is one beat. */}
                {isSummaryPresentationLayout(beat.layout) && (
                  <label>
                    Slides for this section
                    <select
                      value={hint?.count ?? ''}
                      disabled={locked || !headed}
                      aria-describedby={
                        !headed ? headingNoteId : hint?.count ? countHelpId : undefined
                      }
                      onChange={(event) =>
                        setSectionSetting({
                          count: event.target.value ? Number(event.target.value) : undefined,
                        })
                      }
                    >
                      <option value="">
                        {hint?.count === undefined ? `Automatic (${sectionSlides})` : 'Automatic'}
                      </option>
                      {Array.from({ length: PRESENTATION_SECTION_SLIDES }, (_, at) => at + 1).map(
                        (count) => (
                          <option key={count} value={count}>
                            {count === 1 ? '1 slide' : `${count} slides`}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                )}
                <label>
                  Layout preference for this section
                  <select
                    value={hint?.layout ?? ''}
                    disabled={locked || !headed}
                    aria-describedby={
                      !headed
                        ? headingNoteId
                        : [hint?.layout && layoutHelpId, rollup?.problem && rollupNoteId]
                            .filter(Boolean)
                            .join(' ') || undefined
                    }
                    onChange={(event) =>
                      setSectionSetting({
                        layout: (event.target.value || undefined) as
                          PresentationBeatLayout | undefined,
                      })
                    }
                  >
                    <option value="">Automatic</option>
                    <option value={AUTHORED_PRESENTATION_LAYOUT}>
                      {layoutLabel(AUTHORED_PRESENTATION_LAYOUT, section.blockId)}
                    </option>
                    {(blockTypes.get(section.blockId)?.drawn ||
                      hint?.layout === FEATURE_PRESENTATION_LAYOUT) && (
                      <option value={FEATURE_PRESENTATION_LAYOUT}>
                        {layoutLabel(FEATURE_PRESENTATION_LAYOUT, section.blockId)}
                      </option>
                    )}
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
                {!perSection && isSummaryPresentationLayout(beat.layout) && (
                  <label>
                    Supporting slides for this section
                    <select
                      value={hint?.inbetweens === undefined ? '' : String(hint.inbetweens)}
                      disabled={locked || !headed}
                      aria-describedby={!headed ? headingNoteId : undefined}
                      onChange={(event) =>
                        setSectionSetting({
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
              {!headed && (
                <p id={headingNoteId} className="squisq-summary-designer-layout-help">
                  This part of the document has no heading to hold section settings. Add a heading
                  above it to choose its layout or how many slides it has.
                </p>
              )}
              {headed && hint?.count !== undefined && isSummaryPresentationLayout(beat.layout) && (
                <p id={countHelpId} className="squisq-summary-designer-layout-help">
                  {`This section is told in ${hint.count === 1 ? 'one slide' : `${hint.count} slides`}, whatever the summary length: its text is divided evenly, and each slide shows the key points of its part.`}
                  {sectionSlides < hint.count &&
                    ` Its text divides into only ${sectionSlides === 1 ? 'one' : sectionSlides}.`}
                </p>
              )}
              {hint?.layout && (
                <p id={layoutHelpId} className="squisq-summary-designer-layout-help">
                  {layoutHelp(
                    hint.layout,
                    hint.layout === FEATURE_PRESENTATION_LAYOUT
                      ? beforeName(section.blockId)
                      : undefined,
                  )}
                </p>
              )}
              {rollup?.problem && (
                <p
                  id={rollupNoteId}
                  className="squisq-summary-designer-layout-help squisq-summary-designer-layout-problem"
                >
                  {rollupProblem(
                    rollup.problem,
                    typeLabel(section.blockId),
                    beforeName(section.blockId),
                  )}
                </p>
              )}
              {titleSlide && (
                <p className="squisq-summary-designer-layout-help">
                  This slide shows the section’s heading while it is read. To change what it says,
                  edit the heading; to leave it out, hide it.
                </p>
              )}
              {isSummaryPresentationLayout(beat.layout) && !titleSlide && (
                <details
                  className="squisq-summary-designer-wording"
                  open={wordingOpen}
                  onToggle={(event) => setWordingOpen(event.currentTarget.open)}
                >
                  <summary>Customize slide wording (slides only)</summary>
                  <p>
                    {keyedWording
                      ? 'This slide can use your wording. It is saved in the document, under the section, and stays with this slide when you change the text. A different summary length makes different slides; your wording waits for this one.'
                      : 'This section’s opening slide can use your wording. It is saved in the document, under the section, and stays when you change the section’s text or the summary length.'}
                    {aiWording &&
                      ' This wording was suggested by AI. Change it and it is yours: suggesting again keeps it.'}
                  </p>
                  {/* Keyed by slide as well: a section's slides often share
                      their headline, and each field shows its own slide. */}
                  <label>
                    Slide headline
                    <input
                      key={`${beat.id}\u0000${beat.headline}`}
                      defaultValue={beat.headline}
                      maxLength={PRESENTATION_LIMITS.headline}
                      disabled={locked}
                      onBlur={(event) => {
                        // Leaving the field unchanged saves nothing.
                        const value = event.target.value.trim();
                        if (value === beat.headline.trim()) return;
                        setSlideWording({ headline: value || undefined });
                      }}
                    />
                  </label>
                  <label>
                    Slide highlights, one per line
                    <textarea
                      rows={3}
                      key={`${beat.id}\u0000${beat.points.join('\n')}`}
                      defaultValue={beat.points.join('\n')}
                      disabled={locked}
                      onBlur={(event) => {
                        const points = event.target.value
                          .split('\n')
                          .map((point) => point.trim())
                          .filter(Boolean);
                        if (points.join('\n') === beat.points.join('\n')) return;
                        setSlideWording({ points });
                      }}
                    />
                  </label>
                  {ownWording && (
                    <button type="button" disabled={locked} onClick={restoreAutomaticWording}>
                      Use automatic wording
                    </button>
                  )}
                </details>
              )}
              <section className="squisq-summary-designer-source" aria-labelledby={originalTextId}>
                <div className="squisq-summary-designer-source-label">
                  <h3 id={originalTextId}>Original block text</h3>
                  <span>Read only</span>
                </div>
                <p>{section.text}</p>
              </section>
            </div>
          </div>
        )}
      </div>
    </Root>
  );
}
