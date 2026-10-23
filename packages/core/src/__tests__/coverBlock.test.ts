import { describe, it, expect } from 'vitest';
import {
  coverBlock,
  expandCoverBlock,
  startBlockToCoverInput,
  fitCoverTitleSize,
  coverScrimAlphaAtY,
  COVER_SCRIM_STOPS,
  frostedCoverLayout,
  opticalCentreShiftEm,
} from '../doc/templates/coverBlock';
import { createTemplateContext, DEFAULT_THEME, VIEWPORT_PRESETS } from '../doc/templates/index';
import { THEMES } from '../schemas/themeLibrary';
import { contrastRatio } from '../schemas/colorUtils';
import type { StartBlockConfig } from '../schemas/Doc';
import type { CoverBlockInput } from '../doc/templates/coverBlock';
import type { ImageLayer, TextLayer, ShapeLayer } from '../schemas/Doc';

// ── Helpers ──────────────────────────────────────────────────────────

const landscapeContext = createTemplateContext(DEFAULT_THEME, 0, 1, VIEWPORT_PRESETS.landscape);
const portraitContext = createTemplateContext(DEFAULT_THEME, 0, 1, VIEWPORT_PRESETS.portrait);
const squareContext = createTemplateContext(DEFAULT_THEME, 0, 1, VIEWPORT_PRESETS.square);

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
    expect(findLayer(layers, 'cover-bg-tint')).toBeUndefined();
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

  it('produces theme background and soft tint instead of hero', () => {
    const layers = coverBlock(input, landscapeContext);
    const bg = findShape(layers, 'cover-bg');
    const tint = findShape(layers, 'cover-bg-tint');
    expect(bg).toBeDefined();
    expect(bg!.type).toBe('shape');
    expect(bg!.content.fill).toBe(DEFAULT_THEME.colors.background);
    expect(tint).toBeDefined();
    expect(tint!.content.fill).toContain('radial-gradient');
    expect(tint!.content.fill).toContain('rgba(37, 99, 235, 0.16)');
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

  // The accent rule sat at a fixed 42%/58% slot and ran through the second
  // line of a wrapped title. It now hangs from the title's estimated bottom
  // edge, and with a subtitle stays above the subtitle's top edge.
  describe('accent rule clears a wrapped title', () => {
    const longTitle = 'Everything You Need to Know about Local Models';
    const pct = (v: string | number | undefined) => parseFloat(String(v));
    const titleBottom = (layers: ReturnType<typeof coverBlock>) => {
      const title = findText(layers, 'cover-title')!;
      const lines = Math.ceil(
        longTitle.length / Math.floor((1920 * 0.8) / (title.content.style.fontSize * 0.52)),
      );
      return (
        pct(title.position.y) + ((lines * title.content.style.fontSize * 1.4) / 2 / 1080) * 100
      );
    };

    it('sits below the title when there is no subtitle', () => {
      const layers = coverBlock({ title: longTitle }, landscapeContext);
      const accent = findShape(layers, 'cover-accent')!;
      expect(pct(accent.position.y)).toBeGreaterThan(titleBottom(layers));
    });

    it('sits between the title and the subtitle', () => {
      const layers = coverBlock({ title: longTitle, subtitle: 'A field guide' }, landscapeContext);
      const accent = findShape(layers, 'cover-accent')!;
      const subtitle = findText(layers, 'cover-subtitle')!;
      const subtitleTop =
        pct(subtitle.position.y) - ((subtitle.content.style.fontSize * 1.5) / 2 / 1080) * 100;
      expect(pct(accent.position.y)).toBeGreaterThanOrEqual(titleBottom(layers));
      expect(pct(accent.position.y)).toBeLessThan(subtitleTop);
    });

    it('a short title keeps the rule clear of its descenders', () => {
      const layers = coverBlock({ title: 'Short' }, landscapeContext);
      const accent = findShape(layers, 'cover-accent')!;
      const title = findText(layers, 'cover-title')!;
      const oneLineBottom = 50 + ((title.content.style.fontSize * 1.4) / 2 / 1080) * 100;
      expect(pct(accent.position.y)).toBeGreaterThan(oneLineBottom);
    });
  });

  it('uses high-contrast Standard Light cover text', () => {
    const layers = coverBlock(input, landscapeContext);
    const title = findText(layers, 'cover-title');
    const subtitle = findText(layers, 'cover-subtitle');
    expect(title!.content.style.shadow).toBe(false);
    expect(subtitle!.content.style.fontWeight).toBe('bold');
    expect(subtitle!.content.style.color).toBe('rgba(15, 23, 42, 0.78)');
  });

  it('keeps non-Standard themes on the existing dramatic cover background', () => {
    const nonStandardContext = createTemplateContext(
      { ...DEFAULT_THEME, id: 'custom-light' },
      0,
      1,
      VIEWPORT_PRESETS.landscape,
    );
    const layers = coverBlock(input, nonStandardContext);
    const bg = findShape(layers, 'cover-bg');
    const title = findText(layers, 'cover-title');
    expect(findShape(layers, 'cover-bg-tint')).toBeUndefined();
    expect(bg!.content.fill).toContain('radial-gradient');
    expect(bg!.content.fill).toContain(`${DEFAULT_THEME.colors.primary} 0%`);
    expect(title!.content.style.shadow).toBe(true);
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

  // A pre-broken title ("example.com/\nsome-long-slug") hung its second line
  // below the 75% anchor and off the bottom of a landscape frame.
  it('centres a multi-line hero title and keeps it inside the frame', () => {
    for (const [context, height] of [
      [landscapeContext, 1080],
      [portraitContext, 1920],
    ] as const) {
      const layers = coverBlock(
        { heroSrc: 'img.jpg', title: 'example.com/\nfalkland-\nislands' },
        context,
      );
      const title = findText(layers, 'cover-title')!;
      expect(title.content.style.shrinkToFit).toBe(true);
      const y = parseFloat(String(title.position.y));
      const boxPct = parseFloat(String(title.position.height));
      const threeLinesPct = ((3 * title.content.style.fontSize * 1.4) / height) * 100;
      expect(boxPct).toBeGreaterThanOrEqual(threeLinesPct - 0.01);
      expect(y).toBeLessThanOrEqual(75);
      expect(y + boxPct / 2).toBeLessThanOrEqual(94 + 0.01);
    }
  });

  it('keeps a multi-line hero title above its subtitle', () => {
    const layers = coverBlock(
      { heroSrc: 'img.jpg', title: 'example.com/\nfalkland-islands', subtitle: 'Gateway' },
      landscapeContext,
    );
    const title = findText(layers, 'cover-title')!;
    const subtitle = findText(layers, 'cover-subtitle')!;
    const titleBottom =
      parseFloat(String(title.position.y)) + parseFloat(String(title.position.height)) / 2;
    const subtitleTop =
      parseFloat(String(subtitle.position.y)) -
      ((subtitle.content.style.fontSize * 1.5) / 2 / 1080) * 100;
    expect(titleBottom).toBeLessThanOrEqual(subtitleTop + 0.01);
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

// ── Long-title auto-fit ─────────────────────────────────────────────

describe('coverBlock long-title auto-fit', () => {
  const LONG = 'Seattle: The Emerald City That Rebuilt Itself on Top of Itself';

  it('fitCoverTitleSize returns full base for short titles', () => {
    expect(fitCoverTitleSize('Kirkland')).toBe(120);
    expect(fitCoverTitleSize('Test Title')).toBe(120);
  });

  it('fitCoverTitleSize shrinks long titles below the full base', () => {
    const size = fitCoverTitleSize(LONG);
    expect(size).toBeLessThan(120);
    expect(size).toBeGreaterThanOrEqual(62); // never below the readability floor
  });

  it('fitCoverTitleSize never drops below the readability floor', () => {
    const size = fitCoverTitleSize('x'.repeat(400));
    expect(size).toBe(62);
  });

  it('fitCoverTitleSize is monotonic — longer titles are never larger', () => {
    const a = fitCoverTitleSize('A moderately long cover title here');
    const b = fitCoverTitleSize('A moderately long cover title here that keeps going and going');
    expect(b).toBeLessThanOrEqual(a);
  });

  it('renders a long title with a smaller font than a short one', () => {
    const shortTitle = findText(
      coverBlock({ heroSrc: 'h.jpg', title: 'Short' }, landscapeContext),
      'cover-title',
    );
    const longTitle = findText(
      coverBlock({ heroSrc: 'h.jpg', title: LONG }, landscapeContext),
      'cover-title',
    );
    expect(longTitle!.content.style.fontSize).toBeLessThan(shortTitle!.content.style.fontSize);
  });
});

// ── Hero scrim contrast (all built-in themes) ───────────────────────

/** Parse `#rrggbb` into a 0..1 sRGB triplet. */
function parseHex(hex: string): [number, number, number] {
  const body = hex.replace('#', '');
  expect(body).toMatch(/^[0-9a-f]{6}$/i);
  return [
    parseInt(body.slice(0, 2), 16) / 255,
    parseInt(body.slice(2, 4), 16) / 255,
    parseInt(body.slice(4, 6), 16) / 255,
  ];
}

function toHex(rgb: [number, number, number]): string {
  return (
    '#' +
    rgb
      .map((c) =>
        Math.max(0, Math.min(255, Math.round(c * 255)))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

/**
 * Composite the theme-tinted scrim at opacity `alpha` over an underlying
 * photo pixel — i.e. what the text actually sits on. `photo` is the extreme
 * case (pure black / pure white hero), which is what the scrim has to survive.
 */
function scrimOver(background: string, photo: string, alpha: number): string {
  const bg = parseHex(background);
  const px = parseHex(photo);
  return toHex([
    alpha * bg[0] + (1 - alpha) * px[0],
    alpha * bg[1] + (1 - alpha) * px[1],
    alpha * bg[2] + (1 - alpha) * px[2],
  ]);
}

const PHOTO_EXTREMES = [
  ['black hero', '#000000'],
  ['white hero', '#ffffff'],
] as const;

describe('coverBlock hero scrim contrast', () => {
  const allThemes = Object.values(THEMES);

  it('covers all 11 built-in themes', () => {
    expect(allThemes.length).toBe(11);
  });

  it('scrim is tinted from the theme background, never hard-coded black', () => {
    for (const theme of allThemes) {
      const context = createTemplateContext(theme, 0, 1, VIEWPORT_PRESETS.landscape);
      const gradient = findShape(
        coverBlock({ heroSrc: 'h.jpg', title: 'T', subtitle: 'S' }, context),
        'cover-gradient',
      );
      const fill = gradient!.content.fill as string;
      expect(fill).toContain('linear-gradient(0deg');

      // Every stop carries the theme background's own channels.
      const [r, g, b] = parseHex(theme.colors.background).map((c) => Math.round(c * 255));
      expect(fill).toContain(`rgba(${r}, ${g}, ${b},`);
      // The old hard-coded black scrim is gone (unless the theme IS black).
      if (theme.colors.background.toLowerCase() !== '#000000') {
        expect(fill).not.toContain('rgba(0,0,0');
        expect(fill).not.toContain('rgba(0, 0, 0,');
      }
    }
  });

  // The real bug: a black scrim + `theme.colors.text` rendered near-black
  // title text on a near-black band for every light theme (standard,
  // minimalist, morning-light). Assert actual WCAG contrast at the position
  // the text is placed, against the worst hero photo the scrim must survive.
  it('title text clears WCAG AA against the scrim it sits on, on every theme', () => {
    for (const theme of allThemes) {
      const context = createTemplateContext(theme, 0, 1, VIEWPORT_PRESETS.landscape);

      for (const subtitle of [undefined, 'A subtitle']) {
        const layers = coverBlock({ heroSrc: 'h.jpg', title: 'Title', subtitle }, context);
        const title = findText(layers, 'cover-title')!;
        const y = parseFloat(String(title.position.y));
        const alpha = coverScrimAlphaAtY(y);

        for (const [label, photo] of PHOTO_EXTREMES) {
          const band = scrimOver(theme.colors.background, photo, alpha);
          const ratio = contrastRatio(title.content.style.color as string, band);
          expect(
            ratio,
            `${theme.id} title over ${label} at y=${y}% (scrim alpha ${alpha.toFixed(2)}) — got ${ratio.toFixed(2)}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it('subtitle text clears WCAG AA-large against the scrim it sits on, on every theme', () => {
    for (const theme of allThemes) {
      const context = createTemplateContext(theme, 0, 1, VIEWPORT_PRESETS.landscape);
      const layers = coverBlock({ heroSrc: 'h.jpg', title: 'Title', subtitle: 'Sub' }, context);
      const subtitle = findText(layers, 'cover-subtitle')!;
      const y = parseFloat(String(subtitle.position.y));
      const alpha = coverScrimAlphaAtY(y);

      for (const [label, photo] of PHOTO_EXTREMES) {
        const band = scrimOver(theme.colors.background, photo, alpha);
        const ratio = contrastRatio(subtitle.content.style.color as string, band);
        // The subtitle is large (40px base) muted text; its ceiling is the
        // theme's own textMuted-on-background ratio (3.79 on morning-light).
        expect(
          ratio,
          `${theme.id} subtitle over ${label} at y=${y}% (scrim alpha ${alpha.toFixed(2)}) — got ${ratio.toFixed(2)}`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('holds the whole wrapped-title band, not just the anchor line', () => {
    // A 120px title anchored at 70% can wrap to ~59%–81% of the frame.
    for (const theme of allThemes) {
      for (let y = 59; y <= 82; y++) {
        const alpha = coverScrimAlphaAtY(y);
        for (const [, photo] of PHOTO_EXTREMES) {
          const band = scrimOver(theme.colors.background, photo, alpha);
          const ratio = contrastRatio(theme.colors.text, band);
          expect(
            ratio,
            `${theme.id} title band at y=${y}% — got ${ratio.toFixed(2)}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it('leaves the top of the hero readable as a photograph', () => {
    // The scrim must not flatten the image it exists to caption.
    expect(coverScrimAlphaAtY(0)).toBe(0);
    expect(coverScrimAlphaAtY(20)).toBeLessThan(0.15);
    expect(coverScrimAlphaAtY(40)).toBeLessThan(0.5);
  });

  it('scrim ramp thickens monotonically toward the bottom of the frame', () => {
    for (let y = 1; y <= 100; y++) {
      expect(coverScrimAlphaAtY(y)).toBeGreaterThanOrEqual(coverScrimAlphaAtY(y - 1));
    }
    // y=100 is the frame's bottom edge — the first stop (pos 0 from bottom).
    expect(coverScrimAlphaAtY(100)).toBeCloseTo(COVER_SCRIM_STOPS[0].alpha);
  });
});

// ── startBlockToCoverInput ──────────────────────────────────────────

// ── coverStyle: 'frosted' ───────────────────────────────────────────

describe('coverBlock frosted style', () => {
  const frosted = (title: string, extra: Partial<CoverBlockInput> = {}) =>
    ({ heroSrc: 'hero.jpg', title, coverStyle: 'frosted', ...extra }) as CoverBlockInput;
  const { width: W, height: H } = VIEWPORT_PRESETS.landscape;

  it('keeps the photo clear: a frosted plate, no scrim', () => {
    const layers = coverBlock(frosted('Conguillío National Park'), landscapeContext);
    expect(findShape(layers, 'cover-gradient')).toBeUndefined();
    const plate = findShape(layers, 'cover-plate')!;
    expect(plate.content.backdropBlur).toBeGreaterThan(0);
    // The default theme's dark title gets a light plate; nothing to dim.
    expect(plate.content.backdropContrast).toBeUndefined();
    expect(plate.content.borderRadius).toBeGreaterThan(0);
    // A neutral tint, never the theme background (warm themes turned covers brown).
    expect(plate.content.fill).not.toContain(DEFAULT_THEME.colors.background);
    expect(layers.map((l) => l.id)).toEqual(['cover-hero', 'cover-plate', 'cover-title']);
  });

  it('tames a bright backdrop under a light title without darkening mid-tones', () => {
    const warm = createTemplateContext(THEMES['warm-earth'], 0, 1, VIEWPORT_PRESETS.landscape);
    const plate = findShape(coverBlock(frosted('Antarctic Peninsula'), warm), 'cover-plate')!;
    const c = plate.content.backdropContrast!;
    expect(c).toBeLessThan(1);
    const alpha = Number(/^rgba\(12, 12, 14, ([\d.]+)\)$/.exec(plate.content.fill!)![1]);
    const glass = (v: number) =>
      Math.round(((v / 255 - 0.5) * c + 0.5) * 255 * (1 - alpha) + 12 * alpha);
    const hex = (v: number) => `#${glass(v).toString(16).padStart(2, '0').repeat(3)}`;
    // Snow behind the glass: better than the tint alone (about 2:1), the shadow does the rest.
    expect(contrastRatio(THEMES['warm-earth'].colors.text, hex(255))).toBeGreaterThan(2.4);
    // A mid-tone shows through within a few levels of the light tint alone.
    expect(Math.abs(glass(120) - Math.round(120 * (1 - alpha) + 12 * alpha))).toBeLessThan(5);
  });

  it('rests the plate a fixed margin above the bottom and grows it upward', () => {
    const short = frostedCoverLayout('Tonga', undefined, landscapeContext);
    const long = frostedCoverLayout(
      'Humberstone and Santa Laura Saltpeter Works',
      undefined,
      landscapeContext,
    );
    for (const { plate } of [short, long]) expect(plate.y + plate.height).toBeCloseTo(H * 0.93, 5);
    expect(long.plate.height).toBeGreaterThan(short.plate.height);
    expect(long.plate.y).toBeLessThan(short.plate.y);
    expect(long.plate.y).toBeGreaterThan(H * 0.4);

    const tall = frostedCoverLayout('Tonga', undefined, portraitContext);
    expect(tall.plate.y + tall.plate.height).toBeCloseTo(
      VIEWPORT_PRESETS.portrait.height * 0.83,
      5,
    );
  });

  it('centres the title in the plate, with even padding', () => {
    for (const title of ['Tonga', 'Antarctic Peninsula', 'Ruins of São Miguel das Missões']) {
      const { plate, title: box } = frostedCoverLayout(title, undefined, landscapeContext);
      expect(box.cx).toBeCloseTo(plate.x + plate.width / 2, 5);
      expect(box.cy).toBeCloseTo(plate.y + plate.height / 2, 5);
      expect(box.width).toBeLessThan(plate.width);
      expect(box.height).toBeLessThanOrEqual(plate.height + 1e-6);
      // Room for the font's whole ascent and descent, so shrink-to-fit leaves the size alone.
      expect(box.height).toBeGreaterThan(
        1.3 * frostedCoverLayout(title, undefined, landscapeContext).fontSize,
      );
    }
  });

  it('keeps every title inside the centre square a square crop shows', () => {
    const titles = [
      'Tonga',
      'Conguillío National Park',
      'Humberstone and Santa Laura Saltpeter Works',
      'qualla.com/\nconguillio-national-\npark',
    ];
    for (const title of titles) {
      for (const ctx of [landscapeContext, squareContext, portraitContext]) {
        const { width, height } = ctx.viewport;
        const side = Math.min(width, height);
        const { plate, lines } = frostedCoverLayout(title, undefined, ctx);
        expect(plate.x).toBeGreaterThanOrEqual((width - side) / 2);
        expect(plate.x + plate.width).toBeLessThanOrEqual((width + side) / 2);
        expect(lines.length).toBeLessThanOrEqual(3);
      }
    }
    expect(W).toBeGreaterThan(H);
  });

  it('balances a long title across its lines and keeps explicit breaks', () => {
    const { lines } = frostedCoverLayout(
      'Humberstone and Santa Laura Saltpeter Works',
      undefined,
      landscapeContext,
    );
    expect(lines.join(' ')).toBe('Humberstone and Santa Laura Saltpeter Works');
    expect(lines.length).toBeGreaterThan(1);
    expect(Math.min(...lines.map((l) => l.length))).toBeGreaterThan(5);

    const link = frostedCoverLayout(
      'qualla.com/\nconguillio-national-\npark',
      undefined,
      portraitContext,
    );
    expect(link.lines).toEqual(['qualla.com/', 'conguillio-national-', 'park']);
  });

  it('shrinks a title that will not fit three lines, down to the cover minimum', () => {
    const roomy = frostedCoverLayout('Colonia', undefined, landscapeContext);
    const crowded = frostedCoverLayout(
      'Reserva Provincial La Payunia and the Volcanic Fields of Southern Mendoza',
      undefined,
      landscapeContext,
    );
    expect(crowded.fontSize).toBeLessThan(roomy.fontSize);
    expect(crowded.fontSize).toBeGreaterThan(0);
  });

  it('draws the title box the renderer will not re-wrap', () => {
    const layout = frostedCoverLayout('Little Lilli Isle', undefined, landscapeContext);
    for (const line of layout.lines) {
      // TextLayer wraps at half an em per character.
      expect(Math.floor(layout.title.width / (layout.fontSize * 0.5))).toBeGreaterThanOrEqual(
        line.length,
      );
    }
  });

  it('centres the title optically, not on its x-height', () => {
    expect(opticalCentreShiftEm(['Antarctic Peninsula'])).toBeCloseTo(0.13, 3);
    expect(opticalCentreShiftEm(['Paraguay'])).toBeCloseTo(0.0475, 2);
    expect(opticalCentreShiftEm(['Óbidos'])).toBeCloseTo(0.175, 3);
    expect(opticalCentreShiftEm(['Órgãos'])).toBeCloseTo(0.0925, 2);
    expect(opticalCentreShiftEm(['Saltpeter Works', 'and Santa Laura'])).toBeCloseTo(0.13, 3);
    expect(opticalCentreShiftEm(['once more'])).toBeCloseTo(0, 3);
    const layers = coverBlock(frosted('Antarctic Peninsula'), landscapeContext);
    const title = findText(layers, 'cover-title')!;
    expect(title.content.style.verticalAlign).toBe('middle');
    expect(title.content.style.baselineShift).toBeCloseTo(0.13, 3);
  });

  it('puts a subtitle inside the plate under the title', () => {
    const { plate, title, subtitle } = frostedCoverLayout(
      'Tonga',
      'The Friendly Islands',
      landscapeContext,
    );
    expect(subtitle).toBeDefined();
    expect(subtitle!.cy).toBeGreaterThan(title.cy + title.height / 2);
    expect(subtitle!.cy + subtitle!.height / 2).toBeLessThan(plate.y + plate.height);
  });

  it('falls back to the theme background cover without a hero', () => {
    const layers = coverBlock({ title: 'No Hero', coverStyle: 'frosted' }, landscapeContext);
    expect(findShape(layers, 'cover-plate')).toBeUndefined();
    expect(findShape(layers, 'cover-bg')).toBeDefined();
  });

  it('flows from StartBlockConfig through expandCoverBlock', () => {
    const config: StartBlockConfig = { heroSrc: 'h.jpg', title: 'Tonga', coverStyle: 'frosted' };
    expect(startBlockToCoverInput(config).coverStyle).toBe('frosted');
    expect(expandCoverBlock(config, landscapeContext).some((l) => l.id === 'cover-plate')).toBe(
      true,
    );
    expect(startBlockToCoverInput({ title: 'Plain' })).not.toHaveProperty('coverStyle');
  });
});

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
    expect(layers.some((l) => l.id === 'cover-bg-tint')).toBe(true);
    expect(layers.some((l) => l.id === 'cover-title')).toBe(true);
    expect(layers.some((l) => l.id === 'cover-hero')).toBe(false);
  });

  it('renders the title block appearance', () => {
    const layers = expandCoverBlock(
      { title: 'Title Card', subtitle: 'Supporting line', heroSrc: 'ignored.jpg' },
      landscapeContext,
      'title',
    );
    expect(layers.some((layer) => layer.id === 'title')).toBe(true);
    expect(layers.some((layer) => layer.id === 'subtitle')).toBe(true);
    expect(layers.some((layer) => layer.id === 'cover-hero')).toBe(false);
  });

  it('renders the section-header appearance with the hero image', () => {
    const layers = expandCoverBlock(
      { title: 'Chapter One', heroSrc: 'chapter.jpg', heroAlt: 'Chapter art' },
      landscapeContext,
      'sectionHeader',
    );
    expect(layers.some((layer) => layer.id === 'bg-image')).toBe(true);
    expect(layers.some((layer) => layer.id === 'title')).toBe(true);
  });

  it('renders the image-title appearance and falls back safely without a hero', () => {
    const imageLayers = expandCoverBlock(
      { title: 'Image title', subtitle: 'Subtitle', heroSrc: 'hero.jpg' },
      landscapeContext,
      'imageWithCaption',
    );
    expect(imageLayers.some((layer) => layer.id === 'bg-image')).toBe(true);
    expect(imageLayers.some((layer) => layer.id === 'title')).toBe(true);

    const fallbackLayers = expandCoverBlock(
      { title: 'No image', subtitle: 'Still useful' },
      landscapeContext,
      'imageWithCaption',
    );
    expect(fallbackLayers.some((layer) => layer.id === 'bg')).toBe(true);
    expect(fallbackLayers.some((layer) => layer.id === 'title')).toBe(true);
  });
});
