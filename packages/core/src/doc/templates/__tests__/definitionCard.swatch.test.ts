import { describe, expect, it } from 'vitest';
import { createTemplateContext } from '../../../schemas/BlockTemplates.js';
import type { DefinitionCardInput } from '../../../schemas/BlockTemplates.js';
import type { Layer, TextLayer } from '../../../schemas/Doc.js';
import { DEFAULT_THEME, THEMES } from '../../../schemas/themeLibrary.js';
import { VIEWPORT_PRESETS } from '../../../schemas/Viewport.js';
import { themedFontSize } from '../../utils/themeUtils.js';
import { definitionCard } from '../definitionCard.js';

// Bodies mirror the swatch-generator variants that produced the baseline
// findings (fixed-slot collisions, hard maxLines: 4, unbounded hero).
const SHORT =
  'The waterfront redesign opened to the public in June, and weekend foot traffic doubled within a month.';
const LONG =
  'When the harbor authority first proposed closing the arterial, the loudest objection was congestion: four lanes of traffic had to go somewhere, and the bypass was already busy at the evening peak. The counts told a different story. Roughly a third of the trips simply disappeared, absorbed by the ferry, the new cycle track, and people choosing to walk the last kilometre. The bypass gained about two hundred vehicles an hour, well inside its capacity, and average speeds there did not change in a measurable way.\n\nWhat changed most was how long people stayed. Before the redesign the median visit to the promenade lasted fourteen minutes; afterwards it stretched to thirty-one, and the evening ferry — once nearly empty after nine — now runs full on Fridays and Saturdays. The tidal garden survived its first storm season with minor planting losses, the merchants voted to extend their hours, and the authority is now drafting the same treatment for the fishing quay on the north shore.';
const BULLETS_MANY = [
  'Weekend foot traffic doubled within the first month',
  'Vehicle throughput on the bypass held steady at 1,900 per hour',
  'Median dwell time rose from 14 to 31 minutes',
  'Ferry service extended to 11 pm on Fridays and Saturdays',
  'The tidal garden survived its first storm season',
  'Roughly a third of arterial trips disappeared rather than diverting, absorbed by the ferry, the cycle track, and people walking the last kilometre',
  'Merchants voted to extend evening hours after dwell times more than doubled',
  'Noise at the promenade edge fell from 71 dB to 58 dB at the evening peak',
  'Cycle counts on the protected track average 2,400 per weekday and 3,900 on weekends',
  'The north-shore fishing quay is next: the authority is drafting the same shared-surface treatment for a 2027 start',
].join('\n');
const LONG_TITLE =
  'How the Harbor Waterfront Redesign Doubled Weekend Foot Traffic Without Slowing the Bypass or Cutting Evening Ferry Service';
const INTL =
  '港の再設計は六月に一般公開され、週末の歩行者数は一か月で倍増した。 أعيد تصميم الواجهة البحرية وافتُتحت للجمهور في يونيو، وتضاعفت حركة المشاة في عطلة نهاية الأسبوع خلال شهر. Η ανάπλαση της προκυμαίας άνοιξε τον Ιούνιο. Die Neugestaltung der Uferpromenade wurde im Juni eröffnet — Fußgängerverkehr verdoppelte sich. Việc tái thiết kế bờ sông đã mở cửa vào tháng Sáu 🚢⛴️🌊.';

const VARIANTS: Record<string, string> = {
  empty: '',
  short: SHORT,
  paragraph: `${SHORT} ${SHORT} ${SHORT}`,
  long: LONG,
  'bullets-many': BULLETS_MANY,
  'very-long': Array.from({ length: 6 }, () => LONG).join('\n\n'),
  intl: INTL,
};

const landscape = VIEWPORT_PRESETS.landscape;

function makeInput(overrides: Partial<DefinitionCardInput> = {}): DefinitionCardInput {
  return {
    template: 'definitionCard',
    id: 'dc',
    duration: 8,
    audioSegment: 0,
    term: 'Gezellig',
    definition: SHORT,
    origin: 'Dutch, 18th century',
    ...overrides,
  };
}

function textLayer(layers: Layer[], id: string): TextLayer | undefined {
  return layers.find((l): l is TextLayer => l.type === 'text' && l.id === id);
}

/** Vertical extent of a text box in viewport px (centre anchor + explicit height). */
function boxExtent(layer: TextLayer, viewportHeight: number): { top: number; bottom: number } {
  const centreY = (parseFloat(String(layer.position.y)) / 100) * viewportHeight;
  const height = Number(layer.position.height);
  expect(layer.position.anchor).toBe('center');
  expect(layer.content.style.verticalAlign).toBe('top');
  expect(Number.isFinite(height)).toBe(true);
  return { top: centreY - height / 2, bottom: centreY + height / 2 };
}

describe('definitionCard measured stack', () => {
  const context = createTemplateContext(DEFAULT_THEME, 0, 1, landscape);

  it('stacks term, rule, definition and origin without overprinting for a long definition', () => {
    const layers = definitionCard(makeInput({ definition: LONG }), context);
    const term = boxExtent(textLayer(layers, 'term')!, landscape.height);
    const rule = layers.find((l) => l.id === 'separator')!;
    const ruleTop = (parseFloat(String(rule.position.y)) / 100) * landscape.height;
    const definition = boxExtent(textLayer(layers, 'definition')!, landscape.height);
    const origin = boxExtent(textLayer(layers, 'origin')!, landscape.height);

    expect(ruleTop).toBeGreaterThan(term.bottom);
    expect(definition.top).toBeGreaterThan(ruleTop);
    expect(origin.top).toBeGreaterThan(definition.bottom);
    expect(origin.bottom).toBeLessThanOrEqual(0.92 * landscape.height + 1);
  });

  it('no longer clamps a 180-word definition to four lines at the base size', () => {
    const layers = definitionCard(makeInput({ definition: LONG }), context);
    const definition = textLayer(layers, 'definition')!;
    const box = boxExtent(definition, landscape.height);
    const lineHeightPx = definition.content.style.fontSize * definition.content.style.lineHeight!;
    // The old template hard-coded maxLines: 4; the fitted slot reserves many more.
    expect(definition.content.style.maxLines ?? Infinity).toBeGreaterThan(4);
    expect((box.bottom - box.top) / lineHeightPx).toBeGreaterThan(8);
  });

  it('steps the definition size down for a very long body, then clamps at the floor', () => {
    const base = themedFontSize(32, context, false);
    const layers = definitionCard(makeInput({ definition: VARIANTS['very-long'] }), context);
    const definition = textLayer(layers, 'definition')!;
    const origin = boxExtent(textLayer(layers, 'origin')!, landscape.height);

    expect(definition.content.style.fontSize).toBeLessThan(base);
    expect(definition.content.style.fontSize).toBeGreaterThanOrEqual(18);
    expect(definition.content.style.maxLines).toBeGreaterThan(0);
    expect(origin.bottom).toBeLessThanOrEqual(0.92 * landscape.height + 1);
  });

  it('fits a long heading in the term slot above the rule and definition', () => {
    const layers = definitionCard(makeInput({ term: LONG_TITLE }), context);
    const term = textLayer(layers, 'term')!;
    const termBox = boxExtent(term, landscape.height);
    const rule = layers.find((l) => l.id === 'separator')!;
    const ruleTop = (parseFloat(String(rule.position.y)) / 100) * landscape.height;
    const defBox = boxExtent(textLayer(layers, 'definition')!, landscape.height);

    expect(term.content.style.shrinkToFit).toBe(true);
    expect(termBox.bottom - termBox.top).toBeLessThanOrEqual(0.3 * landscape.height);
    expect(ruleTop).toBeGreaterThan(termBox.bottom);
    expect(defBox.top).toBeGreaterThan(termBox.bottom);
  });

  it('steps a very long term down below the base size', () => {
    const base = themedFontSize(72, context, true);
    const layers = definitionCard(makeInput({ term: `${LONG_TITLE} ${LONG_TITLE}` }), context);
    expect(textLayer(layers, 'term')!.content.style.fontSize).toBeLessThan(base);
  });

  it('skips the definition layer when the body is empty instead of echoing the term', () => {
    const layers = definitionCard(makeInput({ definition: '' }), context);
    expect(layers.length).toBeGreaterThan(0);
    expect(textLayer(layers, 'term')).toBeDefined();
    expect(textLayer(layers, 'definition')).toBeUndefined();
    const termBox = boxExtent(textLayer(layers, 'term')!, landscape.height);
    const originBox = boxExtent(textLayer(layers, 'origin')!, landscape.height);
    expect(originBox.top).toBeGreaterThan(termBox.bottom);
  });

  it('keeps a short entry composed around the optical centre', () => {
    const layers = definitionCard(makeInput(), context);
    const termBox = boxExtent(textLayer(layers, 'term')!, landscape.height);
    const originBox = boxExtent(textLayer(layers, 'origin')!, landscape.height);
    const centre = (termBox.top + originBox.bottom) / 2 / landscape.height;
    expect(centre).toBeGreaterThan(0.4);
    expect(centre).toBeLessThan(0.52);
    expect(textLayer(layers, 'term')!.content.style.fontSize).toBe(
      themedFontSize(72, context, true),
    );
  });

  it('keeps every text box inside the frame for every variant, theme and orientation', () => {
    const viewports = [
      VIEWPORT_PRESETS.landscape,
      VIEWPORT_PRESETS.portrait,
      VIEWPORT_PRESETS.square,
    ];
    for (const theme of Object.values(THEMES)) {
      for (const viewport of viewports) {
        const ctx = createTemplateContext(theme, 0, 1, viewport);
        for (const [variant, definition] of Object.entries(VARIANTS)) {
          for (const term of ['Gezellig', LONG_TITLE]) {
            const layers = definitionCard(makeInput({ term, definition }), ctx);
            const texts = layers.filter((l): l is TextLayer => l.type === 'text');
            expect(texts.length, `${theme.id} ${viewport.name} ${variant}`).toBeGreaterThan(0);
            let previousBottom = -Infinity;
            for (const layer of texts) {
              const { top, bottom } = boxExtent(layer, viewport.height);
              const label = `${theme.id} ${viewport.name} ${variant} ${layer.id}`;
              expect(top, label).toBeGreaterThanOrEqual(0.08 * viewport.height - 1);
              expect(bottom, label).toBeLessThanOrEqual(0.92 * viewport.height + 1);
              expect(top, label).toBeGreaterThanOrEqual(previousBottom);
              previousBottom = bottom;
            }
          }
        }
      }
    }
  });

  it('keeps the stack above a bottom accent strip', () => {
    const layers = definitionCard(
      makeInput({
        definition: LONG,
        accentImage: { src: 'x.jpg', alt: 'x', position: 'bottom-strip' },
      }),
      context,
    );
    const origin = boxExtent(textLayer(layers, 'origin')!, landscape.height);
    expect(origin.bottom).toBeLessThanOrEqual(0.65 * landscape.height + 1);
  });

  it('keeps the rule on the column left edge and the text on the column centre', () => {
    const layers = definitionCard(makeInput(), context);
    const rule = layers.find((l) => l.id === 'separator')!;
    expect(rule.position.x).toBe('7.5%');
    expect(rule.position.anchor).toBe('top-left');
    for (const id of ['term', 'definition', 'origin']) {
      const layer = textLayer(layers, id)!;
      expect(layer.position.x).toBe('50%');
      expect(layer.position.width).toBe('85%');
      expect(layer.content.style.textAlign).toBe('left');
    }
  });
});
