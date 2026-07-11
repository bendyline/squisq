import { describe, expect, it } from 'vitest';

import { filterMediaDataKeys } from '../slotStorage.js';

describe('filterMediaDataKeys', () => {
  it('does not expose metadata sidecars as duplicate media assets', () => {
    expect(
      filterMediaDataKeys(
        [
          'slot:2:media:hero.png',
          'slot:2:media:hero.png:info',
          'slot:2:media:narration.mp3',
          'slot:2:media:narration.mp3:info',
          'slot:1:media:other.png',
        ],
        2,
      ),
    ).toEqual(['slot:2:media:hero.png', 'slot:2:media:narration.mp3']);
  });
});
