/**
 * The media-edit panel's working copy of a clip's recipe, and how it maps back
 * onto the markdown recipe (`MediaEdits`) — for the edited clip and for its
 * grouped companions.
 */

import {
  MEDIA_FX_ORDER,
  MEDIA_FX_SPECS,
  normalizeMediaCuts,
  serializeMediaEdits,
  type MediaCrop,
  type MediaCut,
  type MediaFxChain,
  type MediaFxOpId,
} from '@bendyline/squisq/mediaEdit';
import type { MediaEdits } from '@bendyline/squisq/schemas';
import type { EditableMedia } from './mediaEditTargets';

export type StageDraft = { enabled: boolean; value: number };
export type FxDraft = Record<MediaFxOpId, StageDraft>;

export interface RecipeDraft {
  fx: FxDraft;
  /** Recipe tokens this editor does not know; preserved verbatim. */
  unknownFx: string[];
  cuts: MediaCut[];
  gain: number;
  fadeIn: number;
  fadeOut: number;
  crop: MediaCrop | null;
}

export type FxPreset = 'voice' | 'levels' | 'none';

export function draftFromFx(fx: MediaFxChain | undefined): FxDraft {
  const draft = {} as FxDraft;
  for (const id of MEDIA_FX_ORDER) {
    const op = fx?.ops.find((o) => o.id === id);
    draft[id] = { enabled: op != null, value: op?.value ?? MEDIA_FX_SPECS[id].defaultValue };
  }
  return draft;
}

export function presetFx(preset: FxPreset): FxDraft {
  const draft = draftFromFx(undefined);
  for (const id of MEDIA_FX_ORDER) {
    draft[id].enabled = preset === 'voice' || (preset === 'levels' && id === 'loudness');
  }
  return draft;
}

export function fxFromDraft(draft: RecipeDraft): MediaFxChain {
  return {
    ops: MEDIA_FX_ORDER.filter((id) => draft.fx[id].enabled).map((id) => ({
      id,
      value: draft.fx[id].value,
    })),
    unknown: [...draft.unknownFx],
  };
}

export function draftFromEdits(edits: MediaEdits | undefined): RecipeDraft {
  return {
    fx: draftFromFx(edits?.fx),
    unknownFx: [...(edits?.fx?.unknown ?? [])],
    cuts: edits?.cuts?.map((c) => ({ ...c })) ?? [],
    gain: edits?.gain ?? 0,
    fadeIn: edits?.fadeIn ?? 0,
    fadeOut: edits?.fadeOut ?? 0,
    crop: edits?.crop ? { ...edits.crop } : null,
  };
}

/** Set a field to `value`, or drop it when the value is neutral. */
function assign<K extends keyof MediaEdits>(
  edits: MediaEdits,
  key: K,
  value: MediaEdits[K] | undefined,
): void {
  if (value === undefined) delete edits[key];
  else edits[key] = value;
}

/**
 * The recipe for the edited clip: the draft over the saved recipe (keeping
 * fields the panel does not edit, like `group`). Null when nothing is left.
 */
export function editsFromDraft(
  draft: RecipeDraft,
  base: MediaEdits | undefined,
): MediaEdits | null {
  const edits: MediaEdits = { ...base };
  const fx = fxFromDraft(draft);
  assign(edits, 'fx', fx.ops.length > 0 || fx.unknown.length > 0 ? fx : undefined);
  const cuts = normalizeMediaCuts(draft.cuts);
  assign(edits, 'cuts', cuts.length > 0 ? cuts : undefined);
  assign(edits, 'gain', draft.gain !== 0 ? draft.gain : undefined);
  assign(edits, 'fadeIn', draft.fadeIn > 0 ? draft.fadeIn : undefined);
  assign(edits, 'fadeOut', draft.fadeOut > 0 ? draft.fadeOut : undefined);
  assign(edits, 'crop', draft.crop ?? undefined);
  return Object.keys(edits).length > 0 ? edits : null;
}

/** Stable text form of a recipe, for "has anything changed" checks. */
export function editsSignature(edits: MediaEdits | null | undefined): string {
  return JSON.stringify(serializeMediaEdits(edits ?? undefined));
}

/**
 * Move source-time cuts from one clip to a companion recorded alongside it:
 * the same moment in doc time, expressed in the companion's own source time.
 * Null when the clips are timed against different anchors (no shared clock).
 */
export function cutsForCompanion(
  primary: EditableMedia,
  companion: EditableMedia,
  cuts: readonly MediaCut[],
): MediaCut[] | null {
  if (primary.clip.anchor !== companion.clip.anchor) return null;
  const offset =
    (companion.clipStart ?? 0) -
    (companion.startAt ?? 0) -
    ((primary.clipStart ?? 0) - (primary.startAt ?? 0));
  return normalizeMediaCuts(
    cuts.map((c) => ({ start: c.start + offset, end: c.end + offset })),
    companion.clipStart ?? 0,
    companion.clipEnd ?? Number.POSITIVE_INFINITY,
  );
}

/**
 * A companion's recipe after the panel applies: it shares the signal chain and
 * the cuts (so the pair stays in sync); its own gain, fades and crop are kept.
 */
export function companionEdits(
  primary: EditableMedia,
  companion: EditableMedia,
  draft: RecipeDraft,
): MediaEdits | null {
  const edits: MediaEdits = { ...companion.edits };
  const fx = fxFromDraft(draft);
  assign(edits, 'fx', fx.ops.length > 0 || fx.unknown.length > 0 ? fx : undefined);
  const cuts = cutsForCompanion(primary, companion, draft.cuts);
  if (cuts) assign(edits, 'cuts', cuts.length > 0 ? cuts : undefined);
  return Object.keys(edits).length > 0 ? edits : null;
}

/** Total seconds the cuts remove. */
export function cutSeconds(cuts: readonly MediaCut[]): number {
  return cuts.reduce((sum, c) => sum + (c.end - c.start), 0);
}

/** `m:ss` for a duration in seconds. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Largest centered crop with `ratio` (width / height, in pixels) for a frame. */
export function centeredCrop(ratio: number, frameWidth: number, frameHeight: number): MediaCrop {
  const frameRatio = frameWidth / frameHeight;
  if (ratio >= frameRatio) {
    const h = frameRatio / ratio;
    return { x: 0, y: (1 - h) / 2, w: 1, h };
  }
  const w = ratio / frameRatio;
  return { x: (1 - w) / 2, y: 0, w, h: 1 };
}
