/**
 * Baked clips — a clip with its whole recipe applied, as one ordinary media
 * file.
 *
 * The player, video export and the CLI apply a recipe as they play: they skip
 * cuts, set the gain, swap in the processed audio. A script-free HTML page or
 * another app cannot. For those the recipe is BAKED: trim, cuts, cleaned-up
 * sound, gain, fades and crop are rendered into a single file that any player
 * plays as is.
 *
 * A baked file is a cache, like an `fx` render. The recipe in the markdown
 * stays the source of truth, the source file is never touched, and a bake is
 * made only on demand (an export that needs it, "Save edited copy") — never
 * merely because a recipe changed. It lives in the same `.mediaEdits/` folder:
 *
 *   .mediaEdits/<stem>.<key>.baked.<ext>    the baked clip
 *   .mediaEdits/<stem>.<key>.baked.json     its manifest
 *
 * `<key>` is {@link mediaBakeKey}: 12 hex digits over the source path and
 * everything in the recipe that changes the result. The extra `.baked`
 * segment keeps these apart from `fx` renders, so neither index sees the
 * other's files.
 *
 * Pure and dependency-free.
 */

import type { MediaClip } from '../schemas/Media.js';
import {
  canonicalMediaFx,
  formatMediaNumber,
  hasRenderableFx,
  mediaRecipeHash,
  normalizeMediaCuts,
  serializeMediaCrop,
  serializeMediaCuts,
  type MediaCut,
} from './recipe.js';
import { MEDIA_RENDER_DIR, mediaRenderStem, type MediaRenderEntry } from './renderStore.js';

/** Engine identifier. It is part of the key: a new engine version re-bakes. */
export const MEDIA_BAKE_ENGINE = 'squisq-media-bake/1';

/** Manifest schema version. */
export const MEDIA_BAKE_MANIFEST_VERSION = 1;

/**
 * Fade applied on each side of a cut so the join does not click. The player
 * and the export mix use the same length.
 */
export const MEDIA_CUT_EDGE_FADE_SEC = 0.01;

const BAKE_EXTENSIONS = new Set(['mp4', 'webm', 'm4a', 'wav']);

/** The parts of a clip that decide its baked file. */
export type MediaBakeClip = Pick<MediaClip, 'src' | 'kind' | 'clipStart' | 'clipEnd' | 'edits'>;

/** The clip's cuts that fall inside its trim window — the only ones that matter. */
export function mediaBakeCuts(clip: MediaBakeClip): MediaCut[] {
  return normalizeMediaCuts(
    clip.edits?.cuts ?? [],
    Math.max(0, clip.clipStart ?? 0),
    clip.clipEnd ?? Number.POSITIVE_INFINITY,
  );
}

/**
 * True when a player that cannot apply a recipe would play this clip wrongly:
 * it has cuts, cleaned-up audio, a gain, fades, or (video) a crop. A trim
 * alone does not count — a plain player honors it as a media fragment.
 */
export function needsMediaBake(clip: MediaBakeClip): boolean {
  const edits = clip.edits;
  if (!edits) return false;
  return (
    mediaBakeCuts(clip).length > 0 ||
    hasRenderableFx(edits.fx) ||
    Boolean(edits.gain) ||
    Boolean(edits.fadeIn) ||
    Boolean(edits.fadeOut) ||
    (clip.kind === 'video' && edits.crop != null)
  );
}

/** True when baking would produce anything other than a copy of the source. */
export function canBakeMedia(clip: MediaBakeClip): boolean {
  return needsMediaBake(clip) || (clip.clipStart ?? 0) > 0 || clip.clipEnd != null;
}

/**
 * Canonical text of everything that decides a clip's baked file. Recipe
 * fields that do not change the result (`group`, unknown `fx` tokens, a crop
 * on audio, cuts outside the trim) are left out, so they never force a
 * re-bake.
 */
export function mediaBakeSpec(clip: MediaBakeClip): string {
  const edits = clip.edits;
  const seconds = (value: number | undefined) => (value ? formatMediaNumber(value) : '');
  return [
    MEDIA_BAKE_ENGINE,
    clip.src,
    clip.kind,
    `trim=${seconds(clip.clipStart)}-${clip.clipEnd != null ? formatMediaNumber(clip.clipEnd) : ''}`,
    `cuts=${serializeMediaCuts(mediaBakeCuts(clip))}`,
    `fx=${hasRenderableFx(edits?.fx) ? canonicalMediaFx(edits.fx) : ''}`,
    `gain=${edits?.gain ? formatMediaNumber(edits.gain, 2) : ''}`,
    `fadeIn=${seconds(edits?.fadeIn)}`,
    `fadeOut=${seconds(edits?.fadeOut)}`,
    `crop=${clip.kind === 'video' && edits?.crop ? serializeMediaCrop(edits.crop) : ''}`,
  ].join('\n');
}

/** Stable key naming the baked file of a clip. 12 hex digits. */
export function mediaBakeKey(clip: MediaBakeClip): string {
  return mediaRecipeHash(mediaBakeSpec(clip));
}

// ── Store layout ────────────────────────────────────────────────────

export function mediaBakeFilePath(src: string, key: string, extension: string): string {
  return `${MEDIA_RENDER_DIR}/${mediaRenderStem(src)}.${key}.baked.${extension}`;
}

export function mediaBakeManifestPath(src: string, key: string): string {
  return `${MEDIA_RENDER_DIR}/${mediaRenderStem(src)}.${key}.baked.json`;
}

export interface ParsedMediaBakePath {
  stem: string;
  key: string;
  extension: string;
  isManifest: boolean;
}

/**
 * Recognize a baked clip or its manifest, with or without a leading media
 * folder (`notes_files/.mediaEdits/take.1a2b3c4d5e6f.baked.m4a`).
 */
export function parseMediaBakePath(path: string): ParsedMediaBakePath | null {
  const segments = path.split('/');
  const dirIndex = segments.length - 2;
  if (dirIndex < 0 || segments[dirIndex] !== MEDIA_RENDER_DIR) return null;
  const match = segments[segments.length - 1].match(/^(.+)\.([0-9a-f]{12})\.baked\.([a-z0-9]+)$/);
  if (!match) return null;
  const extension = match[3];
  const isManifest = extension === 'json';
  if (!isManifest && !BAKE_EXTENSIONS.has(extension)) return null;
  return { stem: match[1], key: match[2], extension, isManifest };
}

export function isMediaBakePath(path: string): boolean {
  return parseMediaBakePath(path) != null;
}

/** A baked clip found in a listing. */
export type MediaBakeEntry = MediaRenderEntry;

/** Index a media listing by bake key. A baked file without a manifest is still indexed. */
export function buildMediaBakeIndex(
  entries: ReadonlyArray<{ name: string; size: number }>,
): Map<string, MediaBakeEntry> {
  const manifests = new Map<string, string>();
  const index = new Map<string, MediaBakeEntry>();
  for (const entry of entries) {
    const parsed = parseMediaBakePath(entry.name);
    if (!parsed) continue;
    if (parsed.isManifest) manifests.set(parsed.key, entry.name);
    else {
      index.set(parsed.key, {
        key: parsed.key,
        path: entry.name,
        manifestPath: null,
        size: entry.size,
      });
    }
  }
  for (const [key, entry] of index) entry.manifestPath = manifests.get(key) ?? null;
  return index;
}

export interface MediaBakeManifest {
  version: typeof MEDIA_BAKE_MANIFEST_VERSION;
  /** The source reference exactly as the document writes it. */
  src: string;
  key: string;
  /** The canonical recipe text the key was made from ({@link mediaBakeSpec}). */
  spec: string;
  /** Baked file path, relative to the media root. */
  file: string;
  mimeType: string;
  /** Source byte size at bake time (staleness check), when known. */
  sourceSize: number | null;
  /** Length of the baked clip in seconds. */
  duration: number | null;
  engine: string;
  /** ISO-8601 creation time. */
  createdAt: string;
}

/** Validate manifest JSON; null when malformed or from an unknown version. */
export function parseMediaBakeManifest(text: string): MediaBakeManifest | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const str = (v: unknown): v is string => typeof v === 'string';
  const numOrNull = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  if (m.version !== MEDIA_BAKE_MANIFEST_VERSION) return null;
  if (!str(m.src) || !str(m.key) || !str(m.spec) || !str(m.file) || !str(m.mimeType)) return null;
  if (!str(m.engine) || !str(m.createdAt)) return null;
  return {
    version: MEDIA_BAKE_MANIFEST_VERSION,
    src: m.src,
    key: m.key,
    spec: m.spec,
    file: m.file,
    mimeType: m.mimeType,
    sourceSize: numOrNull(m.sourceSize),
    duration: numOrNull(m.duration),
    engine: m.engine,
    createdAt: m.createdAt,
  };
}

export function serializeMediaBakeManifest(manifest: MediaBakeManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * True when a baked clip no longer matches its source: the source file's size
 * differs from bake time (a re-recorded take under the same name).
 */
export function isMediaBakeStale(
  manifest: MediaBakeManifest,
  current: { sourceSize?: number | null },
): boolean {
  return (
    current.sourceSize != null &&
    manifest.sourceSize != null &&
    current.sourceSize !== manifest.sourceSize
  );
}

/**
 * Baked clips (and their manifests) of the given sources that no current
 * recipe asks for. Unlike `fx` renders these are removed at once rather than
 * aged out: a baked video is large, is made again on demand, and playback
 * never depends on it. A file without a manifest cannot be attributed to a
 * source, so it is left alone.
 */
export function selectSupersededMediaBakes(
  index: ReadonlyMap<string, MediaBakeEntry>,
  manifests: ReadonlyMap<string, MediaBakeManifest>,
  sources: ReadonlySet<string>,
  referencedKeys: ReadonlySet<string>,
): string[] {
  const paths: string[] = [];
  for (const [key, entry] of index) {
    if (referencedKeys.has(key)) continue;
    const manifest = manifests.get(key);
    if (!manifest || !sources.has(manifest.src)) continue;
    paths.push(entry.path);
    if (entry.manifestPath) paths.push(entry.manifestPath);
  }
  return paths;
}

// ── Names for a copy handed to the user or written into an export ───

/** `take.webm` + `m4a` → `take-edited.m4a`: the file name of an edited copy. */
export function mediaBakeCopyName(src: string, extension: string): string {
  const base = src.split(/[?#]/, 1)[0].split('/').pop() || 'media';
  const stem = base.replace(/\.[^.]+$/, '') || 'media';
  return `${stem}-edited.${extension}`;
}

/** The edited copy's path beside its source (`notes_files/audio/take-edited.m4a`). */
export function mediaBakeCopyPath(src: string, extension: string): string {
  const path = src.split(/[?#]/, 1)[0];
  const slash = path.lastIndexOf('/');
  const name = mediaBakeCopyName(src, extension);
  return slash < 0 ? name : `${path.slice(0, slash + 1)}${name}`;
}

// ── Audio stage ─────────────────────────────────────────────────────

/** Kept source ranges as whole-frame offsets from `windowStart`, for slicing decoded audio. */
export function mediaBakeFrameRanges(
  kept: readonly MediaCut[],
  windowStart: number,
  sampleRate: number,
): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const range of kept) {
    const start = Math.max(0, Math.round((range.start - windowStart) * sampleRate));
    const end = Math.round((range.end - windowStart) * sampleRate);
    if (end > start) ranges.push([start, end]);
  }
  return ranges;
}

export interface MediaBakeAudioStageOptions {
  /**
   * The frames to keep, as offsets from the first frame fed: ascending and
   * non-overlapping (see {@link mediaBakeFrameRanges}).
   */
  ranges: ReadonlyArray<readonly [number, number]>;
  sampleRate: number;
  /** Clip gain in dB. */
  gainDb?: number;
  /** Fade-in seconds at the start of the baked clip. */
  fadeInSec?: number;
  /** Fade-out seconds at the end of the baked clip. */
  fadeOutSec?: number;
}

export interface MediaBakeAudioStage {
  /** Frames the baked clip will hold. */
  readonly totalFrames: number;
  /**
   * Feed the next decoded block (planar, consecutive from the window start).
   * Returns the part of it the baked clip keeps, with gain, fades and the
   * cut-edge fades applied — or null when the whole block is cut.
   */
  process(block: readonly Float32Array[]): Float32Array[] | null;
}

/**
 * What a recipe's timeline ops do to sound: drop the cut ranges, close the
 * gaps, apply the gain and the two fades, and fade each join a few
 * milliseconds either side so it does not click — the same result the player
 * and the export mix produce live.
 */
export function createMediaBakeAudioStage(
  options: MediaBakeAudioStageOptions,
): MediaBakeAudioStage {
  const { ranges, sampleRate } = options;
  const gain = options.gainDb ? Math.pow(10, options.gainDb / 20) : 1;
  const totalFrames = ranges.reduce((sum, [start, end]) => sum + (end - start), 0);
  const fadeIn = Math.min(totalFrames, Math.round((options.fadeInSec ?? 0) * sampleRate));
  const fadeOut = Math.min(totalFrames, Math.round((options.fadeOutSec ?? 0) * sampleRate));
  const edge = Math.max(1, Math.round(MEDIA_CUT_EDGE_FADE_SEC * sampleRate));
  // Played frame at which each interior join falls.
  const joins: number[] = [];
  let cumulative = 0;
  for (let i = 0; i < ranges.length - 1; i++) {
    cumulative += ranges[i][1] - ranges[i][0];
    joins.push(cumulative);
  }

  /** Level at a played frame; `joinIndex` is the first join at or after `frame - edge`. */
  const levelAt = (frame: number, joinIndex: number): number => {
    let level = gain;
    if (frame < fadeIn) level *= frame / fadeIn;
    if (frame >= totalFrames - fadeOut) level *= (totalFrames - frame) / fadeOut;
    const join = joins[joinIndex];
    if (join !== undefined) {
      // The frame before a join is the quietest of the outgoing side.
      const distance = frame < join ? join - 1 - frame : frame - join;
      if (distance < edge) level *= distance / edge;
    }
    return level;
  };

  let fed = 0;
  let played = 0;
  let rangeIndex = 0;
  let joinIndex = 0;

  return {
    totalFrames,
    process(block) {
      const length = block[0]?.length ?? 0;
      const blockStart = fed;
      const blockEnd = fed + length;
      fed = blockEnd;
      // The slices of this block that fall inside kept ranges.
      const slices: Array<[number, number]> = [];
      let kept = 0;
      while (rangeIndex < ranges.length) {
        const [rangeStart, rangeEnd] = ranges[rangeIndex];
        if (rangeStart >= blockEnd) break;
        const from = Math.max(rangeStart, blockStart);
        const to = Math.min(rangeEnd, blockEnd);
        if (to > from) {
          slices.push([from - blockStart, to - blockStart]);
          kept += to - from;
        }
        if (rangeEnd > blockEnd) break;
        rangeIndex++;
      }
      if (kept === 0) return null;

      const out = block.map(() => new Float32Array(kept));
      let at = 0;
      for (const [from, to] of slices) {
        for (let c = 0; c < block.length; c++) out[c].set(block[c].subarray(from, to), at);
        at += to - from;
      }

      const first = played;
      const last = played + kept;
      played = last;
      for (let i = 0; i < kept; i++) {
        const frame = first + i;
        while (joinIndex < joins.length && joins[joinIndex] + edge <= frame) joinIndex++;
        const level = levelAt(frame, joinIndex);
        if (level === 1) continue;
        for (const channel of out) channel[i] *= level;
      }
      return out;
    },
  };
}
