import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '../../../markdown/parse.js';
import { createTemplateContext } from '../../../schemas/BlockTemplates.js';
import type { TextLayer } from '../../../schemas/Doc.js';
import { DEFAULT_THEME } from '../../../schemas/themeLibrary.js';
import { VIEWPORT_PRESETS } from '../../../schemas/Viewport.js';
import { themedFontSize } from '../../utils/themeUtils.js';
import { estimateWrappedLineCount, listBlock } from '../listBlock.js';

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
    const yPositions = itemLayers.map((layer) => parseFloat(String(layer.position.y)));

    expect(itemLayers).toHaveLength(4);
    expect(markerLayers).toHaveLength(4);
    expect(yPositions[0]).toBe(34);

    // The marker has its own right-aligned column, while all body lines are
    // rendered by one layer beginning after that column (a hanging indent).
    expect(markerLayers[0]!.content.text).toBe('1.');
    expect(markerLayers[0]!.content.style.textAlign).toBe('right');
    expect(itemLayers[0]!.content.text).toBe(ITEMS[0]);
    const markerRightPx =
      (parseFloat(String(markerLayers[0]!.position.x)) / 100) * context.viewport.width +
      Number(markerLayers[0]!.position.width);
    const bodyLeftPx =
      (parseFloat(String(itemLayers[0]!.position.x)) / 100) * context.viewport.width;
    expect(bodyLeftPx).toBeGreaterThan(markerRightPx);

    // The first two entries wrap to two lines. Their following baselines
    // therefore advance by two line-heights plus the inter-item gap.
    const fontSize = itemLayers[0]!.content.style.fontSize;
    const twoLineAdvance = ((2 * fontSize * 1.2 + 18) / context.viewport.height) * 100;
    expect(yPositions[1]! - yPositions[0]!).toBeCloseTo(twoLineAdvance);
    expect(yPositions[2]! - yPositions[1]!).toBeCloseTo(twoLineAdvance);

    // The third entry fits on one line, so the final advance is compact.
    const oneLineAdvance = ((fontSize * 1.2 + 18) / context.viewport.height) * 100;
    expect(yPositions[3]! - yPositions[2]!).toBeCloseTo(oneLineAdvance);
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
      const titleTopPct = titleLayer ? parseFloat(String(titleLayer.position.y)) : undefined;
      const firstItemTopPct = parseFloat(String(itemLayers[0]!.position.y));
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
        parseFloat(String(last.position.y)) +
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

    it('keeps the relaxed layout — title at 20%, items from 34% — for a short list', () => {
      const { titleTopPct, firstItemTopPct, fontSize, baseFontSize } = render(
        LONG_ITEMS.slice(0, 3),
      );
      expect(titleTopPct).toBe(20);
      expect(firstItemTopPct).toBe(34);
      expect(fontSize).toBe(baseFontSize);
    });

    it('condenses the top margin before it spends any type size', () => {
      // Eight wrapped items overflow the relaxed layout at the base size, but
      // pulling the title up to the top of the frame and starting the items
      // right beneath it recovers enough height that no shrink is needed.
      const {
        context,
        titleLayer,
        titleTopPct,
        firstItemTopPct,
        fontSize,
        baseFontSize,
        lastBottomPct,
      } = render(LONG_ITEMS);

      expect(titleTopPct).toBe(8);
      expect(fontSize).toBe(baseFontSize);
      expect(lastBottomPct).toBeLessThanOrEqual(92);

      // The first item sits directly under the (one-line) title.
      const titleFontSize = titleLayer!.content.style.fontSize;
      const expectedFirstItemTop =
        8 + ((titleFontSize * 1.15 + 22) / context.viewport.height) * 100;
      expect(firstItemTopPct).toBeCloseTo(expectedFirstItemTop, 5);
      expect(firstItemTopPct).toBeLessThan(34);
    });

    it('condenses an untitled dense list from 26% up to the top of the frame', () => {
      const { titleLayer, firstItemTopPct } = render(LONG_ITEMS, { title: undefined });
      expect(titleLayer).toBeUndefined();
      expect(firstItemTopPct).toBe(8);
    });

    it('steps the item type down when even the condensed layout overflows', () => {
      const dense = [...LONG_ITEMS, ...LONG_ITEMS.slice(0, 4)];
      const { itemLayers, titleTopPct, baseFontSize, minFontSize, fontSize, lastBottomPct } =
        render(dense);

      expect(itemLayers).toHaveLength(dense.length);
      expect(titleTopPct).toBe(8);
      expect(fontSize).toBeLessThan(baseFontSize);
      expect(fontSize).toBeGreaterThan(minFontSize);
      // Every marker and body shares the one shrunken size.
      for (const layer of itemLayers) expect(layer.content.style.fontSize).toBe(fontSize);
      expect(lastBottomPct).toBeLessThanOrEqual(92);

      // Sanity: at the base size the same list would have run off the slide,
      // so the shrink is what brought it back on.
      const context = createTemplateContext(DEFAULT_THEME, 0, 1, VIEWPORT_PRESETS.landscape);
      const y0 = parseFloat(String(itemLayers[0]!.position.y));
      const y1 = parseFloat(String(itemLayers[1]!.position.y));
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

    it('leaves a short list at its base size', () => {
      const { fontSize, baseFontSize } = render(LONG_ITEMS.slice(0, 3));
      expect(fontSize).toBe(baseFontSize);
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
});
