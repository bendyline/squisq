import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_INTERACTIVE_RESOURCE_POLICY,
  LOCAL_ONLY_RESOURCE_POLICY,
  ResourcePolicyError,
} from '@bendyline/squisq/markdown';
import { composeMapImage, TILE_PROVIDERS } from '../utils/mapTileUtils';

/**
 * Composing a map is the ONLY path in this package that necessarily contacts a
 * third party: a tile request discloses the viewer's IP and the coordinates
 * being viewed to the provider. It was reaching the network via
 * `new Image(); img.src = url` with no policy consulted at all, so a host
 * rendering under LOCAL_ONLY — and a reader opening an exported HTML file
 * containing a map block — leaked to OpenStreetMap/Esri/Stadia regardless.
 *
 * The gate must fail LOUDLY. The per-tile fetch is wrapped in a catch that
 * swallows load errors, so a blocked provider would otherwise compose a
 * plausible-looking blank map (with attribution drawn on it) and hide the fact
 * that the policy stopped it.
 */

const BASE = {
  center: { lat: 51.5, lng: -0.12 },
  zoom: 12,
  width: 256,
  height: 256,
} as const;

/** Count every image the compose attempts, whatever the tile host. */
function spyOnImageConstruction(): { count: () => number; restore: () => void } {
  const RealImage = globalThis.Image;
  let constructed = 0;
  class CountingImage {
    crossOrigin = '';
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) {
      // Never resolves — a leak would hang rather than pass silently.
    }
    constructor() {
      constructed++;
    }
  }
  globalThis.Image = CountingImage as unknown as typeof globalThis.Image;
  return {
    count: () => constructed,
    restore: () => {
      globalThis.Image = RealImage;
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe('composeMapImage resource policy', () => {
  it('refuses to contact the tile host under LOCAL_ONLY, and makes no request', async () => {
    const images = spyOnImageConstruction();
    try {
      await expect(
        composeMapImage({ ...BASE, style: 'road', policy: LOCAL_ONLY_RESOURCE_POLICY }),
      ).rejects.toBeInstanceOf(ResourcePolicyError);
      // The point of the fix: not one byte left the machine.
      expect(images.count()).toBe(0);
    } finally {
      images.restore();
    }
  });

  it.each(Object.keys(TILE_PROVIDERS) as Array<keyof typeof TILE_PROVIDERS>)(
    'blocks the "%s" provider under LOCAL_ONLY',
    async (style) => {
      // Every provider is a remote host; none may slip through.
      const images = spyOnImageConstruction();
      try {
        await expect(
          composeMapImage({ ...BASE, style, policy: LOCAL_ONLY_RESOURCE_POLICY }),
        ).rejects.toBeInstanceOf(ResourcePolicyError);
        expect(images.count()).toBe(0);
      } finally {
        images.restore();
      }
    },
  );

  it('blocks a provider absent from an allowedHosts list', async () => {
    const images = spyOnImageConstruction();
    try {
      await expect(
        composeMapImage({
          ...BASE,
          style: 'road',
          policy: { allowRemote: true, allowedHosts: ['tiles.internal.example'] },
        }),
      ).rejects.toBeInstanceOf(ResourcePolicyError);
      expect(images.count()).toBe(0);
    } finally {
      images.restore();
    }
  });

  it('names the style and points at staticSrc so the block is actionable', async () => {
    await expect(
      composeMapImage({ ...BASE, style: 'satellite', policy: LOCAL_ONLY_RESOURCE_POLICY }),
    ).rejects.toThrow(/satellite[\s\S]*staticSrc/);
  });

  /**
   * Negative controls: the gate must be a POLICY check, not a blanket refusal.
   *
   * jsdom ships no canvas backend, so a compose that gets past the gate dies
   * at `getContext`. Stub it to return null so that failure is our own
   * controlled error rather than jsdom's "Not implemented" console spew — the
   * assertion is the same (it did NOT throw ResourcePolicyError, i.e. it
   * reached the drawing stage), but the suite output stays clean.
   */
  function stubMissingCanvas(): () => void {
    const spy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(null as unknown as CanvasRenderingContext2D);
    return () => spy.mockRestore();
  }

  it('does NOT block when the policy permits the provider', async () => {
    const restore = stubMissingCanvas();
    try {
      await expect(
        composeMapImage({ ...BASE, style: 'road', policy: DEFAULT_INTERACTIVE_RESOURCE_POLICY }),
      ).rejects.not.toBeInstanceOf(ResourcePolicyError);
    } finally {
      restore();
    }
  });

  it('does NOT block when the provider host is explicitly allowed', async () => {
    const restore = stubMissingCanvas();
    try {
      const host = new URL(TILE_PROVIDERS.road.url).hostname;
      await expect(
        composeMapImage({
          ...BASE,
          style: 'road',
          policy: { allowRemote: true, allowedHosts: [host] },
        }),
      ).rejects.not.toBeInstanceOf(ResourcePolicyError);
    } finally {
      restore();
    }
  });
});
