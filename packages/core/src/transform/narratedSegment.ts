/**
 * Narrated Segment Transformation
 *
 * Converts a narrated text segment and its media into a timed Doc using the
 * canonical squisq transform pipeline. This is the reusable bridge for hosts
 * that generate one visual sequence per narration segment.
 */

import type { Doc } from '../schemas/Doc.js';
import type {
  TemplateBlock,
  TitleBlockInput,
  VideoWithCaptionInput,
} from '../schemas/BlockTemplates.js';
import { markdownToDoc } from '../doc/markdownToDoc.js';
import { parseMarkdown } from '../markdown/parse.js';
import { hashString } from '../random/SeededRandom.js';
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
  slidesPerMinute?: number;
}

export interface NarratedSegmentResult extends TransformResult {
  seed: number;
}

export function transformNarratedSegment(
  input: NarratedSegmentInput,
  options: NarratedSegmentTransformOptions = {},
): NarratedSegmentResult {
  const seed = options.seed ?? hashString(`${input.articleId}-${input.segmentId}`);
  const heading = input.title.replace(/[\r\n]+/g, ' ').trim() || input.segmentId;
  const source = markdownToDoc(parseMarkdown(`# ${heading}\n\n${input.text}`), {
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
      ...(options.minConfidence === undefined ? {} : { minConfidence: options.minConfidence }),
      ...(options.slidesPerMinute === undefined
        ? {}
        : { budget: { slidesPerMinute: options.slidesPerMinute } }),
    },
  });

  let blocks: TemplateBlock[] = transformed.doc.blocks as unknown as TemplateBlock[];
  if (input.includeTitleBlock) {
    const title: TitleBlockInput = {
      template: 'title',
      id: `${input.segmentId}-title`,
      duration: 4,
      audioSegment: 0,
      title: input.title,
    };
    blocks = [title, ...blocks];
  }
  blocks = interleaveVideoBlocks(blocks, input.videos ?? [], input.segmentId);
  const timedBlocks = allocateTiming(blocks, input.duration).map((block) => ({
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

function interleaveVideoBlocks(
  blocks: TemplateBlock[],
  videos: readonly NarratedSegmentVideo[],
  segmentId: string,
): TemplateBlock[] {
  if (videos.length === 0) return blocks;
  const result = [...blocks];
  videos.forEach((video, index) => {
    const block: VideoWithCaptionInput = {
      template: 'videoWithCaption',
      id: `${segmentId}-video-${index}`,
      duration: Math.max(3, video.clipEnd - video.clipStart),
      audioSegment: 0,
      videoSrc: video.src,
      posterSrc: video.posterSrc,
      videoAlt: video.alt ?? '',
      clipStart: video.clipStart,
      clipEnd: video.clipEnd,
      sourceDuration: video.sourceDuration,
      caption: video.alt,
      captionPosition: 'bottom',
      videoCredit: video.credit,
      videoLicense: video.license,
    };
    const insertion = Math.min(
      result.length,
      Math.round(((index + 1) * result.length) / (videos.length + 1)),
    );
    result.splice(insertion + index, 0, block);
  });
  return result;
}
