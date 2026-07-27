import { describe, it, expect } from 'vitest';
import { bigText, fitBigTextSize } from '../doc/templates/bigText';
import { expandCoverBlock } from '../doc/templates/coverBlock';
import { createTemplateContext, DEFAULT_THEME, VIEWPORT_PRESETS } from '../doc/templates/index';
import { resolveCoverSlideSettings } from '../doc/coverSlideSettings';
import type { StartBlockConfig } from '../schemas/Doc';
import type { BigTextInput } from '../schemas/BlockTemplates';
import type { ImageLayer, TextLayer, ShapeLayer } from '../schemas/Doc';

const context = createTemplateContext(DEFAULT_THEME, 0, 1, VIEWPORT_PRESETS.landscape);
const landscape = VIEWPORT_PRESETS.landscape;

const base = { id: 'b', duration: 5, audioSegment: 0 };

function layersOf(input: Partial<BigTextInput>) {
  return bigText({ ...base, template: 'bigText', title: 'Launch Day', ...input }, context);
}

describe('bigText template', () => {
  it('renders the title in gigantic uppercase type', () => {
    const layers = layersOf({});
    const title = layers.find((l) => l.id === 'bigtext-title') as TextLayer;
    expect(title).toBeDefined();
    expect(title.content.text).toBe('LAUNCH DAY');
    expect(title.content.style.fontWeight).toBe('bold');
    // Frame-filling: far beyond the 84–120px bases used by the
    // sectionHeader and cover titles.
    expect(title.content.style.fontSize).toBeGreaterThan(300);
  });

  it('opts the title into the renderer fit guard with a padded box', () => {
    const layers = layersOf({});
    const title = layers.find((l) => l.id === 'bigtext-title') as TextLayer;
    // The template size is an estimate; the renderer measures real glyphs
    // and scales down within this box so wide faces never spill the frame.
    expect(title.content.style.shrinkToFit).toBe(true);
    expect(title.position.width).toBe('92%');
    expect(title.position.height).toBe('86%');
    expect(title.position.anchor).toBe('center');
  });

  it('renders nothing but the title over its background layers', () => {
    const layers = layersOf({});
    const ids = layers.map((l) => l.id);
    expect(ids).toEqual(['bigtext-bg', 'bigtext-tint', 'bigtext-title']);
  });

  it('without an image renders a theme surface with a primary bloom', () => {
    const layers = layersOf({});
    const bg = layers.find((l) => l.id === 'bigtext-bg') as ShapeLayer;
    const tint = layers.find((l) => l.id === 'bigtext-tint') as ShapeLayer;
    expect(bg.content.fill).toBe(DEFAULT_THEME.colors.background);
    expect(tint.content.fill).toContain('radial-gradient');
    expect(layers.find((l) => l.id === 'bigtext-image')).toBeUndefined();
    const title = layers.find((l) => l.id === 'bigtext-title') as TextLayer;
    expect(title.content.style.shadow).toBe(false);
  });

  it('with an image renders a full-bleed photo with a contrast bloom behind the text', () => {
    const layers = layersOf({ imageSrc: 'hero.jpg', imageAlt: 'Hero' });
    const image = layers.find((l) => l.id === 'bigtext-image') as ImageLayer;
    expect(image.content.src).toBe('hero.jpg');
    expect(image.content.fit).toBe('cover');
    const bloom = layers.find((l) => l.id === 'bigtext-bloom') as ShapeLayer;
    // The bloom is tinted from the theme background so theme text stays
    // readable by construction over an arbitrary photo.
    expect(bloom.content.fill).toContain('radial-gradient');
    const title = layers.find((l) => l.id === 'bigtext-title') as TextLayer;
    expect(title.content.style.shadow).toBe(true);
  });
});

describe('fitBigTextSize', () => {
  it('gives a single short word close to the full frame width', () => {
    const size = fitBigTextSize('WELCOME', landscape);
    // 7 chars at ~0.62em each across ~92% of 1920px.
    expect(size).toBeGreaterThan(350);
    // Still bounded by the padded frame.
    expect(size * 0.62 * 7).toBeLessThanOrEqual(landscape.width * 0.92 + 1);
  });

  it('keeps the wrapped block within the padded frame height', () => {
    const title = 'WELCOME TO MIKEAMM-BUILDS';
    const size = fitBigTextSize(title, landscape);
    // The longest word (14 chars) must fit the padded width on one line.
    expect(size * 0.62 * 14).toBeLessThanOrEqual(landscape.width * 0.92 + 1);
    expect(size).toBeGreaterThan(150);
  });

  it('scales with the viewport rather than a fixed base', () => {
    const wide = fitBigTextSize('HELLO', landscape);
    const tall = fitBigTextSize('HELLO', VIEWPORT_PRESETS.portrait);
    expect(wide).not.toBe(tall);
  });

  it('floors absurdly long titles at the readability minimum', () => {
    const size = fitBigTextSize(
      'AN IMPOSSIBLY LONG TITLE THAT KEEPS GOING AND GOING AND GOING AND GOING AND GOING AND GOING',
      landscape,
    );
    expect(size).toBeGreaterThanOrEqual(48);
  });
});

describe('bigText cover appearances', () => {
  const config: StartBlockConfig = {
    title: 'Launch Day',
    subtitle: 'Episode 12',
    heroSrc: 'hero.jpg',
    heroAlt: 'Hero',
    ambientMotion: 'zoomIn',
  };

  it("expands the 'bigText' appearance without the hero image or subtitle", () => {
    const layers = expandCoverBlock(config, context, 'bigText');
    expect(layers.find((l) => l.id === 'bigtext-image')).toBeUndefined();
    // The document subtitle deliberately does not appear on this layout.
    expect(layers.filter((l) => l.type === 'text')).toHaveLength(1);
    const title = layers.find((l) => l.id === 'bigtext-title') as TextLayer;
    expect(title.content.text).toBe('LAUNCH DAY');
  });

  it("expands the 'bigTextImage' appearance with the hero image", () => {
    const layers = expandCoverBlock(config, context, 'bigTextImage');
    const image = layers.find((l) => l.id === 'bigtext-image') as ImageLayer;
    expect(image.content.src).toBe('hero.jpg');
    expect(layers.find((l) => l.id === 'bigtext-bloom')).toBeDefined();
    expect(layers.filter((l) => l.type === 'text')).toHaveLength(1);
  });

  it("degrades 'bigTextImage' to the text-only card when no hero exists", () => {
    const layers = expandCoverBlock({ title: 'Launch Day' }, context, 'bigTextImage');
    expect(layers.find((l) => l.id === 'bigtext-image')).toBeUndefined();
    expect(layers.find((l) => l.id === 'bigtext-title')).toBeDefined();
  });

  it('resolves big-text frontmatter spellings to the new appearances', () => {
    expect(resolveCoverSlideSettings({ 'squisq-cover-template': 'big-text' }).template).toBe(
      'bigText',
    );
    expect(resolveCoverSlideSettings({ 'squisq-cover-template': 'LARGE TEXT' }).template).toBe(
      'bigText',
    );
    expect(resolveCoverSlideSettings({ 'squisq-cover-template': 'big-text-image' }).template).toBe(
      'bigTextImage',
    );
    expect(resolveCoverSlideSettings({ 'squisq-cover-template': 'largeTextImage' }).template).toBe(
      'bigTextImage',
    );
  });
});
