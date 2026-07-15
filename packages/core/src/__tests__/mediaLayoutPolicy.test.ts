import { describe, expect, it } from 'vitest';
import type { ImageLayer, Layer } from '../schemas/Doc.js';
import { VIEWPORT_PRESETS } from '../schemas/Viewport.js';
import { resolveSupplementalMediaLayout } from '../doc/richMediaLayout.js';
import {
  BLOCK_MEDIA_LAYOUT_POLICIES,
  type BlockMediaLayoutPolicy,
  type SupplementalMediaShape,
} from '../doc/templates/mediaLayoutPolicy.js';
import { templateRegistry } from '../doc/templates/registry.js';

const SHAPES: readonly SupplementalMediaShape[] = ['wide', 'tall', 'square', 'multiple'];
const VIEWPORTS = [
  VIEWPORT_PRESETS.landscape,
  VIEWPORT_PRESETS.standard,
  VIEWPORT_PRESETS.square,
  VIEWPORT_PRESETS.portrait,
] as const;

const background: Layer = {
  id: 'bg',
  type: 'shape',
  position: { x: 0, y: 0, width: '100%', height: '100%' },
  content: { shape: 'rect', fill: '#ffffff' },
};
const foreground: Layer = {
  id: 'content',
  type: 'text',
  position: { x: '50%', y: '50%', width: '80%', anchor: 'center' },
  content: { text: 'Content', style: { fontSize: 64, color: '#111111' } },
};
const nativeImage: ImageLayer = {
  id: 'native-image',
  type: 'image',
  position: { x: 0, y: 0, width: '100%', height: '100%' },
  content: { src: 'native.jpg', alt: '', fit: 'cover' },
};

function shapeInput(shape: SupplementalMediaShape): {
  count: number;
  aspects: (number | undefined)[];
} {
  switch (shape) {
    case 'tall':
      return { count: 1, aspects: [0.5] };
    case 'square':
      return { count: 1, aspects: [1] };
    case 'multiple':
      return { count: 2, aspects: [16 / 9, 0.5] };
    case 'wide':
      return { count: 1, aspects: [16 / 9] };
  }
}

function expectRectInsideViewport(
  rect: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number },
): void {
  expect(rect.x).toBeGreaterThanOrEqual(0);
  expect(rect.y).toBeGreaterThanOrEqual(0);
  expect(rect.width).toBeGreaterThan(0);
  expect(rect.height).toBeGreaterThan(0);
  expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width);
  expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height);
}

describe('BLOCK_MEDIA_LAYOUT_POLICIES', () => {
  it('stays exactly 1:1 with the built-in template registry', () => {
    expect(Object.keys(BLOCK_MEDIA_LAYOUT_POLICIES).sort()).toEqual(
      Object.keys(templateRegistry).sort(),
    );
  });

  it('declares a coherent no-media and media contract for every template', () => {
    for (const [template, rawPolicy] of Object.entries(BLOCK_MEDIA_LAYOUT_POLICIES)) {
      const policy = rawPolicy as BlockMediaLayoutPolicy;
      expect(policy.summary, `summary for ${template}`).toBeTruthy();

      const mayReserve =
        policy.unconsumedMedia === 'reserved-slot' ||
        policy.unconsumedMedia === 'reserve-when-no-native-media';
      expect(Boolean(policy.variants), `variant matrix for ${template}`).toBe(mayReserve);

      if (policy.variants) {
        for (const orientation of ['landscape', 'square', 'portrait'] as const) {
          expect(Object.keys(policy.variants[orientation]).sort()).toEqual([...SHAPES].sort());
        }
      }

      if (policy.ownership === 'supplemental') {
        expect(policy.nativeLayout, `native layout for ${template}`).toBeUndefined();
        expect(policy.noMedia).toBe('template-default');
      } else {
        expect(policy.nativeLayout, `native layout for ${template}`).toBeTruthy();
        expect(policy.additionalMediaLayout, `additional-media layout for ${template}`).toBe(
          'overlay-inset',
        );
      }
      if (policy.noMedia === 'unsupported') expect(policy.ownership).toBe('required-native');
      if (policy.noMedia === 'intrinsic-visual') expect(policy.ownership).toBe('intrinsic-visual');
    }
  });

  it('resolves every declared aspect/orientation variant to a bounded rectangle', () => {
    for (const [template, rawPolicy] of Object.entries(BLOCK_MEDIA_LAYOUT_POLICIES)) {
      const policy = rawPolicy as BlockMediaLayoutPolicy;
      for (const viewport of VIEWPORTS) {
        for (const shape of SHAPES) {
          const { count, aspects } = shapeInput(shape);
          const nativeLayers =
            policy.ownership === 'supplemental'
              ? [background, foreground]
              : [background, nativeImage, foreground];
          const result = resolveSupplementalMediaLayout(
            nativeLayers,
            template,
            viewport,
            count,
            aspects,
          );

          expect(result.framed, `${template}/${viewport.name}/${shape}`).toBe(true);
          expectRectInsideViewport(result.mediaRect, viewport);
          if (policy.ownership !== 'supplemental') {
            // Native/spatial templates retain their authored geometry; only
            // the additional media inset is new.
            expect(result.layers).toBe(nativeLayers);
          }
        }
      }
    }
  });

  it('uses reserved variants only while optional native media is absent', () => {
    const optionalTemplates = Object.entries(BLOCK_MEDIA_LAYOUT_POLICIES).filter(
      ([, policy]) => policy.ownership === 'optional-native',
    );
    for (const [template] of optionalTemplates) {
      const withoutNative = [background, foreground];
      const reserved = resolveSupplementalMediaLayout(
        withoutNative,
        template,
        VIEWPORT_PRESETS.landscape,
        1,
        [16 / 9],
      );
      const withNative = [background, nativeImage, foreground];
      const overlay = resolveSupplementalMediaLayout(
        withNative,
        template,
        VIEWPORT_PRESETS.landscape,
        1,
        [16 / 9],
      );

      expect(reserved.framed).toBe(true);
      expect(reserved.layers).not.toBe(withoutNative);
      expect(overlay.framed).toBe(true);
      expect(overlay.layers).toBe(withNative);
    }
  });
});
