import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import type { MapLayer as MapLayerSchema, MediaProvider } from '@bendyline/squisq/schemas';
import { LOCAL_ONLY_RESOURCE_POLICY } from '@bendyline/squisq/markdown';
import { MediaContext, ResourcePolicyContext } from '../hooks/MediaContext';

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

// `staticSrc` is document-controlled, so it must be governed by the resource
// policy and resolved through the MediaProvider like every other media URL.
// Concatenating `basePath + '/' + staticSrc` instead lets an untrusted doc
// fetch an arbitrary remote URL under a LOCAL_ONLY policy, never resolves
// container-backed paths, and mangles `//host/…`, `data:` and `blob:` values.
describe('MapLayer staticSrc', () => {
  beforeEach(() => composeMapImage.mockClear());

  function staticLayer(staticSrc: string): MapLayerSchema {
    return {
      id: 'map',
      type: 'map',
      position: { x: 0, y: 0, width: 100, height: 100 },
      content: { center: { lat: 1, lng: 2 }, zoom: 4, style: 'road', staticSrc },
    };
  }

  function renderStatic(
    staticSrc: string,
    opts: { policy?: typeof LOCAL_ONLY_RESOURCE_POLICY; provider?: MediaProvider } = {},
  ) {
    const tree = (
      <svg>
        <MapLayer
          layer={staticLayer(staticSrc)}
          basePath="."
          viewport={{ width: 100, height: 100 }}
          blockTime={0}
        />
      </svg>
    );
    const withProvider = opts.provider ? (
      <MediaContext.Provider value={opts.provider}>{tree}</MediaContext.Provider>
    ) : (
      tree
    );
    return render(
      opts.policy ? (
        <ResourcePolicyContext.Provider value={opts.policy}>
          {withProvider}
        </ResourcePolicyContext.Provider>
      ) : (
        withProvider
      ),
    );
  }

  const href = (c: HTMLElement) => c.querySelector('image')?.getAttribute('href');

  it('renders an allowed remote static image under the default policy', async () => {
    const { container } = renderStatic('https://cdn.example.test/map.png');
    await waitFor(() => expect(href(container)).toBe('https://cdn.example.test/map.png'));
    expect(composeMapImage).not.toHaveBeenCalled();
  });

  it('blocks a remote static image under a LOCAL_ONLY policy', async () => {
    const { container } = renderStatic('https://evil.example.test/map.png', {
      policy: LOCAL_ONLY_RESOURCE_POLICY,
    });
    // Blocked: no <image> is emitted at all, and the layer must NOT quietly
    // fall through to composing live tiles instead.
    await waitFor(() => expect(container.textContent).toContain('Map failed to load'));
    expect(href(container)).toBeUndefined();
    expect(composeMapImage).not.toHaveBeenCalled();
  });

  it('resolves a container-backed path through the MediaProvider', async () => {
    const provider = {
      resolveUrl: vi.fn(async (p: string) => `blob:resolved-${p}`),
    } as unknown as MediaProvider;
    const { container } = renderStatic('images/map.png', { provider });

    await waitFor(() => expect(href(container)).toBe('blob:resolved-images/map.png'));
    expect(provider.resolveUrl).toHaveBeenCalledWith('images/map.png');
  });

  it('does not basePath-prefix a data URI', async () => {
    const { container } = renderStatic('data:image/png;base64,abc');
    await waitFor(() => expect(href(container)).toBe('data:image/png;base64,abc'));
  });

  it('does not basePath-prefix a protocol-relative URL', async () => {
    const { container } = renderStatic('//cdn.example.test/map.png');
    await waitFor(() => expect(href(container)).toBe('//cdn.example.test/map.png'));
  });
});
