/**
 * Write a Custom summary design into a document's markdown.
 *
 * The design lives where people can see it (see `presentationHintsDoc.ts`):
 * three frontmatter keys, `slideLayout=` / `supportingSlides=` / `slideCount=`
 * on section headings, and a `{[summary]}` accessory block for each designed
 * slide. The density key is left out at the default length, unless the
 * document would then be read at another (it keeps summaries keyed to a
 * passage, which say how long the summary was when they were made).
 * {@link writePresentationHints} makes the document hold a given design with
 * targeted edits:
 *
 * - **Diffs, never rewrites.** A slide design already in the document as the
 *   design wants it is not touched; a changed one has its heading and first
 *   list replaced (anything else in the block stays); a removed one is
 *   deleted with what is under its heading; a new one is added after its
 *   section's own text, before the section's first sub-section. Blocks a
 *   person wrote elsewhere are edited where they are, never moved.
 * - **Readable markdown.** New blocks are built as markdown nodes and
 *   stringified, so headline and point text is escaped correctly.
 * - **Verified.** The result is read back. Anything that did not come back
 *   as written — a headline ending in `{…}`, which markdown reads as heading
 *   attributes, or a section with no heading to hold its settings — is left
 *   out and reported in `rejected`, never written wrong.
 *
 * Writing the design read back from the result changes nothing, and the
 * legacy `squisq-presentation-hints` key is removed by any write.
 */

import type { Block, Doc } from '../schemas/Doc.js';
import { BUILD_PARAM_KEYS, buildSpecParams, type BuildSpec } from '../schemas/Build.js';
import type { MarkdownHeading, MarkdownList } from '../markdown/types.js';
import { parseMarkdown } from '../markdown/parse.js';
import { setFrontmatterValues } from '../markdown/utils.js';
import { minimalSourceTextEdit, type SourceTextEdit } from '../markdown/sourceTextEdits.js';
import { markdownToDoc } from '../doc/markdownToDoc.js';
import { flattenContentBlocks } from '../doc/accessoryBlocks.js';
import {
  accessoryBlockMarkdown,
  openAccessoryBlockSource,
  removeAccessoryBlocks,
  type AccessoryBlockSource,
} from '../doc/accessoryBlockSource.js';
import { presentationBeatExtras } from './presentationPlan.js';
import {
  DEFAULT_PRESENTATION_DENSITY,
  PRESENTATION_HINTS_KEY,
  SUMMARY_ACCESSORY_TYPE,
  SUMMARY_DENSITY_KEY,
  SUMMARY_SECTION_TITLES_KEY,
  SUMMARY_SUPPORTING_SLIDES_KEY,
  canonicalPresentationHints,
  defaultPresentationHints,
  slideHintHasWording,
  type PresentationHints,
  type PresentationSlideHint,
} from './presentationHints.js';
import {
  readPresentationHints,
  type PresentationHintIssue,
  type PresentationHintsRead,
} from './presentationHintsDoc.js';

export interface PresentationHintsWrite {
  /** Edits against the source, ascending and not overlapping. */
  edits: SourceTextEdit[];
  /** The source with the edits applied. */
  result: string;
  /** The design `result` holds, as read back from it. */
  hints: PresentationHints;
  /** What could not be written, and why; the rest was. */
  rejected: PresentationHintIssue[];
}

/** Make `source` hold `hints` (see the module comment). */
export function writePresentationHints(
  source: string,
  hints: PresentationHints,
): PresentationHintsWrite {
  return writeVerified(source, hints, { removeEverySummary: false });
}

/**
 * The automatic design: removes the summary keys, the legacy key, every
 * section's summary settings, and every summary block — including ones the
 * design could not use.
 */
export function resetPresentationHints(source: string): PresentationHintsWrite {
  return writeVerified(source, defaultPresentationHints(), { removeEverySummary: true });
}

/** Remove summary blocks by their accessory block ids (as `readPresentationHints` reports them). */
export function removeSummaryBlocks(
  source: string,
  accessoryBlockIds: readonly string[],
): { edits: SourceTextEdit[]; result: string } {
  return removeAccessoryBlocks(source, accessoryBlockIds, SUMMARY_ACCESSORY_TYPE);
}

// ── The write ───────────────────────────────────────────────────────────

interface WriteOptions {
  removeEverySummary: boolean;
  /** Write the density key even at the default (see `writeVerified`). */
  densityKey?: boolean;
  /** Identities (`slideIdentity`) and section ids left out after a failed first try. */
  skipSlides?: ReadonlySet<string>;
  skipSettings?: ReadonlySet<string>;
}

function writeVerified(
  source: string,
  hints: PresentationHints,
  given: WriteOptions,
): PresentationHintsWrite {
  // The default length needs no key, unless the document would then be read
  // at another: one that keeps a summary keyed to a passage — even one the
  // design cannot use — is read at the older default without it.
  let options: WriteOptions = {
    ...given,
    densityKey: hints.density !== DEFAULT_PRESENTATION_DENSITY,
  };
  let first = writeOnce(source, hints, options);
  if (!options.densityKey && readBack(first.result).density !== hints.density) {
    options = { ...options, densityKey: true };
    first = writeOnce(source, hints, options);
  }
  const failed = verify(hints, first, options);
  if (!failed.slides.size && !failed.settings.size) return finish(first);
  const second = writeOnce(source, hints, {
    ...options,
    skipSlides: failed.slides,
    skipSettings: failed.settings,
  });
  const again = verify(hints, second, {
    ...options,
    skipSlides: failed.slides,
    skipSettings: failed.settings,
  });
  return finish({
    ...second,
    rejected: [...second.rejected, ...failed.issues, ...again.issues],
  });
}

interface WriteAttempt {
  edits: SourceTextEdit[];
  result: string;
  rejected: PresentationHintIssue[];
}

const readBack = (source: string): PresentationHints =>
  readPresentationHints(markdownToDoc(parseMarkdown(source))).hints;

function finish(attempt: WriteAttempt): PresentationHintsWrite {
  return { ...attempt, hints: readBack(attempt.result) };
}

const slideIdentity = (blockId: string, passage: string | undefined) =>
  `${blockId}\u0000${passage ?? ''}`;

/** A slide design as it compares: a hidden slide's lone heading is its label either way. */
function comparable(slide: PresentationSlideHint): string {
  const { label: _label, ...rest } = slide;
  void _label;
  const labelOnly =
    rest.hidden && !rest.origin && rest.points === undefined && rest.layout === undefined;
  const { headline: _headline, ...withoutHeadline } = rest;
  void _headline;
  return JSON.stringify(
    canonicalPresentationHints({
      version: 1,
      density: 'balanced',
      inbetweens: true,
      blocks: [{ blockId: 'x', slides: [labelOnly ? withoutHeadline : rest] }],
    }).blocks[0]?.slides?.[0] ?? {},
  );
}

/** What did not come back as written. */
function verify(
  hints: PresentationHints,
  attempt: WriteAttempt,
  options: WriteOptions,
): { slides: Set<string>; settings: Set<string>; issues: PresentationHintIssue[] } {
  const back = readBack(attempt.result);
  const slides = new Set<string>();
  const settings = new Set<string>();
  const issues: PresentationHintIssue[] = [];
  const backBlock = (blockId: string) => back.blocks.find((block) => block.blockId === blockId);
  for (const block of hints.blocks) {
    const read = backBlock(block.blockId);
    if (
      !options.skipSettings?.has(block.blockId) &&
      (read?.layout !== block.layout ||
        read?.inbetweens !== block.inbetweens ||
        read?.count !== block.count) &&
      !attempt.rejected.some((issue) => issue.blockId === block.blockId && !issue.passage)
    ) {
      settings.add(block.blockId);
      issues.push({
        code: 'setting-invalid',
        message: 'This section’s summary settings could not be written to its heading.',
        blockId: block.blockId,
      });
    }
    for (const slide of block.slides ?? []) {
      const identity = slideIdentity(block.blockId, slide.passage);
      if (options.skipSlides?.has(identity)) continue;
      if (
        attempt.rejected.some(
          (issue) => issue.blockId === block.blockId && issue.passage === slide.passage,
        )
      )
        continue;
      const found = read?.slides?.find((item) => item.passage === slide.passage);
      if (found && comparable(found) === comparable(slide)) continue;
      slides.add(identity);
      issues.push({
        code: 'summary-invalid',
        message:
          slide.headline && /\{[^}]*\}\s*$/u.test(slide.headline)
            ? 'A headline cannot end in {…}: markdown reads that as heading settings.'
            : 'This summary could not be written as given.',
        blockId: block.blockId,
        ...(slide.passage ? { passage: slide.passage } : {}),
      });
    }
  }
  return { slides, settings, issues };
}

function writeOnce(source: string, hints: PresentationHints, options: WriteOptions): WriteAttempt {
  const context = parseContext(source);
  const { doc, read } = context;
  const edits: SourceTextEdit[] = [];
  const rejected: PresentationHintIssue[] = [];

  // Document settings: plain frontmatter keys, the legacy JSON key removed.
  const withKeys = setFrontmatterValues(source, {
    [SUMMARY_DENSITY_KEY]: options.densityKey ? hints.density : null,
    [SUMMARY_SUPPORTING_SLIDES_KEY]: hints.inbetweens ? null : false,
    [SUMMARY_SECTION_TITLES_KEY]: hints.sectionTitles ? true : null,
    [PRESENTATION_HINTS_KEY]: null,
  });
  const frontmatter = minimalSourceTextEdit(source, withKeys);
  if (frontmatter) {
    const text = context.toEol(frontmatter.text);
    // Keys are written with "\n". In a "\r\n" document the edit can end on the
    // "\r" of a line ending whose "\n" was unchanged; that "\r" stays.
    const swallowed =
      frontmatter.end > frontmatter.start &&
      source[frontmatter.end - 1] === '\r' &&
      source[frontmatter.end] === '\n' &&
      !text.endsWith('\r');
    edits.push({ ...frontmatter, end: frontmatter.end - (swallowed ? 1 : 0), text });
  }

  // Section settings, on each section's heading tag.
  const wanted = new Map(
    hints.blocks
      .filter((block) => !options.skipSettings?.has(block.blockId))
      .map((block) => [block.blockId, block]),
  );
  const contentIds = new Set<string>();
  for (const block of flattenContentBlocks(doc.blocks)) {
    contentIds.add(block.id);
    // A section whose settings failed to write keeps the ones it has.
    if (options.skipSettings?.has(block.id)) continue;
    const hint = wanted.get(block.id);
    const updates: Record<string, string | null> = {};
    if (hint?.layout !== block.slideLayout) updates.slideLayout = hint?.layout ?? null;
    if (hint?.inbetweens !== block.supportingSlides)
      updates.supportingSlides = hint?.inbetweens === undefined ? null : String(hint.inbetweens);
    if (hint?.count !== block.slideCount)
      updates.slideCount = hint?.count === undefined ? null : String(hint.count);
    if (hint?.build && !sameBuild(hint.build, block.build)) {
      for (const key of BUILD_PARAM_KEYS) updates[key] = null;
      Object.assign(updates, buildSpecParams(hint.build));
    }
    if (!Object.keys(updates).length) continue;
    const edit = context.headingEdit(block, updates);
    if (edit) {
      edits.push(edit);
    } else {
      rejected.push({
        code: 'setting-invalid',
        message: block.sourceHeading
          ? 'This section’s heading cannot hold summary settings; write it as a single-line # heading.'
          : 'This part of the document has no heading to hold summary settings.',
        blockId: block.id,
      });
    }
  }
  for (const hint of wanted.values()) {
    if (
      (hint.layout !== undefined || hint.inbetweens !== undefined || hint.count !== undefined) &&
      !contentIds.has(hint.blockId)
    )
      rejected.push({
        code: 'setting-invalid',
        message: 'The section these summary settings are for is not in the document.',
        blockId: hint.blockId,
      });
  }

  // Slide designs: summary blocks.
  const desired = new Map<string, { blockId: string; slide: PresentationSlideHint }>();
  for (const hint of hints.blocks) {
    for (const slide of hint.slides ?? []) {
      const identity = slideIdentity(hint.blockId, slide.passage);
      if (!options.skipSlides?.has(identity))
        desired.set(identity, { blockId: hint.blockId, slide });
    }
  }
  const current = new Map<string, { block: Block; slide: PresentationSlideHint }>();
  for (const entry of read.entries) {
    const block = context.byId.get(entry.accessoryBlockId);
    const slide = read.hints.blocks
      .find((hint) => hint.blockId === entry.blockId)
      ?.slides?.find((item) => item.passage === entry.passage);
    if (block && slide) current.set(slideIdentity(entry.blockId, entry.passage), { block, slide });
  }

  const kept = new Set<Block>();
  for (const [identity, { block, slide }] of current) {
    // A slide whose design failed to write keeps the block it has.
    if (options.skipSlides?.has(identity)) {
      kept.add(block);
      continue;
    }
    const want = desired.get(identity);
    if (!want) continue;
    kept.add(block);
    if (comparable(want.slide) === comparable(slide)) continue;
    edits.push(...context.rewrite(block, want.slide));
  }
  for (const block of context.summaries) {
    if (kept.has(block)) continue;
    // Blocks the design cannot use (duplicates, typos) stay until reset.
    const inUse = [...current.values()].some((item) => item.block === block);
    if (!inUse && !options.removeEverySummary) continue;
    const edit = context.deletion(block);
    if (edit) edits.push(edit);
  }

  const additions = new Map<string, Array<{ passage?: string; slide: PresentationSlideHint }>>();
  for (const [identity, { blockId, slide }] of desired) {
    if (current.has(identity)) continue;
    if (!contentIds.has(blockId)) {
      rejected.push({
        code: 'summary-no-section',
        message: 'The section this summary is for is not in the document.',
        blockId,
        ...(slide.passage ? { passage: slide.passage } : {}),
      });
      continue;
    }
    const list = additions.get(blockId) ?? [];
    list.push({ ...(slide.passage ? { passage: slide.passage } : {}), slide });
    additions.set(blockId, list);
  }
  for (const [blockId, slides] of additions) {
    const placed = context.addition(blockId, slides);
    if (placed.edits.length) edits.push(...placed.edits);
    rejected.push(...placed.rejected);
  }

  return { ...context.located.finish(edits), rejected };
}

function sameBuild(a: BuildSpec, b: BuildSpec | undefined): boolean {
  return !!b && JSON.stringify(buildSpecParams(a)) === JSON.stringify(buildSpecParams(b));
}

// ── The document, located ───────────────────────────────────────────────

interface ParseContext {
  located: AccessoryBlockSource;
  doc: Doc;
  /** Text with this document's line endings. */
  toEol(text: string): string;
  read: PresentationHintsRead;
  byId: ReadonlyMap<string, Block>;
  /** Every summary accessory block (not nested parts), in document order. */
  summaries: Block[];
  headingEdit(block: Block, updates: Record<string, string | null>): SourceTextEdit | null;
  deletion(block: Block): SourceTextEdit | null;
  rewrite(block: Block, slide: PresentationSlideHint): SourceTextEdit[];
  addition(
    blockId: string,
    slides: Array<{ passage?: string; slide: PresentationSlideHint }>,
  ): { edits: SourceTextEdit[]; rejected: PresentationHintIssue[] };
}

function parseContext(source: string): ParseContext {
  const located = openAccessoryBlockSource(source);
  const { doc, nodes, toEol } = located;
  const read = readPresentationHints(doc);
  const startOf = (node: { position?: { start: { offset?: number } } }) =>
    node.position?.start.offset ?? -1;
  const endOf = (node: { position?: { end: { offset?: number } } }) =>
    node.position?.end.offset ?? -1;

  function rewrite(block: Block, slide: PresentationSlideHint): SourceTextEdit[] {
    const index = located.headingIndex(block);
    const heading = nodes[index] as MarkdownHeading | undefined;
    if (!heading?.position) return [];
    const edits: SourceTextEdit[] = [];
    const owner = block.accessoryBlock?.of;
    const naturalOwner = located.ownerAt(index, heading.depth);
    const text = slideMarkdown(heading.depth, slide, owner !== naturalOwner ? owner : undefined);
    const changed = (start: number, end: number, next: string) => {
      if (source.slice(start, end) !== next) edits.push({ start, end, text: next });
    };
    changed(startOf(heading), endOf(heading), toEol(text.heading));
    // The block's own body runs to the next heading of any depth; its first list holds the points.
    let listIndex = -1;
    for (let i = index + 1; i < nodes.length && nodes[i]!.type !== 'heading'; i++) {
      if (nodes[i]!.type === 'list') {
        listIndex = i;
        break;
      }
    }
    if (listIndex >= 0) {
      const list = nodes[listIndex]!;
      if (text.list) {
        changed(startOf(list), endOf(list), toEol(text.list));
      } else {
        edits.push({ start: endOf(nodes[listIndex - 1]!), end: endOf(list), text: '' });
      }
    } else if (text.list) {
      edits.push({ start: endOf(heading), end: endOf(heading), text: toEol(`\n\n${text.list}`) });
    }
    return edits;
  }

  function addition(
    blockId: string,
    slides: Array<{ passage?: string; slide: PresentationSlideHint }>,
  ): { edits: SourceTextEdit[]; rejected: PresentationHintIssue[] } {
    const zone = located.zone(blockId, SUMMARY_ACCESSORY_TYPE);
    if (!zone) return { edits: [], rejected: [] };
    // The opening slide's summary first; the rest after the summaries already there.
    const edits: SourceTextEdit[] = [];
    const place = (at: number, group: typeof slides) => {
      if (!group.length) return;
      const edit = located.insertion(at, zone.depth, blockId, (of) =>
        group.map((item) => {
          const text = slideMarkdown(zone.depth, item.slide, of);
          return text.list ? `${text.heading}\n\n${text.list}` : text.heading;
        }),
      );
      if (edit) edits.push(edit);
    };
    place(
      zone.start,
      slides.filter((item) => item.passage === undefined),
    );
    place(
      zone.end,
      slides.filter((item) => item.passage !== undefined),
    );
    return { edits, rejected: [] };
  }

  return {
    located,
    doc,
    read,
    byId: located.byId,
    summaries: located.blocks(SUMMARY_ACCESSORY_TYPE),
    toEol,
    headingEdit: located.headingEdit,
    deletion: located.deletion,
    rewrite,
    addition,
  };
}

// ── Building a block ───────────────────────────────────────────────────

const PARAM_ORDER = [
  'passage',
  'at',
  'length',
  'origin',
  'layout',
  'center',
  'xAxis',
  'yAxis',
  'hidden',
] as const;

/** A summary block's heading line and its list, as markdown. */
function slideMarkdown(
  depth: number,
  slide: PresentationSlideHint,
  owner: string | undefined,
): { heading: string; list?: string } {
  const params: Record<string, string> = {};
  const extras = slide.layout ? presentationBeatExtras(slide.layout, slide) : {};
  const values: Record<(typeof PARAM_ORDER)[number], string | undefined> = {
    passage: slide.passage,
    at: slide.passage !== undefined && slide.at !== undefined ? String(slide.at) : undefined,
    length: slide.passage !== undefined ? slide.length : undefined,
    origin: slide.origin,
    layout: slide.layout,
    center: extras.center,
    xAxis: extras.xAxis,
    yAxis: extras.yAxis,
    hidden: slide.hidden ? 'true' : undefined,
  };
  for (const key of PARAM_ORDER) if (values[key] !== undefined) params[key] = values[key]!;
  if (slide.points && slide.points.length === 0) params.points = 'none';

  const labelOnly = slide.hidden && !slideHintHasWording(slide);
  const title = labelOnly
    ? (slide.label ?? slide.headline ?? 'Hidden slide')
    : (slide.headline ?? '');
  const list: MarkdownList | undefined = slide.points?.length
    ? {
        type: 'list',
        ordered: false,
        spread: false,
        children: slide.points.map((point) => ({
          type: 'listItem',
          spread: false,
          children: [{ type: 'paragraph', children: [{ type: 'text', value: point }] }],
        })),
      }
    : undefined;
  const written = accessoryBlockMarkdown({
    type: SUMMARY_ACCESSORY_TYPE,
    depth,
    title,
    params,
    ...(owner ? { of: owner } : {}),
    ...(list ? { body: [list] } : {}),
  });
  return { heading: written.heading, ...(written.body ? { list: written.body } : {}) };
}
