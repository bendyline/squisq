import { describe, it, expect } from 'vitest';
import { validateTheme } from '../schemas/themeValidator.js';
import { compileTheme } from '../schemas/themeCompile.js';
import { defaultPageStyle } from '../schemas/pageStyleDefaults.js';
import { THEMES, DEFAULT_THEME } from '../schemas/themeLibrary.js';
import { PAGE_SECTION_KINDS } from '../schemas/PageStyle.js';
import type { Theme } from '../schemas/Theme.js';
import type { ThemePageStyle } from '../schemas/PageStyle.js';
import {
  readCustomThemesFromFrontmatter,
  writeCustomThemesToFrontmatter,
} from '../doc/customThemesFrontmatter.js';

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function themed(pageStyle: unknown): Record<string, unknown> {
  return { ...clone(DEFAULT_THEME as unknown as Record<string, unknown>), pageStyle };
}

const VALID_PAGE_STYLE: ThemePageStyle = {
  family: 'clean',
  tokens: {
    contentMaxWidth: 760,
    wideMaxWidth: 1100,
    sectionSpacing: 'comfortable',
    cornerRadius: 8,
    divider: 'hairline',
    backgroundRhythm: 'alternate',
    heroStyle: 'stacked',
    headingTreatment: { eyebrow: 'kicker', scale: 'regular' },
    imageFraming: 'rounded',
    shadow: 'soft',
    quoteMark: 'accent-bar',
    numeralStyle: 'plain',
  },
  accentRotation: { strategy: 'cycle' },
};

describe('pageStyle validation', () => {
  it('accepts a theme without pageStyle (optional)', () => {
    const theme = clone(DEFAULT_THEME) as unknown as Record<string, unknown>;
    delete theme.pageStyle;
    expect(validateTheme(theme).valid).toBe(true);
  });

  it('accepts a complete valid pageStyle', () => {
    expect(validateTheme(themed(clone(VALID_PAGE_STYLE))).valid).toBe(true);
  });

  it('rejects an unknown family', () => {
    const ps = clone(VALID_PAGE_STYLE) as unknown as Record<string, unknown>;
    ps.family = 'baroque';
    const result = validateTheme(themed(ps));
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.path)).toContain('pageStyle.family');
  });

  it('rejects a bad token enum value', () => {
    const ps = clone(VALID_PAGE_STYLE);
    (ps.tokens as unknown as Record<string, unknown>).divider = 'lasers';
    const result = validateTheme(themed(ps));
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.path)).toContain('pageStyle.tokens.divider');
  });

  it('rejects non-numeric column widths', () => {
    const ps = clone(VALID_PAGE_STYLE);
    (ps.tokens as unknown as Record<string, unknown>).contentMaxWidth = '760px';
    const result = validateTheme(themed(ps));
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.path)).toContain('pageStyle.tokens.contentMaxWidth');
  });

  it('rejects unknown section-kind keys in sections', () => {
    const ps = clone(VALID_PAGE_STYLE);
    ps.sections = { jumbotron: { variant: 'x' } } as unknown as ThemePageStyle['sections'];
    const result = validateTheme(themed(ps));
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.path)).toContain('pageStyle.sections.jumbotron');
  });

  it('rejects non-scalar hint values', () => {
    const ps = clone(VALID_PAGE_STYLE);
    ps.templates = {
      diagram: { hints: { frame: { nested: true } } },
    } as unknown as ThemePageStyle['templates'];
    const result = validateTheme(themed(ps));
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.path)).toContain('pageStyle.templates.diagram.hints.frame');
  });

  it('requires accentRotation with a known strategy', () => {
    const ps = clone(VALID_PAGE_STYLE) as unknown as Record<string, unknown>;
    delete ps.accentRotation;
    const missing = validateTheme(themed(ps));
    expect(missing.valid).toBe(false);
    expect(missing.errors.map((e) => e.path)).toContain('pageStyle.accentRotation');

    const ps2 = clone(VALID_PAGE_STYLE);
    ps2.accentRotation = { strategy: 'random' } as unknown as ThemePageStyle['accentRotation'];
    const bad = validateTheme(themed(ps2));
    expect(bad.valid).toBe(false);
    expect(bad.errors.map((e) => e.path)).toContain('pageStyle.accentRotation.strategy');
  });

  it('rejects a section override that remaps to an invalid kind', () => {
    const ps = clone(VALID_PAGE_STYLE);
    ps.sections = {
      'quote-band': { kind: 'jumbo' },
    } as unknown as ThemePageStyle['sections'];
    const result = validateTheme(themed(ps));
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.path)).toContain('pageStyle.sections.quote-band.kind');
  });
});

describe('built-in theme pageStyle art direction', () => {
  it('every built-in theme declares an explicit pageStyle', () => {
    for (const [id, theme] of Object.entries(THEMES)) {
      expect(theme.pageStyle, `theme "${id}" is missing pageStyle`).toBeDefined();
    }
  });

  it('every built-in art direction is pairwise distinct', () => {
    // Two themes may share a family, but their page identity — the tuple of
    // (family, heroStyle, divider, backgroundRhythm, imageFraming) — must
    // differ so each theme reads as its own website design.
    const seen = new Map<string, string>();
    for (const [id, theme] of Object.entries(THEMES)) {
      const ps = theme.pageStyle!;
      const tuple = [
        ps.family,
        ps.tokens.heroStyle,
        ps.tokens.divider,
        ps.tokens.backgroundRhythm,
        ps.tokens.imageFraming,
      ].join('|');
      const prior = seen.get(tuple);
      expect(prior, `themes "${prior}" and "${id}" share art direction tuple ${tuple}`).toBe(
        undefined,
      );
      seen.set(tuple, id);
    }
  });

  it('section override keys reference valid kinds in every built-in', () => {
    for (const theme of Object.values(THEMES)) {
      for (const key of Object.keys(theme.pageStyle?.sections ?? {})) {
        expect(PAGE_SECTION_KINDS).toContain(key);
      }
    }
  });
});

describe('defaultPageStyle derivation', () => {
  it('maps renderStyle.name to the matching design family', () => {
    const base = clone(DEFAULT_THEME);
    const cases: Array<[string, string]> = [
      ['documentary', 'documentary'],
      ['magazine', 'editorial'],
      ['bold', 'brutalist'],
      ['tech-dark', 'terminal'],
      ['cinematic', 'cinematic'],
      ['warm-earth', 'organic'],
      ['gezellig', 'soft'],
      ['standard', 'clean'],
      ['some-unknown-style', 'clean'],
    ];
    for (const [renderName, family] of cases) {
      const theme = { ...base, renderStyle: { ...base.renderStyle, name: renderName } } as Theme;
      expect(defaultPageStyle(theme).family, renderName).toBe(family);
    }
  });

  it('derives cornerRadius and framing from style fields', () => {
    const base = clone(DEFAULT_THEME);
    const rounded = defaultPageStyle({ ...base, style: { ...base.style, borderRadius: 12 } });
    expect(rounded.tokens.cornerRadius).toBe(12);
    expect(rounded.tokens.imageFraming).toBe('rounded');

    const flush = defaultPageStyle({ ...base, style: { ...base.style, borderRadius: 0 } });
    expect(flush.tokens.imageFraming).toBe('flush');

    const mono = defaultPageStyle({
      ...base,
      style: { ...base.style, imageTreatment: { type: 'mono', strength: 0.4 } },
    });
    expect(mono.tokens.imageFraming).toBe('letterboxed');
  });

  it('derives pattern from persistentLayers and shadow from textShadow', () => {
    const base = clone(DEFAULT_THEME);
    const patterned = defaultPageStyle({
      ...base,
      persistentLayers: {
        topLayers: [
          {
            template: 'patternBackground',
            config: { type: 'patternBackground', pattern: 'grid' },
          },
        ],
      },
    } as Theme);
    expect(patterned.tokens.pattern).toBe('grid');

    const shadowed = defaultPageStyle({ ...base, style: { ...base.style, textShadow: true } });
    expect(shadowed.tokens.shadow).toBe('soft');
    const flat = defaultPageStyle({ ...base, style: { ...base.style, textShadow: false } });
    expect(flat.tokens.shadow).toBe('none');
  });

  it('derived styles validate', () => {
    for (const theme of Object.values(THEMES)) {
      const stripped = clone(theme) as unknown as Record<string, unknown>;
      delete stripped.pageStyle;
      const derived = { ...stripped, pageStyle: defaultPageStyle(stripped as unknown as Theme) };
      expect(validateTheme(derived).valid).toBe(true);
    }
  });
});

describe('compileTheme pageStyle behavior', () => {
  it('fills pageStyle when the partial omits it', () => {
    const compiled = compileTheme({ id: 'test-fill', name: 'Test Fill' });
    expect(compiled.pageStyle).toBeDefined();
    expect(compiled.pageStyle!.family).toBe('clean');
  });

  it('preserves an explicit pageStyle untouched', () => {
    const explicit = clone(VALID_PAGE_STYLE);
    explicit.family = 'brutalist';
    const compiled = compileTheme({
      id: 'test-explicit',
      name: 'Test Explicit',
      pageStyle: explicit,
    });
    expect(compiled.pageStyle!.family).toBe('brutalist');
  });

  it('inherits the base theme pageStyle through compile', () => {
    const compiled = compileTheme({ id: 'derived', name: 'Derived' }, { base: THEMES.magazine });
    expect(compiled.pageStyle).toEqual(THEMES.magazine.pageStyle);
  });
});

describe('pageStyle frontmatter round-trip', () => {
  it('survives the squisq-custom-themes codec deep-equal', () => {
    const theme = clone(THEMES['tech-dark']);
    theme.id = 'custom-tech';
    const encoded = writeCustomThemesToFrontmatter([theme]);
    expect(encoded).toBeDefined();
    const decoded = readCustomThemesFromFrontmatter({ 'squisq-custom-themes': encoded });
    expect(decoded).toHaveLength(1);
    expect(decoded![0].pageStyle).toEqual(theme.pageStyle);
  });
});
