import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import type { MapLayer as MapLayerSchema } from '@bendyline/squisq/schemas';

const { composeMapImage } = vi.hoisted(() => ({
  composeMapImage: vi.fn(async () => 'data:image/png;base64,map'),
}));
vi.mock('../utils/mapTileUtils', () => ({ composeMapImage }));

import { MapLayer } from '../layers/MapLayer';

function layer(
  markers: MapLayerSchema['content']['markers'],
  showAttribution = true,
): MapLayerSchema {
  return {
    id: 'map',
    type: 'map',
    position: { x: 0, y: 0, width: 100, height: 100 },
    content: {
      center: { lat: 1, lng: 2 },
      zoom: 4,
      style: 'road',
      markers,
      showAttribution,
    },
  };
}

describe('MapLayer dependencies', () => {
  beforeEach(() => composeMapImage.mockClear());

  it('recomposes when markers or attribution change', async () => {
    const firstMarkers = [{ lat: 1, lng: 2, label: 'A' }];
    const { rerender } = render(
      <svg>
        <MapLayer
          layer={layer(firstMarkers)}
          basePath="."
          viewport={{ width: 100, height: 100 }}
          blockTime={0}
        />
      </svg>,
    );
    await waitFor(() => expect(composeMapImage).toHaveBeenCalledTimes(1));

    const secondMarkers = [{ lat: 3, lng: 4, label: 'B' }];
    rerender(
      <svg>
        <MapLayer
          layer={layer(secondMarkers, false)}
          basePath="."
          viewport={{ width: 100, height: 100 }}
          blockTime={0}
        />
      </svg>,
    );
    await waitFor(() => expect(composeMapImage).toHaveBeenCalledTimes(2));
    expect(composeMapImage).toHaveBeenLastCalledWith(
      expect.objectContaining({ markers: secondMarkers, showAttribution: false }),
    );
  });
});
