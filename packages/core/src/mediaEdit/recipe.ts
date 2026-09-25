/**
 * Media-edit recipes — the non-destructive edit list a media reference carries.
 *
 * A recipe lives in the markdown, as parameters on the `{[audio|video …]}`
 * annotation or `data-squisq-{audio|video}-*` attributes on a standalone
 * `<audio>` / `<video>` tag. The source file is never modified: timeline ops
 * (`cuts`, `gain`, `fadeIn`, `fadeOut`, `crop`) are applied at playback and
 * export, and the signal chain (`fx`) is rendered into a derived, time-aligned
 * audio file (see `renderStore.ts`). Undo is therefore the editor's ordinary
 * undo, and a reference with no recipe behaves exactly as before.
 *
 * Pure and dependency-free: runs in the browser and in Node.
 */

// ── Signal chain (`fx`) ─────────────────────────────────────────────

/** Signal operations, in the FIXED order the chain applies them. */
export const MEDIA_FX_ORDER = ['highpass', 'denoise', 'debreath', 'loudness'] as const;

export type MediaFxOpId = (typeof MEDIA_FX_ORDER)[number];

interface MediaFxOpSpec {
  /** Value used when the token carries none (`denoise` ≡ `denoise:0.8`). */
  defaultValue: number;
  min: number;
  max: number;
}

/**
 * Parameter contract per op. Values are clamped into range on parse, so a
 * recipe always describes something the engine can render.
 *
 * - `highpass` — corner frequency in Hz.
 * - `denoise` — wet/dry strength, 0…1.
 * - `debreath` — attenuation applied to detected breaths, in dB (≤ 0).
 * - `loudness` — integrated loudness target in LUFS.
 */
export const MEDIA_FX_SPECS: Readonly<Record<MediaFxOpId, MediaFxOpSpec>> = Object.freeze({
  highpass: { defaultValue: 80, min: 20, max: 300 },
  denoise: { defaultValue: 0.8, min: 0, max: 1 },
  debreath: { defaultValue: -15, min: -40, max: 0 },
  loudness: { defaultValue: -16, min: -31, max: -5 },
});

export interface MediaFxOp {
  id: MediaFxOpId;
  value: number;
}

export interface MediaFxChain {
  /** Known ops, de-duplicated (last wins) and in {@link MEDIA_FX_ORDER}. */
  ops: MediaFxOp[];
  /**
   * Tokens this engine does not understand, preserved verbatim so a recipe
   * written by a newer engine survives a round-trip through an older one.
   * They are never rendered.
   */
  unknown: string[];
}

// ── Timeline ops ────────────────────────────────────────────────────

/** A removed range of the SOURCE file, in seconds (`start < end`). */
export interface MediaCut {
  start: number;
  end: number;
}

/** A crop rectangle, normalized to the source frame (0…1 on each axis). */
export interface MediaCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The complete recipe a media reference can carry. Every field is optional. */
export interface MediaEdits {
  fx?: MediaFxChain;
  /** Normalized: sorted, merged, non-overlapping. */
  cuts?: MediaCut[];
  /** Clip gain in dB. */
  gain?: number;
  /** Fade-in length in seconds, at the start of the played clip. */
  fadeIn?: number;
  /** Fade-out length in seconds, at the end of the played clip. */
  fadeOut?: number;
  crop?: MediaCrop;
  /**
   * Links companion clips (a screen + camera capture, a narration audio +
   * video pair). Editors propagate cuts, trims and `fx` across a group.
   */
  group?: string;
}

/** Raw string values of a recipe, keyed by {@link MediaEditParamKey}. */
export type MediaEditParamValues = Partial<Record<MediaEditParamKey, string>>;

export type MediaEditParamKey = 'fx' | 'cuts' | 'gain' | 'fadeIn' | 'fadeOut' | 'crop' | 'group';

/**
 * Every recipe parameter with its two spellings: the annotation key
 * (`fadeIn=0.3`) and the HTML attribute suffix, appended to the per-kind
 * prefix (`data-squisq-video-fade-in="0.3"`). The order is the canonical
 * serialization order.
 */
export const MEDIA_EDIT_PARAMS: ReadonlyArray<{ key: MediaEditParamKey; htmlSuffix: string }> = [
  { key: 'fx', htmlSuffix: 'fx' },
  { key: 'cuts', htmlSuffix: 'cuts' },
  { key: 'gain', htmlSuffix: 'gain' },
  { key: 'fadeIn', htmlSuffix: 'fade-in' },
  { key: 'fadeOut', htmlSuffix: 'fade-out' },
  { key: 'crop', htmlSuffix: 'crop' },
  { key: 'group', htmlSuffix: 'group' },
];

/** `data-squisq-video-fade-in` for (`video`, `fadeIn`). */
export function mediaEditHtmlAttribute(kind: 'audio' | 'video', key: MediaEditParamKey): string {
  const param = MEDIA_EDIT_PARAMS.find((p) => p.key === key);
  return `data-squisq-${kind}-${param?.htmlSuffix ?? key}`;
}

// ── Number formatting ───────────────────────────────────────────────

/** Compact, stable decimal: at most `digits` fraction digits, no `-0`. */
export function formatMediaNumber(value: number, digits = 3): string {
  const rounded = Number(value.toFixed(digits));
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

function finiteNumber(raw: string | undefined): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!/^[-+]?(\d+(\.\d*)?|\.\d+)$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Seconds from `12.5`, `1:02.5` or `450ms`; null when unparseable or negative. */
function parseSeconds(raw: string): number | null {
  const trimmed = raw.trim();
  const bare = finiteNumber(trimmed);
  if (bare != null) return bare >= 0 ? bare : null;
  const ms = trimmed.match(/^(\d+(?:\.\d+)?)ms$/i);
  if (ms) return Number(ms[1]) / 1000;
  const mmss = trimmed.match(/^(\d+):([0-5]?\d)(?:\.(\d+))?$/);
  if (mmss) return Number(mmss[1]) * 60 + Number(mmss[2]) + Number(`0.${mmss[3] ?? '0'}`);
  return null;
}

// ── fx ──────────────────────────────────────────────────────────────

function isFxOpId(name: string): name is MediaFxOpId {
  return (MEDIA_FX_ORDER as readonly string[]).includes(name);
}

/**
 * Parse an `fx` value (`"highpass:80 denoise debreath:-15"`). Tokens split on
 * whitespace or commas. A known op with a missing value gets its default; a
 * known op with an unparseable value is kept verbatim in `unknown` rather
 * than guessed at. `debreath:15` is read as −15 dB (attenuation is the only
 * meaningful direction). Returns null when the value holds no tokens.
 */
export function parseMediaFx(raw: string | undefined): MediaFxChain | null {
  if (raw == null) return null;
  const tokens = raw.split(/[\s,]+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const byId = new Map<MediaFxOpId, number>();
  const unknown: string[] = [];
  for (const token of tokens) {
    const colon = token.indexOf(':');
    const name = (colon === -1 ? token : token.slice(0, colon)).toLowerCase();
    if (!isFxOpId(name)) {
      unknown.push(token);
      continue;
    }
    const spec = MEDIA_FX_SPECS[name];
    let value: number | null = spec.defaultValue;
    if (colon !== -1) {
      value = finiteNumber(token.slice(colon + 1));
      if (value != null && name === 'debreath') value = -Math.abs(value);
    }
    if (value == null) {
      unknown.push(token);
      continue;
    }
    byId.set(name, clamp(value, spec.min, spec.max));
  }
  const ops = MEDIA_FX_ORDER.filter((id) => byId.has(id)).map((id) => ({
    id,
    value: byId.get(id) as number,
  }));
  return { ops, unknown };
}

/**
 * Canonical `fx` string: known ops in chain order with explicit values, then
 * unknown tokens in their authored order. Explicit values keep a recipe's
 * meaning stable even if a later engine changes a default.
 */
export function serializeMediaFx(chain: MediaFxChain): string {
  return [
    ...chain.ops.map((op) => `${op.id}:${formatMediaNumber(op.value)}`),
    ...chain.unknown,
  ].join(' ');
}

/** True when the chain would render anything (it has at least one known op). */
export function hasRenderableFx(chain: MediaFxChain | undefined): chain is MediaFxChain {
  return chain != null && chain.ops.length > 0;
}

// ── cuts ────────────────────────────────────────────────────────────

/** Ranges closer than this merge; shorter ranges are dropped. */
const CUT_EPSILON = 0.001;

/**
 * Sort, merge overlapping or touching ranges, and drop empty ones. When a
 * `[windowStart, windowEnd]` source window is given (the clip's trim), cuts
 * are clamped into it and anything outside is dropped.
 */
export function normalizeMediaCuts(
  cuts: readonly MediaCut[],
  windowStart = 0,
  windowEnd = Number.POSITIVE_INFINITY,
): MediaCut[] {
  const clamped = cuts
    .filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end))
    .map((c) => ({
      start: Math.max(windowStart, Math.min(c.start, c.end)),
      end: Math.min(windowEnd, Math.max(c.start, c.end)),
    }))
    .filter((c) => c.end - c.start >= CUT_EPSILON)
    .sort((a, b) => a.start - b.start);
  const merged: MediaCut[] = [];
  for (const cut of clamped) {
    const last = merged[merged.length - 1];
    if (last && cut.start <= last.end + CUT_EPSILON) {
      last.end = Math.max(last.end, cut.end);
    } else {
      merged.push({ ...cut });
    }
  }
  return merged;
}

/**
 * Parse `"12.4-13.1 40.2-41"` (also `1:02-1:04.5`, comma separated). Invalid
 * ranges are dropped. Returns null when nothing valid remains.
 */
export function parseMediaCuts(raw: string | undefined): MediaCut[] | null {
  if (raw == null) return null;
  const cuts: MediaCut[] = [];
  for (const token of raw.split(/[\s,]+/).filter(Boolean)) {
    const dash = token.indexOf('-', 1);
    if (dash === -1) continue;
    const start = parseSeconds(token.slice(0, dash));
    const end = parseSeconds(token.slice(dash + 1));
    if (start == null || end == null || end <= start) continue;
    cuts.push({ start, end });
  }
  const normalized = normalizeMediaCuts(cuts);
  return normalized.length > 0 ? normalized : null;
}

export function serializeMediaCuts(cuts: readonly MediaCut[]): string {
  return normalizeMediaCuts(cuts)
    .map((c) => `${formatMediaNumber(c.start)}-${formatMediaNumber(c.end)}`)
    .join(' ');
}

// ── crop ────────────────────────────────────────────────────────────

/** Smallest crop edge, as a fraction of the frame. */
const MIN_CROP_EDGE = 0.02;

/**
 * Parse `"x y w h"` (fractions of the source frame). The rectangle is clamped
 * inside the frame. A full-frame rectangle means "no crop" and returns null.
 */
export function parseMediaCrop(raw: string | undefined): MediaCrop | null {
  if (raw == null) return null;
  const parts = raw
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((p) => finiteNumber(p));
  if (parts.length !== 4 || parts.some((p) => p == null)) return null;
  return normalizeMediaCrop({
    x: parts[0] as number,
    y: parts[1] as number,
    w: parts[2] as number,
    h: parts[3] as number,
  });
}

/** Clamp a crop rectangle into the frame; null when it covers the whole frame. */
export function normalizeMediaCrop(crop: MediaCrop): MediaCrop | null {
  const x = clamp(crop.x, 0, 1 - MIN_CROP_EDGE);
  const y = clamp(crop.y, 0, 1 - MIN_CROP_EDGE);
  const w = clamp(crop.w, MIN_CROP_EDGE, 1 - x);
  const h = clamp(crop.h, MIN_CROP_EDGE, 1 - y);
  const full = x < 1e-4 && y < 1e-4 && w > 1 - 1e-4 && h > 1 - 1e-4;
  return full ? null : { x, y, w, h };
}

export function serializeMediaCrop(crop: MediaCrop): string {
  return [crop.x, crop.y, crop.w, crop.h].map((n) => formatMediaNumber(n, 4)).join(' ');
}

// ── Whole recipe ────────────────────────────────────────────────────

const GAIN_RANGE = { min: -60, max: 24 };
const GROUP_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Parse a recipe from raw parameter values. Invalid fields are dropped
 * (never guessed); neutral values (`gain=0`, `fadeIn=0`, full-frame crop)
 * are dropped too. Returns undefined when nothing remains, so callers can
 * leave `MediaClip.edits` unset for an unedited reference.
 */
export function parseMediaEdits(values: MediaEditParamValues): MediaEdits | undefined {
  const edits: MediaEdits = {};
  const fx = parseMediaFx(values.fx);
  if (fx && (fx.ops.length > 0 || fx.unknown.length > 0)) edits.fx = fx;
  const cuts = parseMediaCuts(values.cuts);
  if (cuts) edits.cuts = cuts;
  const gain = finiteNumber(values.gain);
  if (gain != null && gain !== 0) edits.gain = clamp(gain, GAIN_RANGE.min, GAIN_RANGE.max);
  const fadeIn = values.fadeIn == null ? null : parseSeconds(values.fadeIn);
  if (fadeIn != null && fadeIn > 0) edits.fadeIn = fadeIn;
  const fadeOut = values.fadeOut == null ? null : parseSeconds(values.fadeOut);
  if (fadeOut != null && fadeOut > 0) edits.fadeOut = fadeOut;
  const crop = parseMediaCrop(values.crop);
  if (crop) edits.crop = crop;
  const group = values.group?.trim();
  if (group && GROUP_RE.test(group)) edits.group = group;
  return Object.keys(edits).length > 0 ? edits : undefined;
}

/**
 * Serialize a recipe to raw parameter values. A key maps to `null` when its
 * field is absent, so a writer can remove a stale attribute with the same
 * call that sets the others.
 */
export function serializeMediaEdits(
  edits: MediaEdits | undefined,
): Record<MediaEditParamKey, string | null> {
  const fx = edits?.fx && (edits.fx.ops.length > 0 || edits.fx.unknown.length > 0);
  return {
    fx: fx && edits?.fx ? serializeMediaFx(edits.fx) : null,
    cuts: edits?.cuts && edits.cuts.length > 0 ? serializeMediaCuts(edits.cuts) : null,
    gain: edits?.gain ? formatMediaNumber(edits.gain, 2) : null,
    fadeIn: edits?.fadeIn ? formatMediaNumber(edits.fadeIn) : null,
    fadeOut: edits?.fadeOut ? formatMediaNumber(edits.fadeOut) : null,
    crop: edits?.crop ? serializeMediaCrop(edits.crop) : null,
    group: edits?.group ?? null,
  };
}

/** Read recipe values from annotation params (`fx=…`, `fadeIn=…`). */
export function mediaEditValuesFromParams(params: Record<string, string>): MediaEditParamValues {
  const out: MediaEditParamValues = {};
  for (const { key } of MEDIA_EDIT_PARAMS) {
    if (params[key] != null) out[key] = params[key];
  }
  return out;
}

/** Read recipe values from HTML attributes (`data-squisq-video-fade-in=…`). */
export function mediaEditValuesFromAttributes(
  kind: 'audio' | 'video',
  attributes: Record<string, string>,
): MediaEditParamValues {
  const out: MediaEditParamValues = {};
  for (const { key } of MEDIA_EDIT_PARAMS) {
    const value = attributes[mediaEditHtmlAttribute(kind, key)];
    if (value != null) out[key] = value;
  }
  return out;
}

// ── Render key ──────────────────────────────────────────────────────

/**
 * 64-bit FNV-1a over UTF-16 code units, as 16 hex digits. Synchronous so pure
 * code (schedules, paths) can derive keys; this names cache files, it is not
 * a security boundary.
 */
function fnv1a64Hex(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
    h2 ^= h2 >>> 15;
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

/**
 * Stable key naming the render of `src` under `fx`. Only the known, canonical
 * ops take part — unknown tokens are not rendered, so they must not force a
 * re-render (the render manifest records them instead). 12 hex digits.
 */
export function mediaRenderKey(src: string, fx: MediaFxChain): string {
  const canonical = fx.ops.map((op) => `${op.id}:${formatMediaNumber(op.value)}`).join(' ');
  return fnv1a64Hex(`${src}\n${canonical}`).slice(0, 12);
}
