import { describe, it, expect } from 'vitest';
import { coverBlock, expandCoverBlock, startBlockToCoverInput } from '../doc/templates/coverBlock';
import { createTemplateContext, DEFAULT_THEME, VIEWPORT_PRESETS } from '../doc/templates/index';
import type { StartBlockConfig } from '../schemas/Doc';
import type { CoverBlockInput } from '../doc/templates/coverBlock';
import type { ImageLayer, TextLayer, ShapeLayer } from '../schemas/Doc';

// ── Helpers ──────────────────────────────────────────────────────────

const landscapeContext = createTemplateContext(DEFAULT_THEME, 0, 1, VIEWPORT_PRESETS.landscape);
const portraitContext = createTemplateContext(DEFAULT_THEME, 0, 1, VIEWPORT_PRESETS.portrait);

function findLayer(layers: ReturnType<typeof coverBlock>, id: string) {
  return layers.find((l) => l.id === id);
}

function findImage(layers: ReturnType<typeof coverBlock>, id: string) {
  return findLayer(layers, id) as ImageLayer | undefined;
}

function findText(layers: ReturnType<typeof coverBlock>, id: string) {
  return findLayer(layers, id) as TextLayer | undefined;
}

function findShape(layers: ReturnType<typeof coverBlock>, id: string) {
  return findLayer(layers, id) as ShapeLayer | undefined;
}

// ── coverBlock with hero image ──────────────────────────────────────

describe('coverBlock with hero image', () => {
  const input: CoverBlockInput = {
    heroSrc: 'hero.jpg',
    heroAlt: 'Hero image',
    title: 'Test Title',
    subtitle: 'A subtitle',
    ambientMotion: 'zoomIn',
    heroCredit: 'Photographer',
    heroLicense: 'CC-BY-4.0',
  };

  it('produces hero image layer', () => {
    const layers = coverBlock(input, landscapeContext);
    const hero = findImage(layers, 'cover-hero');
    expect(hero).toBeDefined();
    expect(hero!.type).toBe('image');
    expect(hero!.content.src).toBe('hero.jpg');
    expect(hero!.content.alt).toBe('Hero image');
    expect(hero!.content.fit).toBe('cover');
    expect(hero!.content.credit).toBe('Photographer');
    expect(hero!.content.license).toBe('CC-BY-4.0');
  });

  it('produces gradient overlay', () => {
    const layers = coverBlock(input, landscapeContext);
    const gradient = findShape(layers, 'cover-gradient');
    expect(gradient).toBeDefined();
    expect(gradient!.type).toBe('shape');
    expect(gradient!.content.fill).toContain('linear-gradient');
  });

  it('produces title layer with shadow', () => {
    const layers = coverBlock(input, landscapeContext);
    const title = findText(layers, 'cover-title');
    expect(title).toBeDefined();
    expect(title!.type).toBe('text');
    expect(title!.content.text).toBe('Test Title');
    expect(title!.content.style.shadow).toBe(true);
    expect(title!.content.style.fontWeight).toBe('bold');
  });

  it('produces subtitle layer', () => {
    const layers = coverBlock(input, landscapeContext);
    const subtitle = findText(layers, 'cover-subtitle');
    expect(subtitle).toBeDefined();
    expect(subtitle!.type).toBe('text');
    expect(subtitle!.content.text).toBe('A subtitle');
  });

  it('does not produce theme background layers', () => {
    const layers = coverBlock(input, landscapeContext);
    expect(findLayer(layers, 'cover-bg')).toBeUndefined();
    expect(findLayer(layers, 'cover-accent')).toBeUndefined();
  });

  it('title positioned lower (over hero)', () => {
    const layers = coverBlock(input, landscapeContext);
    const title = findLayer(layers, 'cover-title');
    // With subtitle: 70%, without: 75% — both below center
    expect(title!.position.y).toBe('70%');
  });

  it('applies Ken Burns animation to hero image', () => {
    const layers = coverBlock(input, landscapeContext);
    const hero = findLayer(layers, 'cover-hero');
    expect(hero!.animation).toBeDefined();
  });
});

// ── coverBlock without hero image (theme background) ────────────────

describe('coverBlock without hero image', () => {
  const input: CoverBlockInput = {
    title: 'Title Only',
    subtitle: 'Subtitle text',
  };

  it('produces theme background instead of hero', () => {
    const layers = coverBlock(input, landscapeContext);
    const bg = findShape(layers, 'cover-bg');
    expect(bg).toBeDefined();
    expect(bg!.type).toBe('shape');
    expect(bg!.content.fill).toContain('radial-gradient');
  });

  it('produces decorative accent line', () => {
    const layers = coverBlock(input, landscapeContext);
    const accent = findLayer(layers, 'cover-accent');
    expect(accent).toBeDefined();
    expect(accent!.type).toBe('shape');
  });

  it('does not produce hero image or gradient overlay', () => {
    const layers = coverBlock(input, landscapeContext);
    expect(findLayer(layers, 'cover-hero')).toBeUndefined();
    expect(findLayer(layers, 'cover-gradient')).toBeUndefined();
  });

  it('title centered (not pushed to bottom)', () => {
    const layers = coverBlock(input, landscapeContext);
    const title = findLayer(layers, 'cover-title');
    // Without hero: uses layout.primaryY which is typically around 35-40%
    expect(title!.position.y).not.toBe('70%');
    expect(title!.position.y).not.toBe('75%');
  });

  it('subtitle uses layout secondaryY', () => {
    const layers = coverBlock(input, landscapeContext);
    const subtitle = findLayer(layers, 'cover-subtitle');
    expect(subtitle!.position.y).not.toBe('82%');
  });
});

// ── coverBlock title-only (no subtitle) ─────────────────────────────

describe('coverBlock title-only', () => {
  it('no subtitle layer when subtitle is omitted', () => {
    const layers = coverBlock({ title: 'Solo Title' }, landscapeContext);
    expect(findLayer(layers, 'cover-subtitle')).toBeUndefined();
  });

  it('hero title at 75% when no subtitle', () => {
    const layers = coverBlock({ heroSrc: 'img.jpg', title: 'Solo' }, landscapeContext);
    const title = findLayer(layers, 'cover-title');
    expect(title!.position.y).toBe('75%');
  });

  it('no-hero title at 50% when no subtitle', () => {
    const layers = coverBlock({ title: 'Solo' }, landscapeContext);
    const title = findLayer(layers, 'cover-title');
    expect(title!.position.y).toBe('50%');
  });
});

// ── Viewport scaling ────────────────────────────────────────────────

describe('coverBlock viewport scaling', () => {
  it('produces layers for portrait viewport', () => {
    const layers = coverBlock({ heroSrc: 'img.jpg', title: 'Portrait' }, portraitContext);
    expect(layers.length).toBeGreaterThanOrEqual(3); // hero + gradient + title
  });

  it('title font size differs between landscape and portrait', () => {
    const landLayers = coverBlock({ title: 'Test' }, landscapeContext);
    const portLayers = coverBlock({ title: 'Test' }, portraitContext);
    const landTitle = findText(landLayers, 'cover-title');
    const portTitle = findText(portLayers, 'cover-title');
    expect(landTitle!.content.style.fontSize).not.toBe(portTitle!.content.style.fontSize);
  });
});

// ── startBlockToCoverInput ──────────────────────────────────────────

describe('startBlockToCoverInput', () => {
  it('maps all StartBlockConfig fields to CoverBlockInput', () => {
    const config: StartBlockConfig = {
      heroSrc: 'hero.jpg',
      heroAlt: 'Alt',
      title: 'Title',
      subtitle: 'Sub',
      ambientMotion: 'panLeft',
      heroCredit: 'Credit',
      heroLicense: 'MIT',
    };
    const result = startBlockToCoverInput(config);
    expect(result.heroSrc).toBe('hero.jpg');
    expect(result.heroAlt).toBe('Alt');
    expect(result.title).toBe('Title');
    expect(result.subtitle).toBe('Sub');
    expect(result.ambientMotion).toBe('panLeft');
    expect(result.heroCredit).toBe('Credit');
    expect(result.heroLicense).toBe('MIT');
  });

  it('handles config without heroSrc', () => {
    const config: StartBlockConfig = { title: 'Title Only' };
    const result = startBlockToCoverInput(config);
    expect(result.heroSrc).toBeUndefined();
    expect(result.title).toBe('Title Only');
  });
});

// ── expandCoverBlock ────────────────────────────────────────────────

describe('expandCoverBlock', () => {
  it('returns layers from StartBlockConfig', () => {
    const config: StartBlockConfig = {
      heroSrc: 'cover.jpg',
      title: 'Cover Title',
    };
    const layers = expandCoverBlock(config, landscapeContext);
    expect(layers.length).toBeGreaterThanOrEqual(3);
    expect(layers.some((l) => l.id === 'cover-hero')).toBe(true);
    expect(layers.some((l) => l.id === 'cover-title')).toBe(true);
  });

  it('returns theme background layers when no heroSrc', () => {
    const config: StartBlockConfig = { title: 'No Hero' };
    const layers = expandCoverBlock(config, landscapeContext);
    expect(layers.some((l) => l.id === 'cover-bg')).toBe(true);
    expect(layers.some((l) => l.id === 'cover-title')).toBe(true);
    expect(layers.some((l) => l.id === 'cover-hero')).toBe(false);
  });
});
