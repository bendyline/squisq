import { describe, expect, it } from 'vitest';
import type { PathLayer } from '../schemas/Doc';

describe('major-version core API types', () => {
  it('requires endpoint markers instead of the removed arrow field', () => {
    const layer: PathLayer = {
      id: 'path',
      type: 'path',
      position: { x: 0, y: 0, width: 10, height: 10 },
      content: {
        d: 'M 0 0 L 10 10',
        // @ts-expect-error Old documents are read tolerantly, but new code uses endMarker.
        arrow: 'end',
      },
    };
    expect(layer.content).toHaveProperty('arrow', 'end');
  });
});
