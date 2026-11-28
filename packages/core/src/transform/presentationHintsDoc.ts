/**
 * The Custom summary design, read from the document itself.
 *
 * The design lives in the markdown where people can see it:
 *
 * - **Document settings** are frontmatter keys: `squisq-summary-density`
 *   (how long the summary is), `squisq-summary-supporting-slides`, and
 *   `squisq-summary-section-titles` (each section opens on a slide of its
 *   heading). Without the first, a document is
 *   summarized as key points — unless it holds a summary keyed to a passage
 *   (`passage=`). Those are written with their density, so one without the
 *   key was made when `balanced` was the default and is read that way, which
 *   keeps the slides its summaries were made for.
 * - **Section settings** are on the section's heading tag:
 *   `## Results {[slideLayout=cards supportingSlides=false slideCount=2]}`.
 * - **Slide designs** are `{[summary]}` accessory blocks under the section.
 *   The heading is the slide's headline and the first list its points:
 *
 *   ```markdown
 *   ### Revenue grew 40% {[summary]}
 *
 *   - Most of it came from new customers
 *
 *   ### Next year's plan {[summary passage=1x2y3z-2f origin=ai layout=steps]}
 *
 *   - Hire
 *   - Ship
 *
 *   ### Older results {[summary passage=9k2j1a-3c hidden=true]}
 *   ```
 *
 *   No `passage`: the section's opening slide, whatever its text now says.
 *   `passage=<key>`: the slide made from exactly that passage; when no slide
 *   is, the block is kept but not in use. `origin=ai`: suggested by AI (your
 *   own wording wins over it). `points=none`: no points. `hidden=true`: left
 *   out of the deck.
 *
 * Documents written before this keep their design as JSON in the legacy
 * `squisq-presentation-hints` key; it is read when the document has none of
 * the above, and replaced the first time the design changes.
 *
 * Reading is lenient: a summary block that cannot be used (an unknown
 * layout, a headline too long to set) is left out and reported in `issues`;
 * it never invalidates the rest of the design.
 */

import type { Block, Doc } from '../schemas/Doc.js';
import type { MarkdownBlockNode, MarkdownList } from '../markdown/types.js';
import { extractPlainText } from '../markdown/utils.js';
import { collectAccessoryBlocks, flattenContentBlocks } from '../doc/accessoryBlocks.js';
import { buildNarrationScript } from '../narration/script.js';
import {
  PRESENTATION_LAYOUTS,
  PRESENTATION_LIMITS,
  presentationBeatExtras,
  type PresentationLayout,
  type PresentationPlan,
} from './presentationPlan.js';
import { bindPresentationDesigns, presentationSlideStarts } from './presentationPlanner.js';
import {
  LEGACY_PRESENTATION_DENSITY,
  PRESENTATION_DENSITIES,
  PRESENTATION_DENSITY_LABELS,
  PRESENTATION_HINTS_KEY,
  SUMMARY_ACCESSORY_TYPE,
  SUMMARY_DENSITY_KEY,
  SUMMARY_SECTION_TITLES_KEY,
  SUMMARY_SUPPORTING_SLIDES_KEY,
  defaultPresentationHints,
  PRESENTATION_SECTION_SLIDES,
  isPresentationDensity,
  isPresentationPassageKey,
  isSectionSlideCount,
  isSlideStart,
  parsePresentationHints,
  presentationPassageKey,
  presentationSections,
  presentationSlideKey,
  slideHintHasWording,
  type PresentationBlockHint,
  type PresentationHints,
  type PresentationSlideHint,
} from './presentationHints.js';

/** Something in the design that is not used, and why. */
export interface PresentationHintIssue {
  code:
    | 'summary-no-owner'
    | 'summary-duplicate'
    | 'summary-invalid'
    | 'summary-not-in-use'
    | 'summary-other-length'
    | 'summary-needs-picture'
    | 'summary-no-section'
    | 'setting-invalid'
    | 'legacy-ignored'
    | 'legacy-invalid';
  /** Says what is wrong in plain words. */
  message: string;
  /** The summary accessory block concerned, when there is one. */
  accessoryBlockId?: string;
  /** The section the design is about. */
  blockId?: string;
  /** The slide's passage key, for a keyed summary. */
  passage?: string;
  /** Source line of the summary block's heading. */
  line?: number;
}

/** Where one slide design in `hints` came from. */
export interface PresentationHintEntry {
  /** The summary accessory block. */
  accessoryBlockId: string;
  /** The section it is about. */
  blockId: string;
  /** Its passage key; absent for a section's opening slide. */
  passage?: string;
  /** Source line of its heading. */
  line?: number;
}

export interface PresentationHintsRead {
  /** The design: what the planner applies and the designer shows. */
  hints: PresentationHints;
  /**
   * Where the design came from: the document's summary blocks and settings,
   * the legacy JSON key, or nowhere (the default design).
   */
  format: 'blocks' | 'legacy' | 'none';
  /** The legacy key is present but unreadable. */
  legacyInvalid?: true;
  /** Each summary block read into `hints`. */
  entries: PresentationHintEntry[];
  /** What could not be used, and why. */
  issues: PresentationHintIssue[];
}

/** Whether the document holds its design in the new form (blocks, settings, keys). */
function hasBlockDesign(doc: Doc, summaries: Block[]): boolean {
  const fm = doc.frontmatter ?? {};
  return (
    summaries.length > 0 ||
    Object.prototype.hasOwnProperty.call(fm, SUMMARY_DENSITY_KEY) ||
    Object.prototype.hasOwnProperty.call(fm, SUMMARY_SUPPORTING_SLIDES_KEY) ||
    Object.prototype.hasOwnProperty.call(fm, SUMMARY_SECTION_TITLES_KEY) ||
    flattenContentBlocks(doc.blocks).some(
      (block) =>
        block.slideLayout !== undefined ||
        block.supportingSlides !== undefined ||
        block.slideCount !== undefined,
    )
  );
}

/** The document's Custom summary design. */
export function readPresentationHints(doc: Doc): PresentationHintsRead {
  const summaries = collectAccessoryBlocks(doc.blocks).filter(
    (block) => block.accessoryBlock?.type === SUMMARY_ACCESSORY_TYPE,
  );
  const fm = doc.frontmatter ?? {};
  const hasLegacy = Object.prototype.hasOwnProperty.call(fm, PRESENTATION_HINTS_KEY);
  const issues: PresentationHintIssue[] = [];

  if (!hasBlockDesign(doc, summaries)) {
    if (!hasLegacy) {
      return { hints: defaultPresentationHints(), format: 'none', entries: [], issues };
    }
    const legacy = parsePresentationHints(fm[PRESENTATION_HINTS_KEY]);
    if (!legacy) {
      issues.push({
        code: 'legacy-invalid',
        message: 'The saved slide design is unreadable, so the automatic design is used.',
      });
      return {
        hints: defaultPresentationHints(),
        format: 'legacy',
        legacyInvalid: true,
        entries: [],
        issues,
      };
    }
    return { hints: legacy, format: 'legacy', entries: [], issues };
  }

  if (hasLegacy) {
    issues.push({
      code: 'legacy-ignored',
      message:
        'The document has an older saved slide design as well as summaries; the summaries are used.',
    });
  }

  // Summaries keyed to a passage are written with their density; ones
  // without the key were made when `balanced` was the default, and only that
  // length makes the slides they are keyed to.
  const hints = defaultPresentationHints();
  if (summaries.some((summary) => summary.templateOverrides?.passage !== undefined))
    hints.density = LEGACY_PRESENTATION_DENSITY;
  const density = fm[SUMMARY_DENSITY_KEY];
  if (density !== undefined) {
    if (isPresentationDensity(density)) {
      hints.density = density;
    } else {
      issues.push({
        code: 'setting-invalid',
        message: `The summary density "${String(density)}" is not one of ${PRESENTATION_DENSITIES.slice(0, -1).join(', ')} or ${PRESENTATION_DENSITIES[PRESENTATION_DENSITIES.length - 1]}.`,
      });
    }
  }
  const supporting = fm[SUMMARY_SUPPORTING_SLIDES_KEY];
  if (supporting !== undefined) {
    if (supporting === false || supporting === 'false') hints.inbetweens = false;
    else if (supporting !== true && supporting !== 'true')
      issues.push({
        code: 'setting-invalid',
        message: `Supporting slides is "${String(supporting)}"; use true or false.`,
      });
  }
  const titles = fm[SUMMARY_SECTION_TITLES_KEY];
  if (titles !== undefined) {
    if (titles === true || titles === 'true') hints.sectionTitles = true;
    else if (titles !== false && titles !== 'false')
      issues.push({
        code: 'setting-invalid',
        message: `Section title slides is "${String(titles)}"; use true or false.`,
      });
  }

  const sections = new Map<string, PresentationBlockHint>();
  const section = (blockId: string): PresentationBlockHint => {
    let hint = sections.get(blockId);
    if (!hint) {
      hint = { blockId };
      sections.set(blockId, hint);
    }
    return hint;
  };
  for (const block of flattenContentBlocks(doc.blocks)) {
    if (block.slideLayout !== undefined) section(block.id).layout = block.slideLayout;
    if (block.supportingSlides !== undefined) section(block.id).inbetweens = block.supportingSlides;
    if (block.slideCount !== undefined) {
      if (isSectionSlideCount(block.slideCount)) section(block.id).count = block.slideCount;
      else
        issues.push({
          code: 'setting-invalid',
          message: `A section is told in 1 to ${PRESENTATION_SECTION_SLIDES} slides; slideCount=${block.slideCount} is not used.`,
          blockId: block.id,
        });
    }
  }

  const entries: PresentationHintEntry[] = [];
  for (const summary of summaries) {
    const line = summary.sourceHeading?.position?.start.line;
    const where = {
      accessoryBlockId: summary.id,
      ...(line !== undefined ? { line } : {}),
    };
    const owner = summary.accessoryBlock?.of;
    if (!owner) {
      issues.push({
        code: 'summary-no-owner',
        message:
          'This summary is at the top of the document, which has no text before its first heading to summarize.',
        ...where,
      });
      continue;
    }
    const read = readSlideHint(summary);
    if (typeof read === 'string') {
      issues.push({ code: 'summary-invalid', message: read, blockId: owner, ...where });
      continue;
    }
    const hint = section(owner);
    const slides = (hint.slides ??= []);
    if (slides.some((slide) => slide.passage === read.passage)) {
      issues.push({
        code: 'summary-duplicate',
        message: read.passage
          ? 'Another summary above already designs this slide; this one is not used.'
          : 'Another summary above already words this section’s opening slide; this one is not used.',
        blockId: owner,
        ...(read.passage ? { passage: read.passage } : {}),
        ...where,
      });
      continue;
    }
    if (slides.length >= PRESENTATION_LIMITS.beats) {
      issues.push({
        code: 'summary-invalid',
        message: `A section holds at most ${PRESENTATION_LIMITS.beats} summaries.`,
        blockId: owner,
        ...where,
      });
      continue;
    }
    slides.push(read);
    entries.push({
      accessoryBlockId: summary.id,
      blockId: owner,
      ...(read.passage ? { passage: read.passage } : {}),
      ...(line !== undefined ? { line } : {}),
    });
  }

  hints.blocks = [...sections.values()].filter((hint) => Object.keys(hint).length > 1);
  return { hints, format: 'blocks', entries, issues };
}

/** The design in the document (see `readPresentationHints`). */
export function presentationHintsFromDoc(doc: Doc): PresentationHints {
  return readPresentationHints(doc).hints;
}

/** One summary block as a slide design, or why it cannot be used. */
function readSlideHint(block: Block): PresentationSlideHint | string {
  const params = block.templateOverrides ?? {};
  const slide: PresentationSlideHint = {};

  if (params.passage !== undefined) {
    if (!isPresentationPassageKey(params.passage))
      return `"${params.passage}" is not a slide's passage key, so this summary matches no slide.`;
    slide.passage = params.passage;
  }
  if (params.at !== undefined) {
    const at = /^\d+$/u.test(params.at) ? Number(params.at) : NaN;
    if (!isSlideStart(at))
      return `at=${params.at} is not a sentence of the section; use a whole number.`;
    if (slide.passage !== undefined) slide.at = at;
  }
  if (params.length !== undefined) {
    if (!isPresentationDensity(params.length))
      return `length=${params.length} is not one of ${PRESENTATION_DENSITIES.join(', ')}.`;
    if (slide.passage !== undefined) slide.length = params.length;
  }
  if (params.origin !== undefined && params.origin !== 'ai')
    return `The origin "${params.origin}" is not known; use origin=ai or leave it out.`;
  if (params.origin === 'ai') slide.origin = 'ai';
  if (params.hidden !== undefined && params.hidden !== 'true' && params.hidden !== 'false')
    return `hidden=${params.hidden} is not true or false.`;
  if (params.hidden === 'true') slide.hidden = true;
  if (params.layout !== undefined) {
    if (!PRESENTATION_LAYOUTS.includes(params.layout as PresentationLayout))
      return `"${params.layout}" is not a slide layout.`;
    slide.layout = params.layout as PresentationLayout;
    Object.assign(slide, presentationBeatExtras(slide.layout, params));
  }

  let points: string[] | undefined;
  if (params.points !== undefined) {
    if (params.points !== 'none') return `points=${params.points} is not known; use points=none.`;
    points = [];
  } else {
    const list = (block.contents ?? []).find(
      (node: MarkdownBlockNode): node is MarkdownList => node.type === 'list',
    );
    if (list) points = list.children.map((item) => spaced(extractPlainText(item))).filter(Boolean);
  }
  if (points !== undefined) {
    if (points.length > PRESENTATION_LIMITS.points)
      return `A slide shows at most ${PRESENTATION_LIMITS.points} points; this summary lists ${points.length}.`;
    const long = points.find((point) => point.length > PRESENTATION_LIMITS.point);
    if (long)
      return `A point is at most ${PRESENTATION_LIMITS.point} characters; "${long.slice(0, 40)}…" is longer.`;
    slide.points = points;
  }

  const heading = spaced(block.title ?? '');
  // A hidden slide's block with nothing else set only names the slide.
  const labelOnly = slide.hidden && !slideHintHasWording(slide);
  if (heading) {
    if (labelOnly) {
      slide.label = heading.slice(0, 1024);
    } else {
      if (heading.length > PRESENTATION_LIMITS.headline)
        return `A headline is at most ${PRESENTATION_LIMITS.headline} characters; this one has ${heading.length}.`;
      slide.headline = heading;
    }
  }
  return slide;
}

const spaced = (text: string) => text.replace(/\s+/gu, ' ').trim();

/**
 * The summaries the plan cannot use. A slide summary keeps its slide when the
 * text changes (`bindPresentationDesigns`), so these are only: one whose
 * section makes fewer slides now than it has summaries, one made at another
 * summary length (it applies again at that length), an AI picture slide on a
 * slide without a picture, and a summary whose section is not narrated.
 */
export function presentationHintUsage(
  doc: Doc,
  plan: PresentationPlan,
  read: PresentationHintsRead = readPresentationHints(doc),
): PresentationHintIssue[] {
  const script = buildNarrationScript(doc);
  const sections = new Map(script.blocks.map((block) => [block.blockId, block]));
  const binding = bindPresentationDesigns(plan, presentationSections(doc), read.hints);
  const boundTo = new Map([...binding.slides].map(([index, slide]) => [slide, index]));
  const issues: PresentationHintIssue[] = [];
  for (const entry of read.entries) {
    const section = sections.get(entry.blockId);
    const where = {
      accessoryBlockId: entry.accessoryBlockId,
      blockId: entry.blockId,
      ...(entry.passage ? { passage: entry.passage } : {}),
      ...(entry.line !== undefined ? { line: entry.line } : {}),
    };
    if (!section) {
      issues.push({
        code: 'summary-no-section',
        message: 'This summary is about a part of the document that has no slides.',
        ...where,
      });
      continue;
    }
    if (!entry.passage) continue;
    const slide = read.hints.blocks
      .find((hint) => hint.blockId === entry.blockId)
      ?.slides?.find((item) => item.passage === entry.passage);
    if (!slide) continue;
    const waiting = binding.waiting.find((item) => item.slide === slide);
    if (waiting) {
      // A hidden title slide while there are none hides nothing, and says so to no one.
      if (waiting.reason === 'length' && slide.length)
        issues.push({
          code: 'summary-other-length',
          message: `Made for the “${PRESENTATION_DENSITY_LABELS[slide.length].label}” summary length; it applies again when the document is summarized at that length.`,
          ...where,
        });
      continue;
    }
    const index = boundTo.get(slide);
    if (index === undefined) {
      const fewer = binding.leftover.some(
        (item) => item.slide === slide && item.reason === 'fewer',
      );
      issues.push({
        code: 'summary-not-in-use',
        message: fewer
          ? 'Its section makes fewer slides now than it has summaries, so this one has no slide. It applies again if the section makes more.'
          : 'No slide is made from this summary’s passage now, and it was saved before summaries recorded where their slide begins.',
        ...where,
      });
      continue;
    }
    if (slide.layout === 'image' && !plan.beats[index]!.imageSrc) {
      issues.push({
        code: 'summary-needs-picture',
        message: 'This summary shows a picture, and its slide has none now.',
        ...where,
      });
    }
  }
  return issues;
}

/**
 * The design as summary blocks would hold it, keeping only what applies to
 * `plan` — how a legacy design converts the first time it changes. Legacy
 * wording is kept while its section still reads as it did; an AI suggestion
 * or a hidden slide while a slide of the plan is made from its passage.
 * Section and document settings are kept as they are.
 */
export function presentationHintsForPlan(
  doc: Doc,
  hints: PresentationHints,
  plan: PresentationPlan,
): PresentationHints {
  const script = buildNarrationScript(doc);
  const starts = presentationSlideStarts(plan, presentationSections(doc));
  const blocks: PresentationBlockHint[] = [];
  for (const hint of hints.blocks) {
    const section = script.blocks.find((block) => block.blockId === hint.blockId);
    const out: PresentationBlockHint = { blockId: hint.blockId };
    if (hint.layout !== undefined) out.layout = hint.layout;
    if (hint.inbetweens !== undefined) out.inbetweens = hint.inbetweens;
    if (hint.count !== undefined) out.count = hint.count;
    // A legacy section build becomes the section heading's own `build=` setting.
    if (hint.build !== undefined) out.build = hint.build;
    const keys = new Map<string, { headline: string; at?: number }>();
    if (section) {
      for (const [index, beat] of plan.beats.entries()) {
        if (beat.sourceStart < section.charStart || beat.sourceStart >= section.charEnd) continue;
        const at = starts[index];
        keys.set(presentationSlideKey(plan, index), {
          headline: beat.headline,
          ...(at !== undefined ? { at } : {}),
        });
      }
    }
    const slides = new Map<string, PresentationSlideHint>();
    for (const slide of hint.slides ?? []) {
      if (slide.passage === undefined ? section : keys.has(slide.passage))
        slides.set(slide.passage ?? '', { ...slide });
    }
    if (
      section &&
      hint.wording &&
      !slides.has('') &&
      hint.wording.source === script.sourceText.slice(section.charStart, section.charEnd)
    ) {
      slides.set('', {
        ...(hint.wording.headline !== undefined ? { headline: hint.wording.headline } : {}),
        ...(hint.wording.points !== undefined ? { points: [...hint.wording.points] } : {}),
      });
    }
    for (const suggestion of hint.ai ?? []) {
      const key = presentationPassageKey(suggestion.source);
      if (!keys.has(key) || slides.has(key)) continue;
      slides.set(key, {
        passage: key,
        origin: 'ai',
        layout: suggestion.layout,
        headline: suggestion.headline,
        points: [...suggestion.points],
        ...presentationBeatExtras(suggestion.layout, suggestion),
      });
    }
    for (const key of hint.hidden ?? []) {
      const beat = keys.get(key);
      if (!beat) continue;
      const existing = slides.get(key);
      slides.set(
        key,
        existing
          ? { ...existing, hidden: true }
          : { passage: key, hidden: true, label: beat.headline },
      );
    }
    // Each keyed summary records where its slide begins, so it keeps it when
    // the text changes.
    if (slides.size)
      out.slides = [...slides.values()].map((slide) => {
        const at = slide.passage !== undefined ? keys.get(slide.passage)?.at : undefined;
        return at !== undefined ? { ...slide, at } : slide;
      });
    if (Object.keys(out).length > 1) blocks.push(out);
  }
  return {
    version: 1,
    density: hints.density,
    inbetweens: hints.inbetweens,
    ...(hints.sectionTitles ? { sectionTitles: true } : {}),
    blocks,
  };
}
