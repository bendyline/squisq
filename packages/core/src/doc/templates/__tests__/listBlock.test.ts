import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../../../markdown/parse.js';
import { createTemplateContext } from '../../../schemas/BlockTemplates.js';
import type { TextLayer } from '../../../schemas/Doc.js';
import { DEFAULT_THEME } from '../../../schemas/themeLibrary.js';
import { VIEWPORT_PRESETS } from '../../../schemas/Viewport.js';
import { themedFontSize } from '../../utils/themeUtils.js';
import { estimateWrappedLineCount, listBlock } from '../listBlock.js';
import { estimateProseLineCount } from '../captionUtils.js';

/** A layer coordinate in viewport percent, whether authored as `'34%'` or in px. */
function pct(value: number | string | undefined, span: number): number {
  return typeof value === 'number' ? (value / span) * 100 : parseFloat(String(value));
}

const ITEMS = [
  'We launched the scripting platform for Minecraft, which was essential for launching new categories of content for Minecraft (add-ons)',
  "I spec'ed and largely built the Minecraft Creator Tools suite, including a website for beginning to advanced creators and set of NPM commands and tools.",
  'I manage and craft the Minecraft samples and documentation suite',
  'I produce and create the Minecraft Creator Channel on YouTube',
];

describe('listBlock', () => {
  it('reserves vertical space for wrapped list items', () => {
    const context = createTemplateContext(DEFAULT_THEME, 0, 1, VIEWPORT_PRESETS.landscape);
    const layers = listBlock(
      {
        template: 'list',
        id: 'minecraft-platform',
        duration: 10,
        audioSegment: 0,
        title: 'Minecraft Platform',
        items: ITEMS,
      },
      context,
    );
    const itemLayers = layers.filter(
      (layer): layer is TextLayer => layer.type === 'text' && /^item-\d+$/.test(layer.id),
    );
    const markerLayers = layers.filter(
      (layer): layer is TextLayer => layer.type === 'text' && /^item-\d+-marker$/.test(layer.id),
    );
    const H = context.viewport.height;
    const W = context.viewport.width;
    const yPositions = itemLayers.map((layer) => pct(layer.position.y, H));

    expect(itemLayers).toHaveLength(4);
    expect(markerLayers).toHaveLength(4);
    // The items start below the lockup's headline.
    const title = layers.find((layer) => layer.id === 'list-title');
    expect(title).toBeDefined();
    expect(yPositions[0]).toBeGreaterThan(pct(title!.position.y, H));

    // The marker has its own right-aligned column, while all body lines are
    // rendered by one layer beginning after that column (a hanging indent).
    expect(markerLayers[0]!.content.text).toBe('1.');
    expect(markerLayers[0]!.content.style.textAlign).toBe('right');
    expect(itemLayers[0]!.content.text).toBe(ITEMS[0]);
    const markerRightPx =
      (pct(markerLayers[0]!.position.x, W) / 100) * W + Number(markerLayers[0]!.position.width);
    const bodyLeftPx = (pct(itemLayers[0]!.position.x, W) / 100) * W;
    expect(bodyLeftPx).toBeGreaterThan(markerRightPx);

    // Each entry's following item starts after the lines it wraps to plus
    // the inter-item gap, so a wrapped entry never overlaps the next one.
    const fontSize = itemLayers[0]!.content.style.fontSize;
    // The gap between items scales with the type from 18px at the base size.
    const gap = 18 * (fontSize / themedFontSize(34, context, false));
    const lines = itemLayers.map((layer) =>
      estimateProseLineCount(layer.content.text, fontSize, Number(layer.position.width)),
    );
    expect(Math.max(...lines)).toBeGreaterThan(1);
    for (let i = 0; i < itemLayers.length - 1; i++) {
      const advance = ((lines[i]! * fontSize * 1.2 + gap) / H) * 100;
      expect(yPositions[i + 1]! - yPositions[i]!).toBeCloseTo(advance);
    }
  });

  it('preserves authored links as rich HTML on slideshow item layers', () => {
    const context = {
      ...createTemplateContext(DEFAULT_THEME, 0, 1, VIEWPORT_PRESETS.landscape),
      block: {
        id: 'linked-list',
        startTime: 0,
        duration: 10,
        audioSegment: 0,
        contents: parseMarkdown('- Visit [Docs](https://example.com/docs "Read docs")').children,
      },
    };
    const layers = listBlock(
      {
        template: 'list',
        id: 'linked-list',
        duration: 10,
        audioSegment: 0,
        items: ['Visit Docs'],
      },
      context,
    );
    const item = layers.find(
      (layer): layer is TextLayer => layer.type === 'text' && layer.id === 'item-0',
    );

    expect(item?.content.html).toBe(
      'Visit <a href="https://example.com/docs" title="Read docs">Docs</a>',
    );
  });

  it('renders authored inline icons in rich slideshow list items', () => {
    const context = {
      ...createTemplateContext(DEFAULT_THEME, 0, 1, VIEWPORT_PRESETS.landscape),
      block: {
        id: 'icon-list',
        startTime: 0,
        duration: 10,
        audioSegment: 0,
        contents: parseMarkdown(
          '- {[github]} [GitHub repository](https://github.com/bendyline/squisq)',
        ).children,
      },
    };
    const layers = listBlock(
      {
        template: 'list',
        id: 'icon-list',
        duration: 10,
        audioSegment: 0,
        items: ['GitHub repository'],
      },
      context,
    );
    const item = layers.find(
      (layer): layer is TextLayer => layer.type === 'text' && layer.id === 'item-0',
    );

    expect(item?.content.html).toBe(
      '<i class="fa-brands fa-github" aria-hidden="true"></i> ' +
        '<a href="https://github.com/bendyline/squisq">GitHub repository</a>',
    );
    expect(item?.content.html).not.toContain('{[github]}');
  });

  describe('shrink to fit', () => {
    const LINE_HEIGHT = 1.2;
    const BASE_GAP = 18;

    const LONG_ITEMS = [
      'Issaquah is a city in King County, Washington, USA. It is located approximately 17 miles east of Seattle at the foot of the Issaquah Alps.',
      'The city has a population of approximately 40,051 residents as of the 2020 census.',
      'Coordinates: 47.5301° N, 122.0326° W, Population (2020): ~40,051',
      'Racial Composition: Approximately 68% White, 22% Asian, 2% Black or African American, 8% Hispanic or Latino',
      'Major Companies: Costco (headquarters), Microsoft (nearby), Boeing, and various healthcare organizations',
      'Notable Attractions: Issaquah Salmon Hatchery, the Village Theatre, Cougar Mountain and Lake Sammamish State Park',
      'Hiking Trails: Tiger Mountain and Squak Mountain offer scenic routes, Dining: a diverse culinary scene including Italian, Asian, and seafood restaurants',
      'Roads: Well-connected to Interstate 90 and State Route 900, Median Home Price: Approximately $1,100,000',
    ];

    function render(items: string[], extra: Partial<Parameters<typeof listBlock>[0]> = {}) {
      const context = createTemplateContext(DEFAULT_THEME, 0, 1, VIEWPORT_PRESETS.landscape);
      const layers = listBlock(
        {
          template: 'list',
          id: 'shrink',
          duration: 10,
          audioSegment: 0,
          title: 'Qwen 3.5 2B',
          items,
          ...extra,
        },
        context,
      );
      const itemLayers = layers.filter(
        (layer): layer is TextLayer => layer.type === 'text' && /^item-\d+$/.test(layer.id),
      );
      const titleLayer = layers.find(
        (layer): layer is TextLayer => layer.type === 'text' && layer.id === 'list-title',
      );
      const H = context.viewport.height;
      const titleTopPct = titleLayer ? pct(titleLayer.position.y, H) : undefined;
      const firstItemTopPct = pct(itemLayers[0]!.position.y, H);
      const baseFontSize = themedFontSize(34, context, false);
      const minFontSize = themedFontSize(16, context, false);
      // The bottom edge of the last item, in viewport percent, using the
      // same wrap estimate the template reserves space with.
      const last = itemLayers[itemLayers.length - 1]!;
      const fontSize = last.content.style.fontSize;
      const lastLines = estimateWrappedLineCount(
        last.content.text,
        fontSize,
        Number(last.position.width),
      );
      const lastBottomPct =
        pct(last.position.y, H) +
        ((lastLines * fontSize * LINE_HEIGHT) / context.viewport.height) * 100;
      return {
        context,
        layers,
        itemLayers,
        titleLayer,
        titleTopPct,
        firstItemTopPct,
        baseFontSize,
        minFontSize,
        fontSize,
        lastBottomPct,
      };
    }

    // Lists share the concept slides' lockup: an accent rule over a 60px
    // headline. The relaxed layout set a 44px title over 34px items in the
    // top half of the frame, and the player cannot grow fixed item boxes.
    it('sets a short list in the lockup, its items grown beneath a clearly larger headline', () => {
      const {
        layers,
        titleLayer,
        firstItemTopPct,
        titleTopPct,
        fontSize,
        baseFontSize,
        lastBottomPct,
      } = render(LONG_ITEMS.slice(0, 3));
      expect(layers.some((layer) => layer.id === 'accent-rule')).toBe(true);
      expect(titleLayer!.content.style.fontSize).toBeGreaterThanOrEqual(fontSize / 0.8);
      expect(firstItemTopPct).toBeGreaterThan(titleTopPct!);
      // A short list grows to fill the room rather than leaving it empty.
      expect(fontSize).toBeGreaterThan(baseFontSize);
      expect(lastBottomPct).toBeLessThanOrEqual(90);
    });

    it('starts a dense list right under the headline before it spends type', () => {
      const short = render(LONG_ITEMS.slice(0, 3));
      const dense = render(LONG_ITEMS);
      expect(dense.firstItemTopPct).toBeLessThan(short.firstItemTopPct);
      expect(dense.fontSize).toBeLessThanOrEqual(dense.baseFontSize);
      expect(dense.lastBottomPct).toBeLessThanOrEqual(90);
    });

    it('starts an untitled list at the top of the frame', () => {
      const { titleLayer, firstItemTopPct } = render(LONG_ITEMS, { title: undefined });
      expect(titleLayer).toBeUndefined();
      expect(firstItemTopPct).toBeCloseTo(10, 5);
    });

    it('steps the item type down when even the condensed layout overflows', () => {
      const dense = [...LONG_ITEMS, ...LONG_ITEMS.slice(0, 4)];
      const { itemLayers, baseFontSize, minFontSize, fontSize, lastBottomPct } = render(dense);

      expect(itemLayers).toHaveLength(dense.length);
      expect(fontSize).toBeLessThan(baseFontSize);
      expect(fontSize).toBeGreaterThan(minFontSize);
      // Every marker and body shares the one shrunken size.
      for (const layer of itemLayers) expect(layer.content.style.fontSize).toBe(fontSize);
      expect(lastBottomPct).toBeLessThanOrEqual(90);

      // Sanity: at the base size the same list would have run off the slide,
      // so the shrink is what brought it back on.
      const context = createTemplateContext(DEFAULT_THEME, 0, 1, VIEWPORT_PRESETS.landscape);
      const y0 = pct(itemLayers[0]!.position.y, context.viewport.height);
      const y1 = pct(itemLayers[1]!.position.y, context.viewport.height);
      const advancePx = ((y1 - y0) / 100) * context.viewport.height;
      const scaledGap = BASE_GAP * (fontSize / baseFontSize);
      // The gap after the first (two-line) item scales with the type.
      expect(advancePx).toBeCloseTo(2 * fontSize * LINE_HEIGHT + scaledGap, 5);
    });

    it('stops at the readable minimum and lets the tail roll off the slide', () => {
      const absurd = Array.from({ length: 40 }, (_, i) => `${LONG_ITEMS[i % LONG_ITEMS.length]}`);
      const { itemLayers, minFontSize, fontSize, lastBottomPct } = render(absurd);

      expect(itemLayers).toHaveLength(40);
      expect(fontSize).toBe(minFontSize);
      expect(lastBottomPct).toBeGreaterThan(100);
    });

    it('grows a short list no further than the ramp’s top step', () => {
      const { context, fontSize, baseFontSize } = render(['One', 'Two', 'Three']);
      expect(fontSize).toBeGreaterThan(baseFontSize);
      expect(fontSize).toBeLessThanOrEqual(themedFontSize(45, context, false));
    });

    it('keeps a long list clear of a bottom accent strip', () => {
      const { titleTopPct, firstItemTopPct, fontSize, baseFontSize, lastBottomPct } = render(
        LONG_ITEMS,
        {
          accentImage: {
            src: 'https://example.com/strip.jpg',
            alt: 'Strip',
            position: 'bottom-strip',
          },
        },
      );

      // The condensed title still lands at 8% AFTER the strip's upward shift
      // (adjustY clamps at 5%, which would otherwise stack it on item 1).
      expect(titleTopPct).toBe(8);
      expect(firstItemTopPct).toBeGreaterThan(8);
      expect(fontSize).toBeLessThan(baseFontSize);
      // The strip occupies the bottom 35%; the list ends above it with clearance.
      expect(lastBottomPct).toBeLessThanOrEqual(63);
    });
  });

  it('marks task items with their box, ticked when done', () => {
    const contents = parseMarkdown(
      ['- [ ] Book the venue', '- [x] Pay the deposit'].join('\n'),
    ).children;
    const context = {
      ...createTemplateContext(DEFAULT_THEME, 0, 1, VIEWPORT_PRESETS.landscape),
      block: { id: 'tasks', startTime: 0, duration: 10, audioSegment: 0, contents },
    };
    const layers = listBlock(
      {
        template: 'list',
        id: 'tasks',
        duration: 10,
        audioSegment: 0,
        title: 'To do',
        ordered: false,
        items: ['Book the venue', 'Pay the deposit'],
      },
      context,
    );
    const text = (id: string) =>
      (layers.find((layer) => layer.id === id) as TextLayer | undefined)?.content;
    expect(text('item-0-marker')?.text).toBe('☐');
    expect(text('item-1-marker')?.text).toBe('☑');
    expect(text('item-1')?.paragraphs?.[0]?.list?.checked).toBe(true);
  });
});
