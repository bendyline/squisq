/**
 * Audio Mapping
 *
 * Associates audio segments (MP3 files) with document blocks.
 * Supports two modes:
 *
 * 1. **Explicit annotation**: Blocks with `{[audio=filename.mp3]}` in their
 *    heading annotation are directly mapped to that audio file.
 *
 * 2. **Auto-matching**: When no annotations exist but the container has MP3s
 *    with `.timing.json` files, matches MP3s to blocks by comparing the
 *    timing.json `sourceText` against block text content (word overlap).
 *    Falls back to filename-based matching (slugified title comparison).
 */

import type { Doc, Block, AudioSegment, AudioTimingData } from '../schemas/Doc.js';
import { resolveMediaSchedule } from '../schemas/Media.js';
import type { ContentContainer } from '../storage/ContentContainer.js';
import { extractPlainText } from '../markdown/utils.js';
import { applyNarrationTiming } from './applyNarrationTiming.js';

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Parse a timing.json file from raw data.
 */
function parseTimingJson(data: ArrayBuffer): AudioTimingData | null {
  try {
    const text = new TextDecoder().decode(data);
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.sourceText === 'string' && typeof parsed.duration === 'number') {
      return {
        sourceText: parsed.sourceText,
        bookmarks: Array.isArray(parsed.bookmarks) ? parsed.bookmarks : [],
        duration: parsed.duration,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Normalize text for comparison: lowercase, strip punctuation, split into word set.
 */
function normalizeToWords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
  return new Set(words);
}

/**
 * Calculate Jaccard similarity between two texts (word overlap).
 * Returns 0–1 where 1 = identical word sets.
 */
export function scoreTextSimilarity(a: string, b: string): number {
  const wordsA = normalizeToWords(a);
  const wordsB = normalizeToWords(b);
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }

  const union = new Set([...wordsA, ...wordsB]).size;
  return union > 0 ? intersection / union : 0;
}

/**
 * Slugify a title for filename comparison.
 * "The Behring Gambit" → "the-behring-gambit"
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Extract plain text from a block's contents and title.
 */
function blockToPlainText(block: Block): string {
  const parts: string[] = [];
  if (block.title) parts.push(block.title);
  if (block.contents) {
    for (const node of block.contents) {
      parts.push(extractPlainText(node));
    }
  }
  return parts.join('\n');
}

/**
 * Flatten a block tree into a linear array of leaf blocks
 * (blocks that represent actual content sections).
 */
function flattenForAudio(blocks: Block[]): Block[] {
  const result: Block[] = [];
  for (const block of blocks) {
    if (block.children && block.children.length > 0) {
      result.push(...flattenForAudio(block.children));
    } else {
      result.push(block);
    }
  }
  return result;
}

/**
 * Info about a narration audio file found in the container.
 *
 * Covers MP3/WebM/MP4/Ogg/M4A audio files, including browser-recorder output.
 */
interface NarrationAudioInfo {
  /** Path in the container (e.g., "audio/narration-2026.webm"). */
  path: string;
  /** Filename without path (e.g., "narration-2026.webm"). */
  filename: string;
  /** Parsed timing data (if .timing.json exists). */
  timing: AudioTimingData | null;
}

/**
 * File extensions that unambiguously denote audio anywhere in the
 * container. These predate the recorder feature.
 */
const AUDIO_ONLY_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a'];

/**
 * Extensions that could be audio or video — `.webm` and `.mp4` are the
 * containers `MediaRecorder` produces for browser-side narration, but
 * they're also used for video clips. Only treat them as narration when
 * they live under the `audio/` directory the recorder writes to.
 */
const AMBIGUOUS_EXTENSIONS = ['.webm', '.mp4'];

function isNarrationAudioPath(path: string): boolean {
  const lower = path.toLowerCase();
  if (AUDIO_ONLY_EXTENSIONS.some((ext) => lower.endsWith(ext))) return true;
  if (AMBIGUOUS_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    return lower.startsWith('audio/');
  }
  return false;
}

/** Strip a known narration audio extension from a filename. */
function stripAudioExtension(filename: string): string {
  const lower = filename.toLowerCase();
  for (const ext of [...AUDIO_ONLY_EXTENSIONS, ...AMBIGUOUS_EXTENSIONS]) {
    if (lower.endsWith(ext)) return filename.slice(0, -ext.length);
  }
  return filename;
}

// ── Core Functions ───────────────────────────────────────────────────

/**
 * Parse a consolidated timing.json (version 2) which contains all section
 * timing data in a single file.
 */
function parseConsolidatedTiming(data: ArrayBuffer): Record<string, AudioTimingData> | null {
  try {
    const text = new TextDecoder().decode(data);
    const parsed = JSON.parse(text);
    if (parsed && parsed.version === 2 && parsed.sections) {
      return parsed.sections as Record<string, AudioTimingData>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Discover all narration audio files in a container and load their
 * timing data. Covers historical `.mp3`/`.wav`/`.ogg`/`.m4a` files
 * anywhere in the container plus `.webm`/`.mp4` files under `audio/`
 * (the destination the browser recorder writes to).
 *
 * Checks for a consolidated timing.json first, then falls back to
 * per-file `.timing.json` sidecars.
 */
async function discoverNarrationAudio(container: ContentContainer): Promise<NarrationAudioInfo[]> {
  const files = await container.listFiles();
  const audioFiles = files.filter((f) => isNarrationAudioPath(f.path));
  const results: NarrationAudioInfo[] = [];

  // Try to load consolidated timing.json
  let consolidatedSections: Record<string, AudioTimingData> | null = null;
  const consolidatedData = await container.readFile('timing.json');
  if (consolidatedData) {
    consolidatedSections = parseConsolidatedTiming(consolidatedData);
  }

  for (const file of audioFiles) {
    const filename = file.path.split('/').pop() ?? file.path;
    let timing: AudioTimingData | null = null;

    // Try consolidated timing first: match section name from filename
    if (consolidatedSections) {
      const audioBase = stripAudioExtension(filename);
      for (const [sectionName, sectionTiming] of Object.entries(consolidatedSections)) {
        if (audioBase.endsWith(`-${sectionName}`)) {
          timing = sectionTiming;
          break;
        }
      }
    }

    // Fall back to per-file .timing.json
    if (!timing) {
      const timingPath = `${file.path}.timing.json`;
      const timingData = await container.readFile(timingPath);
      if (timingData) {
        timing = parseTimingJson(timingData);
      }
    }

    results.push({ path: file.path, filename, timing });
  }

  return results;
}

/**
 * Resolve audio from explicit `{[audio=filename.mp3]}` annotations on blocks.
 * Returns the matched pairs or an empty array if no annotations found.
 */
function resolveFromAnnotations(
  blocks: Block[],
  audioFiles: NarrationAudioInfo[],
): Array<{ block: Block; audio: NarrationAudioInfo }> {
  const matches: Array<{ block: Block; audio: NarrationAudioInfo }> = [];
  const flat = flattenForAudio(blocks);

  for (const block of flat) {
    const audioRef = block.templateOverrides?.audio;
    if (!audioRef) continue;

    // Find the narration file by filename (exact or suffix match).
    const audio = audioFiles.find(
      (m) => m.filename === audioRef || m.path === audioRef || m.path.endsWith(`/${audioRef}`),
    );

    if (audio) {
      matches.push({ block, audio });
    }
  }

  return matches;
}

/** Minimum similarity score to consider a content match. */
const MIN_CONTENT_SIMILARITY = 0.35;

/** Minimum similarity score for filename-based matching. */
const MIN_FILENAME_SIMILARITY = 0.5;

/**
 * Auto-match narration files to blocks by content similarity.
 * Uses timing.json sourceText when available, falls back to filename matching.
 */
function autoMatchBlocks(
  blocks: Block[],
  audioFiles: NarrationAudioInfo[],
): Array<{ block: Block; audio: NarrationAudioInfo; score: number }> {
  const flat = flattenForAudio(blocks);
  if (flat.length === 0 || audioFiles.length === 0) return [];

  // Score all (audio, block) pairs.
  const scoredPairs: Array<{
    block: Block;
    blockIndex: number;
    audio: NarrationAudioInfo;
    audioIndex: number;
    score: number;
  }> = [];

  for (let audioIndex = 0; audioIndex < audioFiles.length; audioIndex++) {
    const audio = audioFiles[audioIndex];

    for (let bi = 0; bi < flat.length; bi++) {
      const block = flat[bi];
      const blockText = blockToPlainText(block);
      if (!blockText.trim()) continue;

      let score = 0;

      // Primary: content similarity via timing.json sourceText
      if (audio.timing?.sourceText) {
        score = scoreTextSimilarity(audio.timing.sourceText, blockText);
      }

      // Fallback: filename-based matching
      if (score < MIN_CONTENT_SIMILARITY && block.title) {
        const titleSlug = slugify(block.title);
        const fileSlug = slugify(stripAudioExtension(audio.filename));
        // Check if the title slug appears in the filename slug
        if (fileSlug.includes(titleSlug) && titleSlug.length >= 3) {
          score = Math.max(score, MIN_FILENAME_SIMILARITY + 0.1);
        }
      }

      if (score >= MIN_CONTENT_SIMILARITY) {
        scoredPairs.push({ block, blockIndex: bi, audio, audioIndex, score });
      }
    }
  }

  // Greedy assignment: highest score first, each audio file and block at most once.
  scoredPairs.sort((a, b) => b.score - a.score);
  const usedBlocks = new Set<number>();
  const usedAudio = new Set<number>();
  const matches: Array<{ block: Block; audio: NarrationAudioInfo; score: number }> = [];

  for (const pair of scoredPairs) {
    if (usedBlocks.has(pair.blockIndex) || usedAudio.has(pair.audioIndex)) continue;
    usedBlocks.add(pair.blockIndex);
    usedAudio.add(pair.audioIndex);
    matches.push({ block: pair.block, audio: pair.audio, score: pair.score });
  }

  return matches;
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Resolve audio mapping for a Doc using a ContentContainer.
 *
 * Tries explicit `{[audio=filename.mp3]}` annotations first,
 * then falls back to auto-matching by content similarity.
 *
 * Returns a new Doc with `audio.segments` populated and blocks
 * assigned to the correct `audioSegment` indices.
 *
 * @param doc - The source Doc (not mutated).
 * @param container - ContentContainer with narration and timing files.
 * @returns New Doc with audio segments resolved, or original doc if no matches.
 */
export async function resolveAudioMapping(doc: Doc, container: ContentContainer): Promise<Doc> {
  // Step 0: a document-anchored narration take (preamble `{[audio src=…
  // anchor=document]}` + v3 timing sidecar) re-times the block timeline
  // to the recorded voice. See applyNarrationTiming for precedence.
  const narration = await applyNarrationTiming(doc, container);
  doc = narration.doc;

  const audioFiles = await discoverNarrationAudio(container);

  // Files already playing through the media schedule (documentMedia /
  // block clips) must not ALSO be auto-mapped into audio.segments —
  // that would play the narration twice.
  const scheduledSrcs = new Set(resolveMediaSchedule(doc).map((clip) => clip.src));
  const available = audioFiles.filter((f) => !scheduledSrcs.has(f.path));
  if (available.length === 0) return doc;

  // Try annotations first
  let matches = resolveFromAnnotations(doc.blocks, available);

  // Fall back to auto-matching if no annotations found. When narration
  // timing was applied, content auto-matching is skipped — the take owns
  // the timeline, and fuzzy matches against other files would fight it.
  if (matches.length === 0 && !narration.applied) {
    matches = autoMatchBlocks(doc.blocks, available).map((m) => ({
      block: m.block,
      audio: m.audio,
    }));
  }

  if (matches.length === 0) return doc;

  // Build audio segments in document order
  // Sort matches by the block's position in the flattened tree
  const flat = flattenForAudio(doc.blocks);
  const blockOrder = new Map(flat.map((b, i) => [b.id, i]));
  matches.sort((a, b) => (blockOrder.get(a.block.id) ?? 0) - (blockOrder.get(b.block.id) ?? 0));

  // Build segment list and assign indices
  const segments: AudioSegment[] = [];
  const blockToSegment = new Map<string, number>();
  let startTime = 0;

  for (let i = 0; i < matches.length; i++) {
    const { block, audio } = matches[i];
    const duration = audio.timing?.duration ?? 30; // Fallback duration if no timing

    segments.push({
      src: audio.path,
      name: block.title ?? block.id,
      duration,
      startTime,
    });

    blockToSegment.set(block.id, i);
    startTime += duration;
  }

  // Deep clone blocks and assign audioSegment indices
  const newBlocks = assignSegmentIndices(doc.blocks, blockToSegment);

  return {
    ...doc,
    blocks: newBlocks,
    // A narration take owns the overall duration; explicit per-block
    // segments only ever extend it.
    duration: narration.applied ? Math.max(doc.duration, startTime) : startTime,
    audio: { segments },
  };
}

/**
 * Recursively clone blocks and assign audioSegment indices.
 * Blocks not in the map keep their original audioSegment.
 * Children of a matched block inherit the parent's segment.
 */
function assignSegmentIndices(
  blocks: Block[],
  blockToSegment: Map<string, number>,
  inheritedSegment?: number,
): Block[] {
  return blocks.map((block) => {
    const segment = blockToSegment.get(block.id) ?? inheritedSegment ?? block.audioSegment;
    const newBlock: Block = {
      ...block,
      audioSegment: segment,
    };

    if (block.children) {
      newBlock.children = assignSegmentIndices(block.children, blockToSegment, segment);
    }

    return newBlock;
  });
}
