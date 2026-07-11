import { describe, it, expect } from 'vitest';
import { applyRenderStyleToLayers } from '../doc/utils/applyRenderStyle.js';
import { resolveBlockTransition } from '../schemas/Transitions.js';
import { DEFAULT_THEME, resolveTheme } from '../schemas/themeLibrary.js';
import type { Theme } from '../schemas/Theme.js';
import type { Layer } from '../schemas/Doc.js';

function themeWith(patch: {
  animationSpeed?: number;
  ambientMotion?: boolean;
  defaultImageAnimation?: Theme['renderStyle']['defaultImageAnimation'];
  defaultTransition?: Theme['renderStyle']['defaultTransition'];
}): Theme {
  return {
    ...DEFAULT_THEME,
    style: {
      ...DEFAULT_THEME.style,
      ...(patch.animationSpeed != null ? { animationSpeed: patch.animationSpeed } : {}),
    },
    renderStyle: {
      ...DEFAULT_THEME.renderStyle,
      ...(patch.ambientMotion != null ? { ambientMotion: patch.ambientMotion } : {}),
      ...(patch.defaultImageAnimation
        ? { defaultImageAnimation: patch.defaultImageAnimation }
        : {}),
      ...(patch.defaultTransition ? { defaultTransition: patch.defaultTransition } : {}),
    },
  };
}

const fullBleedImage = (id = 'img'): Layer => ({
  type: 'image',
  id,
  content: { src: 'x.jpg', alt: '' },
  position: { x: 0, y: 0, width: '100%', height: '100%' },
});

const BLOCK = { id: 'b1', duration: 6 };

describe('applyRenderStyleToLayers', () => {
  it('is a no-op at animationSpeed 1.0 with no ambient motion (returns same objects)', () => {
    const layers: Layer[] = [{ ...fullBleedImage(), animation: { type: 'fadeIn', duration: 2 } }];
    const out = applyRenderStyleToLayers(layers, BLOCK, DEFAULT_THEME);
    expect(out).toBe(layers);
  });

  it('scales duration and delay by animationSpeed', () => {
    const layers: Layer[] = [
      {
        type: 'text',
        id: 't',
        content: { text: 'hi', style: { fontSize: 20, color: '#ffffff' } },
        position: { x: '50%', y: '50%' },
        animation: { type: 'fadeIn', duration: 2, delay: 1 },
      },
    ];
    const out = applyRenderStyleToLayers(layers, BLOCK, themeWith({ animationSpeed: 0.5 }));
    expect(out[0].animation).toEqual({ type: 'fadeIn', duration: 1, delay: 0.5 });
    // Input untouched (pure)
    expect(layers[0].animation).toEqual({ type: 'fadeIn', duration: 2, delay: 1 });
  });

  it('gives full-bleed cover imagery a deterministic ambient Ken Burns', () => {
    const theme = themeWith({ ambientMotion: true });
    const a = applyRenderStyleToLayers([fullBleedImage()], BLOCK, theme);
    const b = applyRenderStyleToLayers([fullBleedImage()], BLOCK, theme);
    expect(a[0].animation?.type).toBe('slowZoom');
    expect(a[0].animation?.duration).toBeGreaterThanOrEqual(8);
    // Deterministic: same block+layer id → same variant
    expect(a[0].animation).toEqual(b[0].animation);
    // Different layer id → independent (usually different) but still defined
    const c = applyRenderStyleToLayers([fullBleedImage('other')], BLOCK, theme);
    expect(c[0].animation?.type).toBe('slowZoom');
  });

  it('does not let a default entrance animation override ambientMotion=false', () => {
    const out = applyRenderStyleToLayers(
      [fullBleedImage()],
      BLOCK,
      themeWith({ ambientMotion: false, defaultImageAnimation: 'slowZoom' }),
    );
    expect(out[0].animation).toBeUndefined();
  });

  it('never overrides an authored animation, including type none', () => {
    const theme = themeWith({ ambientMotion: true });
    const none: Layer = { ...fullBleedImage(), animation: { type: 'none' } };
    const authored: Layer = {
      ...fullBleedImage('a2'),
      animation: { type: 'fadeIn', duration: 3 },
    };
    const out = applyRenderStyleToLayers([none, authored], BLOCK, theme);
    expect(out[0].animation).toEqual({ type: 'none' });
    expect(out[1].animation?.type).toBe('fadeIn');
  });

  it('does not blanket-animate partial or contain-fit imagery', () => {
    const theme = themeWith({ ambientMotion: true });
    const strip: Layer = {
      type: 'image',
      id: 'strip',
      content: { src: 'x.jpg', alt: '' },
      position: { x: '65%', y: 0, width: '35%', height: '100%' },
    };
    const contained: Layer = {
      type: 'image',
      id: 'contained',
      content: { src: 'x.jpg', alt: '', fit: 'contain' },
      position: { x: 0, y: 0, width: '100%', height: '100%' },
    };
    const out = applyRenderStyleToLayers([strip, contained], BLOCK, theme);
    expect(out[0].animation).toBeUndefined();
    expect(out[1].animation).toBeUndefined();
  });
});

describe('resolveBlockTransition', () => {
  const theme = themeWith({ defaultTransition: { type: 'dissolve', duration: 1.2 } });

  it('authored transition always wins', () => {
    const t = resolveBlockTransition({ transition: { type: 'cut' } }, theme, 3);
    expect(t).toEqual({ type: 'cut' });
  });

  it('falls back to the theme default for blocks after the first', () => {
    expect(resolveBlockTransition({}, theme, 1)).toEqual({ type: 'dissolve', duration: 1.2 });
  });

  it('never applies a theme default to block 0', () => {
    expect(resolveBlockTransition({}, theme, 0)).toBeUndefined();
  });

  it('returns undefined when neither block nor theme specify one', () => {
    const bare: Theme = {
      ...DEFAULT_THEME,
      renderStyle: { ...DEFAULT_THEME.renderStyle, defaultTransition: undefined },
    };
    expect(resolveBlockTransition({}, bare, 2)).toBeUndefined();
  });

  it('documentary (built-in) authors a default transition that now resolves', () => {
    const documentary = resolveTheme('documentary');
    const t = resolveBlockTransition({}, documentary, 1);
    expect(t?.type).toBe('fade');
  });
});
