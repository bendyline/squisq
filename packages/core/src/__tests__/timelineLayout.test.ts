/**
 * Timeline horizontal lockup: the track-label column hugs its label so the
 * label + axis group is visually centred, not merely bounding-box centred.
 */
import { describe, expect, it } from 'vitest';
import { VIEWPORT_PRESETS, createTemplateContext, resolveTheme } from '../schemas/index.js';
import { timelineBlock } from '../doc/templates/timelineBlock.js';
import type { Layer } from '../schemas/Doc.js';

const tonga = {
  template: 'timeline' as const,
  id: 'tonga-timeline',
  duration: 10,
  audioSegment: 0,
  title: 'A kingdom that bent rather than broke',
  tracks: [
    {
      id: 'tonga',
      label: 'Tonga',
      events: [
        {
          id: 'bounty',
          label: '1789',
          position: 0.06,
          description: "Bounty mutineers rebel off Ha'apai",
        },
        {
          id: 'constitution',
          label: '1875',
          position: 0.38,
          description: 'Constitutional monarchy',
        },
        { id: 'eruption', label: '2022', position: 0.94, description: 'Hunga Tonga eruption' },
      ],
    },
  ],
};

const box = (layer: Layer | undefined): { x: number; width: number } => {
  const position = layer?.position as { x: number; width: number } | undefined;
  if (!position) throw new Error(`layer ${layer?.id ?? '?'} has no numeric position`);
  return position;
};

describe('timeline horizontal lockup', () => {
  for (const [name, viewport] of [
    ['landscape', VIEWPORT_PRESETS.landscape],
    ['portrait', VIEWPORT_PRESETS.portrait],
  ] as const) {
    it(`centres the label + axis lockup in ${name}`, () => {
      const context = createTemplateContext(resolveTheme('warm-earth'), 0, 1, viewport);
      const layers = timelineBlock(tonga, context);
      const track = box(layers.find((l) => l.id === 'timeline-track-tonga-0'));
      const label = box(layers.find((l) => l.id === 'timeline-track-label-tonga-0'));
      const labelLeft = label.x - label.width / 2; // centre-anchored text box
      const axisRight = track.x + track.width;
      // Same breathing room on both sides of the lockup.
      expect(Math.abs(labelLeft - (viewport.width - axisRight))).toBeLessThan(1);
      // The column is sized to the label: the axis begins just past "Tonga"
      // (its estimated width plus the gap), not 18% of the width in, which
      // used to leave ~200 px of empty column on the left.
      const labelLayer = layers.find((l) => l.id === 'timeline-track-label-tonga-0') as {
        content: { style: { fontSize: number } };
      };
      const fontSize = labelLayer.content.style.fontSize;
      expect(track.x - labelLeft).toBeGreaterThan(fontSize * 'Tonga'.length * 0.5);
      expect(track.x - labelLeft).toBeLessThan(fontSize * 'Tonga'.length * 0.75 + 40);
      expect(track.x - labelLeft).toBeLessThan(Math.min(280, viewport.width * 0.18));
    });
  }

  it('runs the axis margin to margin when no track has a label', () => {
    const viewport = VIEWPORT_PRESETS.landscape;
    const context = createTemplateContext(resolveTheme('warm-earth'), 0, 1, viewport);
    const unlabeled = { ...tonga, tracks: [{ ...tonga.tracks[0], label: undefined }] };
    const track = box(
      timelineBlock(unlabeled, context).find((l) => l.id === 'timeline-track-tonga-0'),
    );
    expect(Math.abs(track.x - (viewport.width - (track.x + track.width)))).toBeLessThan(1);
  });
});
