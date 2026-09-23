/**
 * Narrated Segment Transformation
 *
 * Converts a narrated text segment and its media into a timed Doc using the
 * canonical squisq transform pipeline. This is the reusable bridge for hosts
 * that generate one visual sequence per narration segment.
 *
 * Pacing: a narrated segment is a single source block, so the text transform
 * alone promotes only one or two extractions — a 60s segment would become one
 * 60s slide, which timed players (`expandDocBlocks`) then split into repeated
 * copies of that same slide. `paceSegment()` restores a visual rhythm: it aims
 * for `slidesPerMinute`, places up to `maxVideos` clips, and fills the rest
 * with standalone image slides until no slide runs past `maxSlideDuration`
 * (or the images run out). Image-poor segments get more text slides instead:
 * their narration is split into sentence runs, one source block each, since
 * the transform promotes at most one extraction per type from a block.
 *
 * The output timeline is sequential and unanchored: content blocks are ORDERED
 * by where their extraction is spoken, but carry no `sourceStartTime`. When a
 * segment mixes anchored and floating blocks, `expandDocBlocks()` hoists every
 * anchored block ahead of the floating ones and stretches whatever precedes
 * the first anchor (typically a host's section header), so a fully sequential
 * segment is the only shape that survives re-timing by hosts and players.
 *
 * Block ids are prefixed with the segment id so segments composed into one
 * Doc never collide (the transform itself numbers from `transform-0`).
 */

import type { Doc } from '../schemas/Doc.js';
import type {
  ImageWithCaptionInput,
  TemplateBlock,
  TitleBlockInput,
  VideoWithCaptionInput,
} from '../schemas/BlockTemplates.js';
import { markdownToDoc } from '../doc/markdownToDoc.js';
import { parseMarkdown } from '../markdown/parse.js';
import { hashString, SeededRandom } from '../random/SeededRandom.js';
import { applyTransform } from './applyTransform.js';
import { allocateTiming } from './timingAllocator.js';
import type {
  TransformImage,
  TransformOptions,
  TransformResult,
  TransformStyleInput,
} from './types.js';

export interface NarratedSegmentVideo {
  src: string;
  posterSrc?: string;
  alt?: string;
  clipStart: number;
  clipEnd: number;
  sourceDuration?: number;
  credit?: string;
  license?: string;
}

export interface NarratedSegmentInput {
  articleId: string;
  segmentId: string;
  title: string;
  text: string;
  duration: number;
  audioSrc: string;
  audioName?: string;
  images?: TransformImage[];
  videos?: NarratedSegmentVideo[];
  includeTitleBlock?: boolean;
}

export interface NarratedSegmentTransformOptions extends Pick<
  TransformOptions,
  'themeId' | 'registry'
> {
  style?: TransformStyleInput;
  seed?: number;
  minConfidence?: number;
  /**
   * Visual pace target. Also caps the text transform's promotions when set.
   * Pacing defaults to 5 when omitted.
   */
  slidesPerMinute?: number;
  /** Longest a slide should hold before another visual is added. Default 15s. */
  maxSlideDuration?: number;
  /**
   * Shortest slide the pacer schedules; bounds the slide count so timed
   * players don't merge slides back together (they fold anything under ~5s).
   * Default 6s.
   */
  minSlideDuration?: number;
  /** Most video clips placed in one segment. Default 2. */
  maxVideos?: number;
}

export interface NarratedSegmentResult extends TransformResult {
  seed: number;
}

interface SegmentPacing {
  slidesPerMinute: number;
  maxSlideDuration: number;
  minSlideDuration: number;
  maxVideos: number;
}

const DEFAULT_SLIDES_PER_MINUTE = 5;
const DEFAULT_MAX_SLIDE_DURATION = 15;
const DEFAULT_MIN_SLIDE_DURATION = 6;
const DEFAULT_MAX_VIDEOS = 2;

const AMBIENT_MOTIONS: Array<NonNullable<ImageWithCaptionInput['ambientMotion']>> = [
  'zoomIn',
  'zoomOut',
  'panLeft',
  'panRight',
];

export function transformNarratedSegment(
  input: NarratedSegmentInput,
  options: NarratedSegmentTransformOptions = {},
): NarratedSegmentResult {
  const seed = options.seed ?? hashString(`${input.articleId}-${input.segmentId}`);
  const heading = input.title.replace(/[\r\n]+/g, ' ').trim() || input.segmentId;
  const pacing: SegmentPacing = {
    slidesPerMinute: options.slidesPerMinute ?? DEFAULT_SLIDES_PER_MINUTE,
    maxSlideDuration: options.maxSlideDuration ?? DEFAULT_MAX_SLIDE_DURATION,
    minSlideDuration: options.minSlideDuration ?? DEFAULT_MIN_SLIDE_DURATION,
    maxVideos: options.maxVideos ?? DEFAULT_MAX_VIDEOS,
  };
  const images = uniqueImages(input.images ?? []);
  const videos = input.videos ?? [];
  const contentTarget = contentSlotCount(
    input.duration,
    pacing,
    images.length + Math.min(videos.length, pacing.maxVideos),
    !!input.includeTitleBlock,
  );

  // The transform promotes at most one extraction of each type per source
  // block. When a segment needs several text slides, give it one source
  // block per stretch of narration so each can contribute its own.
  const markdown = chunkNarration(input.text, contentTarget)
    .map((chunk) => `# ${heading}\n\n${chunk}`)
    .join('\n\n');
  const source = markdownToDoc(parseMarkdown(markdown), {
    articleId: `${input.articleId}:${input.segmentId}`,
    defaultDuration: Math.max(3, input.duration),
  });
  const sourceDoc: Doc = {
    ...source,
    articleId: input.articleId,
    duration: input.duration,
    audio: {
      segments: [
        {
          src: input.audioSrc,
          name: input.audioName ?? input.segmentId,
          duration: input.duration,
          startTime: 0,
        },
      ],
    },
  };

  const transformed = applyTransform(sourceDoc, options.style ?? 'documentary', {
    seed,
    images: input.images,
    themeId: options.themeId,
    registry: options.registry,
    overrides: {
      // The style's transformRatio is a share of source blocks, and a
      // narrated segment is one block — so it would always cap promotion at
      // a single extraction. Size the cap by content slots instead; the
      // slides-per-minute budget and blocksPerSection still apply.
      transformRatio: (contentTarget + 0.5) / Math.max(1, source.blocks.length),
      ...(options.minConfidence === undefined ? {} : { minConfidence: options.minConfidence }),
      ...(options.slidesPerMinute === undefined
        ? {}
        : { budget: { slidesPerMinute: options.slidesPerMinute } }),
    },
  });

  const title: TitleBlockInput | undefined = input.includeTitleBlock
    ? {
        template: 'title',
        id: `${input.segmentId}-title`,
        duration: 4,
        audioSegment: 0,
        title: input.title,
      }
    : undefined;
  // Source blocks the transform leaves unpromoted pass through as heading
  // blocks (markdownToDoc's default sectionHeader template), i.e. the segment
  // title again. Keep only promoted slides; if nothing was promoted, fall
  // back to a single pass-through so chunking never multiplies it.
  const transformedBlocks = transformed.doc.blocks;
  const sourceIds = new Set(source.blocks.map((block) => block.id));
  const promoted = transformedBlocks.filter((block) => !sourceIds.has(block.id));
  const kept = promoted.length > 0 ? promoted : transformedBlocks.slice(0, 1);
  const content = (kept as unknown as TemplateBlock[]).map((block) => ({
    ...block,
    id: namespacedId(block.id, input.segmentId),
  }));

  const paced = paceSegment({
    segmentId: input.segmentId,
    duration: input.duration,
    title,
    content,
    videos,
    images,
    pacing,
    rng: new SeededRandom(seed ^ 0x5bd1e995),
  });
  const timedBlocks = allocateTiming(paced, input.duration).map((block) => ({
    ...block,
    audioSegment: 0,
  }));

  return {
    ...transformed,
    seed,
    doc: {
      ...transformed.doc,
      articleId: input.articleId,
      duration: input.duration,
      audio: sourceDoc.audio,
      blocks: timedBlocks,
    },
  };
}

/** Slide count the pace asks for — never so few that one exceeds maxSlideDuration. */
function paceTarget(duration: number, pacing: SegmentPacing): number {
  return Math.max(
    1,
    Math.round((duration / 60) * pacing.slidesPerMinute),
    Math.ceil(duration / pacing.maxSlideDuration),
  );
}

/**
 * How many text slides the transform may promote. Mostly visuals when media
 * is plentiful (~20% text); image-poor segments lean on text so the pace
 * still holds.
 */
function contentSlotCount(
  duration: number,
  pacing: SegmentPacing,
  visualCount: number,
  hasTitle: boolean,
): number {
  const target = paceTarget(duration, pacing);
  const share = visualCount >= 3 ? 0.2 : 0.4;
  return Math.max(1, Math.round(target * share), target - (hasTitle ? 1 : 0) - visualCount);
}

interface PaceSegmentArgs {
  segmentId: string;
  duration: number;
  title?: TitleBlockInput;
  content: TemplateBlock[];
  videos: readonly NarratedSegmentVideo[];
  images: TransformImage[];
  pacing: SegmentPacing;
  rng: SeededRandom;
}

/** A block plus where it wants to land (segment seconds) and a tie-break rank. */
interface PacedItem {
  block: TemplateBlock;
  at: number;
  rank: number;
}

/**
 * Order title, text, video and image slides into one sequential segment with
 * nominal durations; `allocateTiming()` then scales them to fill the audio.
 */
function paceSegment(args: PaceSegmentArgs): TemplateBlock[] {
  const { segmentId, duration, title, content, pacing, rng } = args;
  const fixedCount = (title ? 1 : 0) + content.length;
  const maxCount = Math.max(1, Math.floor(duration / pacing.minSlideDuration));
  const target = paceTarget(duration, pacing);

  const videoCount =
    args.videos.length === 0
      ? 0
      : Math.min(
          args.videos.length,
          pacing.maxVideos,
          Math.max(1, Math.floor(target * 0.3)),
          Math.max(0, maxCount - fixedCount),
        );
  const videos = pickVideos(args.videos, videoCount);
  const pool = standaloneImagePool(args.images, content);

  // Grow the slide count one image at a time until the longest slide fits.
  let count = Math.max(target, fixedCount + videos.length);
  let imageCount = 0;
  for (;;) {
    imageCount = Math.min(pool.length, Math.max(0, count - fixedCount - videos.length));
    const longest = longestFittedSlide(duration, count, title, content, videos, imageCount, pacing);
    if (longest <= pacing.maxSlideDuration || imageCount >= pool.length || count >= maxCount) {
      break;
    }
    count++;
  }

  const slot = duration / Math.max(1, count);
  const items: PacedItem[] = [];

  if (title) {
    items.push({
      block: { ...title, duration: Math.min(slot, pacing.minSlideDuration) },
      at: -1,
      rank: 0,
    });
  }

  content.forEach((block, index) => {
    const anchor =
      typeof block.sourceStartTime === 'number'
        ? block.sourceStartTime
        : ((index + 0.5) / content.length) * duration;
    items.push({ block: { ...unanchored(block), duration: slot }, at: anchor, rank: 1 });
  });

  videos.forEach((video, index) => {
    items.push({
      block: videoBlock(video, index, segmentId, videoNominal(video, slot, pacing)),
      at: videoPosition(index, videos.length) * duration,
      rank: 2,
    });
  });

  for (let index = 0; index < imageCount; index++) {
    items.push({
      block: imageBlock(pool[index]!, index, segmentId, slot, rng),
      at: ((index + 0.5) / imageCount) * duration,
      rank: 3,
    });
  }

  return items
    .map((item, order) => ({ ...item, order }))
    .sort((a, b) => a.at - b.at || a.rank - b.rank || a.order - b.order)
    .map((item) => item.block);
}

/** Longest slide once nominal durations are scaled to fill the segment. */
function longestFittedSlide(
  duration: number,
  count: number,
  title: TitleBlockInput | undefined,
  content: readonly TemplateBlock[],
  videos: readonly NarratedSegmentVideo[],
  imageCount: number,
  pacing: SegmentPacing,
): number {
  const slot = duration / Math.max(1, count);
  const nominal = [
    ...(title ? [Math.min(slot, pacing.minSlideDuration)] : []),
    ...content.map(() => slot),
    ...videos.map((video) => videoNominal(video, slot, pacing)),
    ...Array.from({ length: imageCount }, () => slot),
  ];
  const total = nominal.reduce((sum, d) => sum + d, 0);
  return total > 0 ? Math.max(...nominal) * (duration / total) : duration;
}

/** A clip holds for its own length, within [minSlideDuration, slot]. */
function videoNominal(video: NarratedSegmentVideo, slot: number, pacing: SegmentPacing): number {
  return Math.min(slot, Math.max(pacing.minSlideDuration, video.clipEnd - video.clipStart));
}

/** Spread clips through the segment: one at 40%, two at 30%/70%. */
function videoPosition(index: number, count: number): number {
  if (count === 1) return 0.4;
  if (count === 2) return index === 0 ? 0.3 : 0.7;
  return (index + 1) / (count + 1);
}

/** Prefer clips from different source videos before a second clip of one. */
function pickVideos(
  videos: readonly NarratedSegmentVideo[],
  count: number,
): NarratedSegmentVideo[] {
  const picked: NarratedSegmentVideo[] = [];
  const seenSources = new Set<string>();
  for (const video of videos) {
    if (picked.length >= count) break;
    if (seenSources.has(video.src)) continue;
    seenSources.add(video.src);
    picked.push(video);
  }
  for (const video of videos) {
    if (picked.length >= count) break;
    if (!picked.includes(video)) picked.push(video);
  }
  return picked;
}

/**
 * Images for standalone slides: never one the transform already shows full
 * frame, and ones used as text-slide accents only after fresh ones.
 */
function standaloneImagePool(
  images: TransformImage[],
  content: readonly TemplateBlock[],
): TransformImage[] {
  const shown = new Set<string>();
  const accents = new Set<string>();
  for (const block of content) {
    const media = block as {
      imageSrc?: string;
      accentImage?: { src?: string };
      backgroundImage?: { src?: string };
    };
    if (block.template === 'imageWithCaption' && media.imageSrc) shown.add(media.imageSrc);
    if (media.accentImage?.src) accents.add(media.accentImage.src);
    if (media.backgroundImage?.src) accents.add(media.backgroundImage.src);
  }
  const available = images.filter((image) => !shown.has(image.src));
  return [
    ...available.filter((image) => !accents.has(image.src)),
    ...available.filter((image) => accents.has(image.src)),
  ];
}

/**
 * Split narration into up to `count` runs of whole sentences with roughly
 * equal word counts. A boundary is terminal punctuation followed by
 * whitespace, so decimals like "13.75" never split. (No regex lookbehind:
 * core also runs in older embedded engines.)
 */
function chunkNarration(text: string, count: number): string[] {
  if (count <= 1) return [text];
  const sentences: string[] = [];
  const boundary = /[.!?]["'’”)\]]*\s+/g;
  let start = 0;
  let match: RegExpExecArray | null;
  while ((match = boundary.exec(text)) !== null) {
    const end = match.index + match[0].length;
    const sentence = text.slice(start, end).trim();
    if (sentence) sentences.push(sentence);
    start = end;
  }
  const tail = text.slice(start).trim();
  if (tail) sentences.push(tail);
  if (sentences.length < 2) return [text];

  const chunkCount = Math.min(count, sentences.length);
  const words = sentences.map((sentence) => sentence.split(/\s+/).length);
  const totalWords = words.reduce((sum, n) => sum + n, 0);
  const chunks: string[][] = [];
  let current: string[] = [];
  let seenWords = 0;
  sentences.forEach((sentence, index) => {
    current.push(sentence);
    seenWords += words[index]!;
    const due = (totalWords * (chunks.length + 1)) / chunkCount;
    if (seenWords >= due && chunks.length < chunkCount - 1) {
      chunks.push(current);
      current = [];
    }
  });
  if (current.length > 0) chunks.push(current);
  return chunks.map((chunk) => chunk.join(' '));
}

function uniqueImages(images: readonly TransformImage[]): TransformImage[] {
  const seen = new Set<string>();
  return images.filter((image) => {
    if (!image.src || seen.has(image.src)) return false;
    seen.add(image.src);
    return true;
  });
}

function namespacedId(id: string, segmentId: string): string {
  return id.startsWith(`${segmentId}-`) ? id : `${segmentId}-${id}`;
}

/** Drop the narration anchor so the block schedules sequentially. */
function unanchored(block: TemplateBlock): TemplateBlock {
  const { sourceStartTime: _start, sourceDuration: _duration, ...rest } = block;
  return rest as TemplateBlock;
}

function imageBlock(
  image: TransformImage,
  index: number,
  segmentId: string,
  duration: number,
  rng: SeededRandom,
): ImageWithCaptionInput {
  // Alt text that is just a filename makes a poor caption.
  const caption = image.alt && !/\.(jpe?g|png|gif|svg|webp)/i.test(image.alt) ? image.alt : '';
  return {
    template: 'imageWithCaption',
    id: `${segmentId}-image-${index}`,
    duration,
    audioSegment: 0,
    imageSrc: image.src,
    imageAlt: image.alt ?? '',
    caption,
    captionPosition: 'bottom',
    ambientMotion: rng.pick(AMBIENT_MOTIONS) ?? 'zoomIn',
    imageCredit: image.credit,
    imageLicense: image.license,
  };
}

function videoBlock(
  video: NarratedSegmentVideo,
  index: number,
  segmentId: string,
  duration: number,
): VideoWithCaptionInput {
  return {
    template: 'videoWithCaption',
    id: `${segmentId}-video-${index}`,
    duration,
    audioSegment: 0,
    videoSrc: video.src,
    posterSrc: video.posterSrc,
    videoAlt: video.alt ?? '',
    clipStart: video.clipStart,
    clipEnd: video.clipEnd,
    // The clip's source file length (VideoWithCaptionInput's meaning), not a
    // narration timing hint.
    sourceDuration: video.sourceDuration,
    caption: video.alt,
    captionPosition: 'bottom',
    videoCredit: video.credit,
    videoLicense: video.license,
  };
}
