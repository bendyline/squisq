/**
 * Render store — where derived (processed) audio lives, and how to find it.
 *
 * A signal recipe (`fx`) is rendered into an audio-only file that is
 * sample-aligned with the source's audio track: same start, same length,
 * never cut. Renders live in a hidden `.mediaEdits/` folder beside the rest
 * of the document's media, so they travel with the document (copy, zip, git)
 * and every surface — player, export, CLI — can reuse them. They are a cache:
 * the recipe in the markdown is the source of truth, and any render can be
 * deleted and regenerated.
 *
 * Layout (paths relative to the media root a `MediaProvider` resolves):
 *
 *   .mediaEdits/<stem>.<key>.<ext>    the rendered audio (webm/Opus or wav)
 *   .mediaEdits/<stem>.<key>.json     its manifest
 *
 * `<key>` is {@link mediaRenderKey}(src, fx), so availability is readable from
 * a directory listing alone; manifests are read only for staleness and GC.
 *
 * Pure and dependency-free.
 */

import type { Block, Doc } from '../schemas/Doc.js';
import type { MediaClip } from '../schemas/Media.js';
import {
  MEDIA_FX_ORDER,
  hasRenderableFx,
  mediaRenderKey,
  parseMediaFx,
  type MediaFxOpId,
} from './recipe.js';

/** Folder (under the media root) holding renders and manifests. */
export const MEDIA_RENDER_DIR = '.mediaEdits';

/** Manifest schema version. */
export const MEDIA_RENDER_MANIFEST_VERSION = 1;

/** Renders unreferenced for at least this long are eligible for GC. */
export const MEDIA_RENDER_GC_AGE_DAYS = 7;

const RENDER_EXTENSIONS = new Set(['webm', 'wav', 'ogg', 'm4a']);

export interface MediaRenderAnalysis {
  /** Integrated loudness before the loudness stage, LUFS. */
  integratedLufs?: number;
  /** Gain the loudness stage applied, dB. */
  appliedGainDb?: number;
  /** Breaths the de-breath stage attenuated. */
  breathCount?: number;
}

export interface MediaRenderManifest {
  version: typeof MEDIA_RENDER_MANIFEST_VERSION;
  /** The source reference exactly as the document writes it. */
  src: string;
  key: string;
  /** Canonical known-op `fx` the render applied. */
  fx: string;
  /** Recipe tokens the rendering engine did not understand (not applied). */
  ignoredOps: string[];
  /** Render file path, relative to the media root. */
  file: string;
  mimeType: string;
  /** Source byte size at render time (staleness check), when known. */
  sourceSize: number | null;
  /** Source audio duration in seconds at render time, when known. */
  sourceDuration: number | null;
  /** Engine identifier, e.g. `squisq-media-edit/1`. */
  engine: string;
  /** ISO-8601 creation time. */
  createdAt: string;
  analysis?: MediaRenderAnalysis;
}

/** A render the index found in a listing. */
export interface MediaRenderEntry {
  key: string;
  /** Render file path as listed (may carry the media folder prefix). */
  path: string;
  /** Manifest path, when a manifest was listed beside it. */
  manifestPath: string | null;
  size: number;
}

/** Filesystem-safe stem from a source reference's basename (`take.webm` → `take`). */
export function mediaRenderStem(src: string): string {
  const base = src.split(/[?#]/, 1)[0].split('/').pop() ?? 'media';
  const stem = base.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '_');
  return stem.slice(0, 80) || 'media';
}

export function mediaRenderFilePath(src: string, key: string, extension: string): string {
  return `${MEDIA_RENDER_DIR}/${mediaRenderStem(src)}.${key}.${extension}`;
}

export function mediaRenderManifestPath(src: string, key: string): string {
  return `${MEDIA_RENDER_DIR}/${mediaRenderStem(src)}.${key}.json`;
}

export interface ParsedMediaRenderPath {
  stem: string;
  key: string;
  extension: string;
  isManifest: boolean;
}

/**
 * Recognize a render or manifest path, with or without a leading media
 * folder (`notes_files/.mediaEdits/take.1a2b3c4d5e6f.webm`).
 */
export function parseMediaRenderPath(path: string): ParsedMediaRenderPath | null {
  const segments = path.split('/');
  const dirIndex = segments.length - 2;
  if (dirIndex < 0 || segments[dirIndex] !== MEDIA_RENDER_DIR) return null;
  const match = segments[segments.length - 1].match(/^(.+)\.([0-9a-f]{12})\.([a-z0-9]+)$/);
  if (!match) return null;
  const extension = match[3];
  const isManifest = extension === 'json';
  if (!isManifest && !RENDER_EXTENSIONS.has(extension)) return null;
  return { stem: match[1], key: match[2], extension, isManifest };
}

export function isMediaRenderPath(path: string): boolean {
  return parseMediaRenderPath(path) != null;
}

/**
 * Index a media listing by render key. Entries that are not renders are
 * ignored; a render whose manifest is missing is still indexed (it plays),
 * with `manifestPath: null`.
 */
export function buildMediaRenderIndex(
  entries: ReadonlyArray<{ name: string; size: number }>,
): Map<string, MediaRenderEntry> {
  const manifests = new Map<string, string>();
  const renders: Array<{ key: string; path: string; size: number }> = [];
  for (const entry of entries) {
    const parsed = parseMediaRenderPath(entry.name);
    if (!parsed) continue;
    if (parsed.isManifest) manifests.set(parsed.key, entry.name);
    else renders.push({ key: parsed.key, path: entry.name, size: entry.size });
  }
  const index = new Map<string, MediaRenderEntry>();
  for (const render of renders) {
    index.set(render.key, { ...render, manifestPath: manifests.get(render.key) ?? null });
  }
  return index;
}

/** Validate manifest JSON; null when malformed or from an unknown version. */
export function parseMediaRenderManifest(text: string): MediaRenderManifest | null {
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
  if (m.version !== MEDIA_RENDER_MANIFEST_VERSION) return null;
  if (!str(m.src) || !str(m.key) || !str(m.fx) || !str(m.file) || !str(m.mimeType)) return null;
  if (!str(m.engine) || !str(m.createdAt)) return null;
  const ignoredOps = Array.isArray(m.ignoredOps) ? m.ignoredOps.filter(str) : [];
  const manifest: MediaRenderManifest = {
    version: MEDIA_RENDER_MANIFEST_VERSION,
    src: m.src,
    key: m.key,
    fx: m.fx,
    ignoredOps,
    file: m.file,
    mimeType: m.mimeType,
    sourceSize: numOrNull(m.sourceSize),
    sourceDuration: numOrNull(m.sourceDuration),
    engine: m.engine,
    createdAt: m.createdAt,
  };
  if (m.analysis && typeof m.analysis === 'object') {
    const a = m.analysis as Record<string, unknown>;
    const analysis: MediaRenderAnalysis = {};
    const lufs = numOrNull(a.integratedLufs);
    const gain = numOrNull(a.appliedGainDb);
    const breaths = numOrNull(a.breathCount);
    if (lufs != null) analysis.integratedLufs = lufs;
    if (gain != null) analysis.appliedGainDb = gain;
    if (breaths != null) analysis.breathCount = breaths;
    manifest.analysis = analysis;
  }
  return manifest;
}

export function serializeMediaRenderManifest(manifest: MediaRenderManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * Why a render no longer matches its source, or null when it is current.
 *
 * - `source-changed` — the source file's size differs from render time
 *   (a re-recorded take under the same name).
 * - `engine-upgraded` — the render skipped ops the current engine now knows,
 *   so re-rendering would apply them.
 */
export function mediaRenderStaleness(
  manifest: MediaRenderManifest,
  current: { sourceSize?: number | null; knownOps?: readonly MediaFxOpId[] },
): 'source-changed' | 'engine-upgraded' | null {
  if (
    current.sourceSize != null &&
    manifest.sourceSize != null &&
    current.sourceSize !== manifest.sourceSize
  ) {
    return 'source-changed';
  }
  const known = new Set<string>(current.knownOps ?? MEDIA_FX_ORDER);
  const nowKnown = manifest.ignoredOps.some((token) =>
    known.has(token.split(':', 1)[0].toLowerCase()),
  );
  return nowKnown ? 'engine-upgraded' : null;
}

// ── Document references ─────────────────────────────────────────────

function flattenBlocks(blocks: readonly Block[], out: Block[] = []): Block[] {
  for (const block of blocks) {
    out.push(block);
    if (block.children && block.children.length > 0) flattenBlocks(block.children, out);
  }
  return out;
}

/** Every media clip in a doc (block-anchored and document-anchored). */
export function collectDocMediaClips(doc: Doc): MediaClip[] {
  const clips: MediaClip[] = [];
  for (const block of flattenBlocks(doc.blocks)) clips.push(...(block.media ?? []));
  clips.push(...(doc.documentMedia ?? []));
  return clips;
}

/** The render key a clip needs, or null when its recipe renders nothing. */
export function mediaClipRenderKey(clip: MediaClip): string | null {
  const fx = clip.edits?.fx;
  return hasRenderableFx(fx) ? mediaRenderKey(clip.src, fx) : null;
}

/** Render keys referenced by the doc's current recipes. */
export function referencedMediaRenderKeys(doc: Doc): Set<string> {
  const keys = new Set<string>();
  for (const clip of collectDocMediaClips(doc)) {
    const key = mediaClipRenderKey(clip);
    if (key) keys.add(key);
  }
  return keys;
}

/** Render key for a raw `src` + `fx` string pair (for callers holding strings). */
export function mediaRenderKeyFor(src: string, fx: string | undefined): string | null {
  const chain = parseMediaFx(fx) ?? undefined;
  return hasRenderableFx(chain) ? mediaRenderKey(src, chain) : null;
}

/**
 * Paths eligible for garbage collection: renders (and their manifests) whose
 * key no current recipe references and whose manifest is older than
 * `olderThanDays`. A render without a manifest has no age, so it is collected
 * only once unreferenced — it cannot be the cache of a pending undo, because
 * every render this engine writes carries a manifest.
 */
export function selectMediaRendersForGc(
  index: ReadonlyMap<string, MediaRenderEntry>,
  referencedKeys: ReadonlySet<string>,
  manifests: ReadonlyMap<string, MediaRenderManifest>,
  now: Date = new Date(),
  olderThanDays: number = MEDIA_RENDER_GC_AGE_DAYS,
): string[] {
  const cutoff = now.getTime() - olderThanDays * 24 * 60 * 60 * 1000;
  const paths: string[] = [];
  for (const [key, entry] of index) {
    if (referencedKeys.has(key)) continue;
    const manifest = manifests.get(key);
    if (manifest) {
      const created = Date.parse(manifest.createdAt);
      if (Number.isFinite(created) && created > cutoff) continue;
    }
    paths.push(entry.path);
    if (entry.manifestPath) paths.push(entry.manifestPath);
  }
  return paths;
}
