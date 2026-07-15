import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Block, Doc } from '../schemas/Doc.js';
import type { Theme } from '../schemas/Theme.js';
import { PAGE_SECTION_KINDS } from '../schemas/PageStyle.js';
import { THEMES, DEFAULT_THEME } from '../schemas/themeLibrary.js';
import { createTheme } from '../schemas/Theme.js';
import { templateRegistry } from '../doc/templates/registry.js';
import { TEMPLATE_ALIASES } from '../doc/templates/templateNames.js';
import { sectionExtractors } from '../doc/page/sectionExtractors.js';
import {
  materializePageSection,
  materializePageSections,
  resolvePageStyle,
} from '../doc/page/materializePageSection.js';
import { parseMarkdown } from '../markdown/parse.js';
import { markdownToDoc } from '../doc/markdownToDoc.js';
import { buildPageCss, buildPageCssVars, PAGE_BASE_CSS } from '../doc/pageCss.js';
import { resolveTransformStyle } from '../transform/registry.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function templateBlock(template: string, extra: Record<string, unknown> = {}): Block {
  return {
    id: `test-${template}`,
    startTime: 0,
    duration: 1,
    audioSegment: 0,
    template,
    ...extra,
  } as unknown as Block;
}

function docOf(blocks: Block[], extra: Partial<Doc> = {}): Doc {
  return { blocks, duration: 10, ...extra } as Doc;
}

describe('section extractor coverage', () => {
  it('covers every registered template id', () => {
    for (const id of Object.keys(templateRegistry)) {
      expect(sectionExtractors[id], `template "${id}" has no section extractor`).toBeDefined();
    }
  });

  it('maps every registry template (and alias) to a valid section kind', () => {
    const names = [...Object.keys(templateRegistry), ...Object.keys(TEMPLATE_ALIASES)];
    for (const name of names) {
      const { section, source } = materializePageSection(templateBlock(name));
      expect(source, name).toBe('template');
      expect(PAGE_SECTION_KINDS, `${name} → ${section.kind}`).toContain(section.kind);
    }
  });

  it('extracts typed slots for representative templates', () => {
    const stat = materializePageSection(
      templateBlock('statHighlight', { stat: '42%', description: 'more speed', detail: 'ctx' }),
    ).section;
    expect(stat.kind).toBe('stat-band');
    expect(stat.slots.items?.[0]).toMatchObject({ value: '42%', title: 'more speed' });

    const quote = materializePageSection(
      templateBlock('quote', { quote: 'Words matter.', attribution: 'Someone' }),
    ).section;
    expect(quote.kind).toBe('quote-band');
    expect(quote.slots.body?.text).toBe('Words matter.');
    expect(quote.slots.attribution).toBe('Someone');

    const feature = materializePageSection(
      templateBlock('rightFeature', { imageSrc: 'a.png', title: 'T', body: 'B' }),
    ).section;
    expect(feature.kind).toBe('feature-split');
    expect(feature.variant).toBe('media-right');
    expect(feature.slots.media).toMatchObject({ type: 'image', src: 'a.png' });

    const table = materializePageSection(
      templateBlock('dataTable', { headers: ['A'], rows: [['1']] }),
    ).section;
    expect(table.kind).toBe('table-section');
    expect(table.slots.table).toMatchObject({ headers: ['A'], rows: [['1']] });

    const diagram = materializePageSection(templateBlock('diagram', { nodes: [] })).section;
    expect(diagram.kind).toBe('canvas-embed');
    expect(diagram.slots.media).toMatchObject({ type: 'canvas', spatial: 'diagram' });

    const video = materializePageSection(
      templateBlock('videoWithCaption', {
        videoSrc: 'v.mp4',
        videoAlt: 'clip',
        clipStart: 0,
        clipEnd: 3,
      }),
    ).section;
    expect(video.kind).toBe('media-figure');
    expect(video.slots.media).toMatchObject({ type: 'video', src: 'v.mp4' });
  });

  it('pullQuote with a background image becomes a media-backed quote band', () => {
    const { section } = materializePageSection(
      templateBlock('pullQuote', {
        text: 'Big words',
        backgroundImage: { src: 'bg.jpg', alt: 'bg' },
      }),
    );
    expect(section.kind).toBe('quote-band');
    expect(section.background).toBe('media');
    expect(section.slots.media).toMatchObject({ type: 'image', src: 'bg.jpg' });
  });
});

describe('non-template paths', () => {
  it('unknown template falls back to a visible diagnostic callout without console.warn', () => {
    const warnSpy = vi.spyOn(console, 'warn');
    const { section, source, diagnostic } = materializePageSection(templateBlock('zzz-nope'));
    expect(source).toBe('fallback');
    expect(section.kind).toBe('callout');
    expect(section.variant).toBe('diagnostic');
    expect(section.slots.meta).toContain('Unknown template');
    expect(diagnostic).toMatchObject({ code: 'unknown-template', template: 'zzz-nope' });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('custom templates become custom canvas embeds at their authored aspect', () => {
    const { section, source } = materializePageSection(templateBlock('my-custom'), {
      customTemplates: [
        {
          name: 'my-custom',
          label: 'My Custom',
          viewport: { width: 1080, height: 1080 },
          layers: [],
        } as never,
      ],
    });
    expect(source).toBe('custom-template');
    expect(section.kind).toBe('canvas-embed');
    expect(section.slots.media).toMatchObject({
      type: 'canvas',
      spatial: 'custom',
      aspect: { width: 1080, height: 1080 },
    });
  });

  it('authored layer blocks become authored canvas embeds', () => {
    const block = {
      id: 'raw',
      startTime: 0,
      duration: 1,
      audioSegment: 0,
      layers: [{ id: 'l1', type: 'text', content: { text: 'hi' } }],
    } as unknown as Block;
    const { section, source } = materializePageSection(block);
    expect(source).toBe('authored');
    expect(section.kind).toBe('canvas-embed');
    expect(section.slots.media).toMatchObject({ type: 'canvas', spatial: 'authored' });
  });

  it('plain heading blocks become prose sections with markdown body', () => {
    const doc = markdownToDoc(parseMarkdown('# Hello\n\nSome *rich* text.'));
    const sections = materializePageSections(doc);
    const prose = sections.find((entry) => entry.section.kind === 'prose');
    expect(prose).toBeDefined();
    expect(prose!.section.slots.title).toBe('Hello');
    expect(prose!.section.slots.headingLevel).toBe(1);
    expect(prose!.section.slots.body?.markdown?.length).toBeGreaterThan(0);
    expect(prose!.section.slots.body?.text).toContain('Some');
  });

  it('auto-templated blocks map to their typed section', () => {
    const doc = markdownToDoc(parseMarkdown('# Journey\n\n> The only way out is through.'));
    const sections = materializePageSections(doc);
    const auto = sections.find((entry) => entry.section.template === 'quote');
    expect(auto).toBeDefined();
    expect(auto!.section.kind).toBe('quote-band');
    expect(auto!.section.slots.body?.text).toContain('only way out');
  });

  it('uses a heading-only quote as the quote body without a duplicate title', () => {
    const doc = markdownToDoc(parseMarkdown('# Words worth quoting {[quote]}'));
    const quote = materializePageSections(doc).find((entry) => entry.section.template === 'quote');

    expect(quote?.section.slots.body?.text).toBe('Words worth quoting');
    expect(quote?.section.slots.title).toBeUndefined();
  });

  it('preserves Mermaid and unconsumed media alongside typed page templates', () => {
    const doc = markdownToDoc(
      parseMarkdown(
        '# Rich {[factCard]}\n\nNarrative copy.\n\n```mermaid\nflowchart LR\n  a --> b\n```',
      ),
    );
    const [entry] = materializePageSections(doc);
    expect(entry.section.kind).toBe('callout');
    expect(entry.section.slots.body?.text).not.toContain('flowchart LR');
    expect(entry.section.slots.richContent?.markdown).toEqual([
      expect.objectContaining({ type: 'code', lang: 'mermaid' }),
    ]);

    const imageBlock = templateBlock('quote', {
      quote: 'Keep the picture too.',
      contents: parseMarkdown('![Architecture](architecture.png)').children,
    });
    const imageSection = materializePageSection(imageBlock).section;
    expect(imageSection.slots.richContent?.markdown).toEqual([
      expect.objectContaining({ type: 'paragraph' }),
    ]);
  });
});

describe('doc-level art direction', () => {
  it('synthesizes a cover hero when requested', () => {
    const doc = docOf([templateBlock('quote', { quote: 'q' })], {
      startBlock: { title: 'Cover Title', subtitle: 'Sub', heroSrc: 'hero.jpg' },
    });
    const sections = materializePageSections(doc, { cover: doc.startBlock });
    expect(sections[0].section.kind).toBe('hero');
    expect(sections[0].section.source).toBe('cover');
    expect(sections[0].section.slots.title).toBe('Cover Title');
    expect(sections[0].section.background).toBe('media');
    expect(sections[0].section.emphasis).toBe('lead');

    const withoutCover = materializePageSections(doc);
    expect(withoutCover[0].section.kind).not.toBe('hero');
  });

  it('dedupes the cover against an authored title block (authored hero wins)', () => {
    const doc = docOf([templateBlock('title', { title: 'Same Title', subtitle: 'Authored sub' })], {
      startBlock: { title: 'Same Title', heroSrc: 'hero.jpg', heroAlt: 'hero' },
    });
    const sections = materializePageSections(doc, { cover: doc.startBlock });
    const heroes = sections.filter((entry) => entry.section.kind === 'hero');
    expect(heroes).toHaveLength(1);
    expect(heroes[0].section.source).toBe('template');
    // The cover's hero image grafts onto the authored hero when it has none.
    expect(heroes[0].section.slots.media).toMatchObject({ type: 'image', src: 'hero.jpg' });
    expect(heroes[0].section.background).toBe('media');
  });

  it('dedupes the cover against a mirrored leading prose H1', () => {
    const doc = markdownToDoc(parseMarkdown('# My Doc\n\nIntro paragraph.\n\nSecond paragraph.'));
    expect(doc.startBlock?.title).toBe('My Doc');
    const sections = materializePageSections(doc, { cover: doc.startBlock });
    expect(sections[0].section.kind).toBe('hero');
    expect(sections[0].section.slots.subtitle).toBe('Intro paragraph.');
    // The H1's own section keeps only the non-mirrored body.
    const prose = sections.find((entry) => entry.section.kind === 'prose')!;
    expect(prose.section.slots.title).toBeUndefined();
    expect(prose.section.slots.body?.text).toBe('Second paragraph.');
  });

  it('applies the alternate background rhythm across non-prose sections', () => {
    const theme = THEMES.standard; // backgroundRhythm: alternate
    const doc = docOf([
      templateBlock('quote', { quote: 'a' }),
      templateBlock('quote', { quote: 'b' }),
      templateBlock('quote', { quote: 'c' }),
    ]);
    const sections = materializePageSections(doc, { theme });
    expect(sections.map((entry) => entry.section.background)).toEqual([
      'base',
      'alternate',
      'base',
    ]);
  });

  it('rotates accent schemes with cycle strategy and lets block colorScheme win', () => {
    const theme = THEMES.standard; // accentRotation: cycle
    const schemeNames = Object.keys(theme.colorSchemes);
    const doc = docOf([
      templateBlock('sectionHeader', { title: 'one' }),
      templateBlock('sectionHeader', { title: 'two' }),
      templateBlock('sectionHeader', { title: 'pinned', colorScheme: 'teal' }),
    ]);
    const sections = materializePageSections(doc, { theme });
    expect(sections[0].section.accent).toMatchObject({
      schemeName: schemeNames[0],
      role: 'rotation',
    });
    expect(sections[1].section.accent).toMatchObject({
      schemeName: schemeNames[1],
      role: 'rotation',
    });
    expect(sections[2].section.accent).toMatchObject({ schemeName: 'teal', role: 'block' });
  });

  it('primary-only strategy skips rotation', () => {
    const theme = THEMES.documentary;
    const doc = docOf([templateBlock('sectionHeader', { title: 'one' })]);
    const sections = materializePageSections(doc, { theme });
    expect(sections[0].section.accent.role).toBe('primary');
    expect(sections[0].section.accent.schemeName).toBeUndefined();
  });

  it('applies theme section overrides (documentary quote-band → editorial variant)', () => {
    const sections = materializePageSections(docOf([templateBlock('quote', { quote: 'q' })]), {
      theme: THEMES.documentary,
    });
    expect(sections[0].section.variant).toBe('editorial');
  });

  it('applies per-template hints (tech-dark diagram → terminal frame)', () => {
    const sections = materializePageSections(docOf([templateBlock('diagram', {})]), {
      theme: THEMES['tech-dark'],
    });
    expect(sections[0].section.hints).toMatchObject({ frame: 'terminal' });
  });

  it('numbers hero/banner eyebrows under numbered and mono-tag treatments', () => {
    const doc = docOf([
      templateBlock('sectionHeader', { title: 'one' }),
      templateBlock('quote', { quote: 'interlude' }),
      templateBlock('sectionHeader', { title: 'two' }),
    ]);
    const sections = materializePageSections(doc, { theme: THEMES.documentary });
    expect(sections[0].section.slots.eyebrow).toBe('01');
    expect(sections[1].section.slots.eyebrow).toBeUndefined();
    expect(sections[2].section.slots.eyebrow).toBe('02');

    const clean = materializePageSections(doc, { theme: THEMES.standard });
    expect(clean[0].section.slots.eyebrow).toBeUndefined();
  });

  it('container template children are consumed; other children recurse with depth', () => {
    const container = templateBlock('diagram', {
      children: [
        {
          id: 'child-consumed',
          startTime: 0,
          duration: 1,
          audioSegment: 0,
          template: 'sectionHeader',
        },
      ],
    });
    const parent = {
      ...templateBlock('sectionHeader', { title: 'parent' }),
      children: [
        {
          id: 'child-kept',
          startTime: 0,
          duration: 1,
          audioSegment: 0,
          sourceHeading: {
            type: 'heading',
            depth: 2,
            children: [{ type: 'text', value: 'Child' }],
          },
        } as unknown as Block,
      ],
    } as Block;
    const sections = materializePageSections(docOf([container, parent]));
    const ids = sections.map((entry) => entry.section.blockId);
    expect(ids).not.toContain('child-consumed');
    expect(ids).toContain('child-kept');
    const child = sections.find((entry) => entry.section.blockId === 'child-kept')!;
    expect(child.section.depth).toBe(1);
  });

  it('transform page hints overlay spacing and front-load emphasis', () => {
    const hints = resolveTransformStyle('documentary').page;
    expect(hints).toMatchObject({ spacing: 'generous', emphasisCurve: 'front-loaded' });

    const style = resolvePageStyle(THEMES.standard, { spacing: 'compact' });
    expect(style.tokens.sectionSpacing).toBe('compact');
    expect(THEMES.standard.pageStyle!.tokens.sectionSpacing).toBe('comfortable');

    const doc = docOf([
      templateBlock('quote', { quote: 'a' }),
      templateBlock('quote', { quote: 'b' }),
      templateBlock('quote', { quote: 'c' }),
    ]);
    const sections = materializePageSections(doc, {
      transformPage: { emphasisCurve: 'front-loaded' },
    });
    expect(sections[0].section.emphasis).toBe('strong');
    expect(sections[1].section.emphasis).toBe('strong');
    expect(sections[2].section.emphasis).toBe('standard');
  });

  it('indexes sections pre-order with totals', () => {
    const doc = docOf([
      templateBlock('quote', { quote: 'a' }),
      templateBlock('quote', { quote: 'b' }),
    ]);
    const sections = materializePageSections(doc);
    expect(sections.map((entry) => entry.section.index)).toEqual([0, 1]);
    expect(sections.every((entry) => entry.section.totalSections === 2)).toBe(true);
  });
});

describe('page CSS', () => {
  it('builds theme vars covering colors, fonts, and token dimensions', () => {
    const vars = buildPageCssVars(THEMES.magazine);
    expect(vars['--squisq-page-bg']).toBe(THEMES.magazine.colors.background);
    expect(vars['--squisq-page-wide-max']).toBe('1240px');
    expect(vars['--squisq-page-title-font']).toContain('DM Serif');
  });

  it('buildPageCss embeds the vars and the structural sheet', () => {
    const css = buildPageCss(DEFAULT_THEME);
    expect(css).toContain('.squisq-page {');
    expect(css).toContain('--squisq-page-bg:');
    expect(css).toContain(PAGE_BASE_CSS.slice(0, 60).trim());
  });

  it('resolvePageStyle derives a style for themes without pageStyle', () => {
    const theme = createTheme(DEFAULT_THEME, { id: 'legacy' });
    delete (theme as unknown as Record<string, unknown>).pageStyle;
    const style = resolvePageStyle(theme as Theme);
    expect(style.family).toBe('clean');
    expect(style.tokens.contentMaxWidth).toBeGreaterThan(0);
  });
});
