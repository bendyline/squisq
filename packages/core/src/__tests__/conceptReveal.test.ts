import { describe, expect, it } from 'vitest';
import { expandDocBlocks } from '../doc/templates/index.js';
import { blockBuildSteps, buildSourceText, resolveBuildTimeline } from '../doc/builds.js';
import type { DocBlock } from '../schemas/BlockTemplates.js';
import { VIEWPORT_PRESETS } from '../schemas/Viewport.js';
import {
  conceptRevealTiming,
  conceptTemplate,
  matchPointsToSentences,
} from '../transform/conceptReveal.js';

const narration =
  'Lava rises through a crack in the sea floor. The lava cools into rock and builds a mound. ' +
  'Over thousands of years the mound breaks the surface as an island.';

describe('concept reveals', () => {
  it('places each point at the sentence that says it, in order', () => {
    const offsets = matchPointsToSentences(
      ['Lava rises through a crack', 'Rock builds a mound', 'The mound breaks the surface'],
      narration,
      0,
      narration.length,
    );
    // A sentence starts after the space that ends the one before it.
    expect(offsets).toEqual([0, narration.indexOf(' The lava'), narration.indexOf(' Over')]);
    // Out of order, or sharing too few words with any sentence: no placement.
    expect(
      matchPointsToSentences(['Island surface', 'Lava crack'], narration, 0, narration.length),
    ).toBeUndefined();
    expect(matchPointsToSentences(['Coral'], narration, 0, narration.length)).toBeUndefined();
  });

  it.each([
    [
      'process',
      ['Rise: lava climbs a crack', 'Cool: it turns to rock', 'Surface: an island forms'],
    ],
    ['process', ['1950: first eruption', '1963: new island', '1967: eruptions end']],
    ['cards', ['Lava: molten rock', 'Rock: cooled lava']],
  ] as const)('times a %s block the renderer accepts in every frame', (template, items) => {
    const times = items.map((_, index) => 12 + index * 4);
    const build = conceptRevealTiming(template, items, times, 10, 30);
    expect(build.buildTiming!.starts[0]).toBeLessThanOrEqual(1);
    expect(build.buildTiming!.starts.slice(1)).toEqual(times.slice(1).map((time) => time - 10));
    const block = { id: 'b', template, items: [...items], duration: 20, ...build } as DocBlock;
    for (const viewport of [VIEWPORT_PRESETS.landscape, VIEWPORT_PRESETS.portrait]) {
      const drawn = expandDocBlocks([block], { viewport })[0]!;
      const steps = blockBuildSteps(drawn);
      expect(build.buildTiming!.sourceText).toBe(buildSourceText(steps));
      const timeline = resolveBuildTimeline(steps, drawn.build!, drawn.duration, drawn.buildTiming);
      expect(timeline.starts).toEqual(build.buildTiming!.starts);
    }
  });

  it('reveals evenly without one time per idea', () => {
    expect(conceptRevealTiming('cycle', ['A one', 'B two', 'C three'], [1, 2], 0, 10)).toEqual({
      build: { mode: 'items', effect: 'fadeInUp', previous: 'keep' },
    });
    expect(conceptTemplate('layers')).toBe('layers');
    expect(conceptTemplate('list')).toBeUndefined();
  });
});
