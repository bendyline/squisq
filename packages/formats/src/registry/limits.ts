import type { Doc, Block } from '@bendyline/squisq/schemas';
import type { MarkdownSafetyLimits } from '@bendyline/squisq/markdown';

export interface ConversionLimits {
  maxInputBytes: number;
  maxMarkdownBytes: number;
  maxMarkdownNodes: number;
  maxMarkdownDepth: number;
  maxTableCells: number;
  maxBlocks: number;
  maxBlockDepth: number;
  maxDurationSeconds: number;
  maxAudioSegments: number;
}

export const DEFAULT_CONVERSION_LIMITS: Readonly<ConversionLimits> = Object.freeze({
  maxInputBytes: 256 * 1024 * 1024,
  maxMarkdownBytes: 16 * 1024 * 1024,
  maxMarkdownNodes: 250_000,
  maxMarkdownDepth: 128,
  maxTableCells: 100_000,
  maxBlocks: 50_000,
  maxBlockDepth: 128,
  maxDurationSeconds: 24 * 60 * 60,
  maxAudioSegments: 10_000,
});

export function resolveConversionLimits(limits?: Partial<ConversionLimits>): ConversionLimits {
  const resolved = { ...DEFAULT_CONVERSION_LIMITS, ...limits };
  for (const [name, value] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`${name} must be a non-negative safe integer`);
    }
  }
  return resolved;
}

export function markdownLimitsFromConversion(
  limits: Partial<ConversionLimits> | false | undefined,
): Partial<MarkdownSafetyLimits> | false {
  if (limits === false) return false;
  const resolved = resolveConversionLimits(limits);
  return {
    maxSourceBytes: resolved.maxMarkdownBytes,
    maxNodes: resolved.maxMarkdownNodes,
    maxDepth: resolved.maxMarkdownDepth,
    maxTableCells: resolved.maxTableCells,
  };
}

export function assertDocWithinConversionLimits(
  doc: Doc,
  limits: Partial<ConversionLimits> | false | undefined,
  signal?: AbortSignal,
): void {
  if (limits === false) return;
  const resolved = resolveConversionLimits(limits);
  if (
    !Number.isFinite(doc.duration) ||
    doc.duration < 0 ||
    doc.duration > resolved.maxDurationSeconds
  ) {
    throw new RangeError(
      `Document duration must be between 0 and ${resolved.maxDurationSeconds} seconds`,
    );
  }
  if (doc.audio.segments.length > resolved.maxAudioSegments) {
    throw new RangeError(
      `Document exceeds the ${resolved.maxAudioSegments}-audio-segment safety limit`,
    );
  }
  let audioDuration = 0;
  for (const segment of doc.audio.segments) {
    if (!Number.isFinite(segment.duration) || segment.duration < 0) {
      throw new RangeError('Audio segment durations must be non-negative finite numbers');
    }
    audioDuration += segment.duration;
    if (audioDuration > resolved.maxDurationSeconds) {
      throw new RangeError(
        `Narration exceeds the ${resolved.maxDurationSeconds}-second safety limit`,
      );
    }
  }

  const stack: Array<{ block: Block; depth: number }> = [];
  for (let index = doc.blocks.length - 1; index >= 0; index--) {
    stack.push({ block: doc.blocks[index]!, depth: 0 });
  }
  let count = 0;
  while (stack.length > 0) {
    if ((count & 1023) === 0) signal?.throwIfAborted();
    const { block, depth } = stack.pop()!;
    if (++count > resolved.maxBlocks) {
      throw new RangeError(`Document exceeds the ${resolved.maxBlocks}-block safety limit`);
    }
    if (depth > resolved.maxBlockDepth) {
      throw new RangeError(
        `Document exceeds the ${resolved.maxBlockDepth}-level block nesting safety limit`,
      );
    }
    for (let index = (block.children?.length ?? 0) - 1; index >= 0; index--) {
      stack.push({ block: block.children![index]!, depth: depth + 1 });
    }
  }
}
