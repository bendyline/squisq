import { describe, expect, it } from 'vitest';
import { parseMediaFx } from '@bendyline/squisq/mediaEdit';
import type { MediaClip } from '@bendyline/squisq/schemas';
import {
  centeredCrop,
  companionEdits,
  cutSeconds,
  cutsForCompanion,
  draftFromEdits,
  editsFromDraft,
  editsSignature,
  formatClock,
} from '../mediaEdit/mediaEditDraft';
import type { EditableMedia } from '../mediaEdit/mediaEditTargets';

function media(partial: Partial<EditableMedia> & { anchor?: MediaClip['anchor'] }): EditableMedia {
  const clip: MediaClip = {
    id: partial.src ?? 'x',
    src: partial.src ?? 'x.webm',
    kind: partial.kind ?? 'video',
    startAt: partial.startAt ?? 0,
    anchor: partial.anchor ?? 'document',
  };
  return {
    src: clip.src,
    kind: clip.kind,
    sourceLine: partial.sourceLine ?? 1,
    startAt: partial.startAt ?? 0,
    clip,
    ...(partial.clipStart != null ? { clipStart: partial.clipStart } : {}),
    ...(partial.clipEnd != null ? { clipEnd: partial.clipEnd } : {}),
    ...(partial.edits ? { edits: partial.edits } : {}),
  };
}

describe('recipe draft', () => {
  it('round-trips a recipe and keeps fields the panel does not edit', () => {
    const edits = {
      fx: parseMediaFx('denoise:0.5 deess:3')!,
      cuts: [{ start: 1, end: 2 }],
      gain: -3,
      group: 'rec-a',
    };
    const draft = draftFromEdits(edits);
    expect(editsSignature(editsFromDraft(draft, edits))).toBe(editsSignature(edits));
  });

  it('drops neutral values and returns null when nothing is left', () => {
    const draft = draftFromEdits(undefined);
    expect(editsFromDraft(draft, undefined)).toBeNull();
    expect(editsFromDraft({ ...draft, gain: -2 }, undefined)).toEqual({ gain: -2 });
  });
});

describe('companion recipes', () => {
  const screen = media({ src: 'screen.webm', startAt: 0 });
  const camera = media({ src: 'camera.webm', startAt: 0.4, clipStart: 0, clipEnd: 60 });

  it('moves cuts into the companion’s own source time', () => {
    // Camera started 0.4 s later on the doc timeline: its source time is 0.4 s behind.
    expect(cutsForCompanion(screen, camera, [{ start: 5, end: 7 }])).toEqual([
      { start: 4.6, end: 6.6 },
    ]);
  });

  it('refuses to guess across different anchors', () => {
    const blockClip = media({ src: 'b.webm', anchor: 'block' });
    expect(cutsForCompanion(screen, blockClip, [{ start: 1, end: 2 }])).toBeNull();
  });

  it('shares the chain and cuts but keeps the companion’s own gain and crop', () => {
    const companion = media({
      src: 'camera.webm',
      startAt: 0,
      edits: { gain: -6, crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, group: 'g' },
    });
    const draft = {
      ...draftFromEdits(undefined),
      cuts: [{ start: 1, end: 2 }],
      gain: 3,
    };
    draft.fx.loudness.enabled = true;
    expect(companionEdits(screen, companion, draft)).toEqual({
      gain: -6,
      crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
      group: 'g',
      fx: { ops: [{ id: 'loudness', value: -16 }], unknown: [] },
      cuts: [{ start: 1, end: 2 }],
    });
  });
});

describe('helpers', () => {
  it('fits aspect crops to the frame', () => {
    expect(centeredCrop(1, 1920, 1080)).toEqual({
      x: (1 - 1080 / 1920) / 2,
      y: 0,
      w: 1080 / 1920,
      h: 1,
    });
    const tall = centeredCrop(16 / 9, 1000, 1000);
    expect(tall.w).toBe(1);
    expect(tall.h).toBeCloseTo(9 / 16, 9);
  });

  it('formats totals', () => {
    expect(
      cutSeconds([
        { start: 1, end: 2.5 },
        { start: 4, end: 5 },
      ]),
    ).toBe(2.5);
    expect(formatClock(125)).toBe('2:05');
  });
});
