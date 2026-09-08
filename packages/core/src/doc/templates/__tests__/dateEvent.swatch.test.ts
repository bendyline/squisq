import { describe, expect, it } from 'vitest';
import { createTemplateContext } from '../../../schemas/BlockTemplates.js';
import type { DateEventInput } from '../../../schemas/BlockTemplates.js';
import type { Layer, TextLayer } from '../../../schemas/Doc.js';
import { DEFAULT_THEME, THEMES } from '../../../schemas/themeLibrary.js';
import { VIEWPORT_PRESETS } from '../../../schemas/Viewport.js';
import { themedFontSize } from '../../utils/themeUtils.js';
import { dateEvent } from '../dateEvent.js';

// Bodies mirror the swatch-generator variants that produced the baseline
// findings (fixed-slot collisions, unbounded prose, unbounded hero).
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
const FOOTER = 'Generated locally from built-in themes';

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

function makeInput(overrides: Partial<DateEventInput> = {}): DateEventInput {
  return {
    template: 'dateEvent',
    id: 'de',
    duration: 8,
    audioSegment: 0,
    date: 'July 14, 2026',
    description: SHORT,
    footer: FOOTER,
    mood: 'celebratory',
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

describe('dateEvent measured stack', () => {
  const context = createTemplateContext(DEFAULT_THEME, 0, 1, landscape);

  it('places the footer below the measured bottom of a long description', () => {
    const layers = dateEvent(makeInput({ description: LONG }), context);
    const date = boxExtent(textLayer(layers, 'date')!, landscape.height);
    const description = boxExtent(textLayer(layers, 'description')!, landscape.height);
    const footer = boxExtent(textLayer(layers, 'footer')!, landscape.height);

    expect(description.top).toBeGreaterThan(date.bottom);
    expect(footer.top).toBeGreaterThan(description.bottom);
    expect(footer.bottom).toBeLessThanOrEqual(0.92 * landscape.height + 1);
  });

  it('honours forced line breaks in a bullet body when reserving height', () => {
    const layers = dateEvent(makeInput({ description: BULLETS_MANY }), context);
    const description = textLayer(layers, 'description')!;
    const footer = textLayer(layers, 'footer')!;
    const descBox = boxExtent(description, landscape.height);
    const footBox = boxExtent(footer, landscape.height);

    // Ten items need at least ten lines of the rendered line-height.
    const lineHeightPx = description.content.style.fontSize * description.content.style.lineHeight!;
    expect(descBox.bottom - descBox.top).toBeGreaterThanOrEqual(10 * lineHeightPx);
    expect(footBox.top).toBeGreaterThan(descBox.bottom);
  });

  it('steps the description size down for a very long body, then clamps at the floor', () => {
    const base = themedFontSize(30, context, false);
    const layers = dateEvent(makeInput({ description: VARIANTS['very-long'] }), context);
    const description = textLayer(layers, 'description')!;
    const footer = boxExtent(textLayer(layers, 'footer')!, landscape.height);

    expect(description.content.style.fontSize).toBeLessThan(base);
    expect(description.content.style.fontSize).toBeGreaterThanOrEqual(18);
    // Six long bodies cannot fit even at the floor: the layer is clamped.
    expect(description.content.style.maxLines).toBeGreaterThan(0);
    expect(footer.bottom).toBeLessThanOrEqual(0.92 * landscape.height + 1);
  });

  it('steps a long heading in the hero slot down so it never reaches the body', () => {
    const base = themedFontSize(96, context, true);
    const layers = dateEvent(makeInput({ date: LONG_TITLE }), context);
    const date = textLayer(layers, 'date')!;
    const dateBox = boxExtent(date, landscape.height);
    const descBox = boxExtent(textLayer(layers, 'description')!, landscape.height);

    expect(date.content.style.fontSize).toBeLessThan(base);
    expect(date.content.style.shrinkToFit).toBe(true);
    expect(dateBox.bottom).toBeLessThan(descBox.top);
    expect(dateBox.bottom - dateBox.top).toBeLessThanOrEqual(0.3 * landscape.height);
  });

  it('skips the description layer when the body is empty instead of echoing the heading', () => {
    const layers = dateEvent(makeInput({ description: '' }), context);
    expect(layers.length).toBeGreaterThan(0);
    expect(textLayer(layers, 'date')).toBeDefined();
    expect(textLayer(layers, 'description')).toBeUndefined();
    const footer = textLayer(layers, 'footer')!;
    const dateBox = boxExtent(textLayer(layers, 'date')!, landscape.height);
    const footBox = boxExtent(footer, landscape.height);
    expect(footBox.top).toBeGreaterThan(dateBox.bottom);
  });

  it('keeps a short lockup composed around the optical centre', () => {
    const layers = dateEvent(makeInput(), context);
    const dateBox = boxExtent(textLayer(layers, 'date')!, landscape.height);
    const footBox = boxExtent(textLayer(layers, 'footer')!, landscape.height);
    const centre = (dateBox.top + footBox.bottom) / 2 / landscape.height;
    expect(centre).toBeGreaterThan(0.4);
    expect(centre).toBeLessThan(0.52);
    // The date keeps its base size when it fits on one line.
    expect(textLayer(layers, 'date')!.content.style.fontSize).toBe(
      themedFontSize(96, context, true),
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
        for (const [variant, description] of Object.entries(VARIANTS)) {
          for (const date of ['July 14, 2026', LONG_TITLE]) {
            const layers = dateEvent(makeInput({ date, description }), ctx);
            const texts = layers.filter((l): l is TextLayer => l.type === 'text');
            expect(texts.length, `${theme.id} ${viewport.name} ${variant}`).toBeGreaterThan(0);
            let previousBottom = -Infinity;
            for (const layer of texts) {
              const { top, bottom } = boxExtent(layer, viewport.height);
              const label = `${theme.id} ${viewport.name} ${variant} ${layer.id}`;
              expect(top, label).toBeGreaterThanOrEqual(0.08 * viewport.height - 1);
              expect(bottom, label).toBeLessThanOrEqual(0.92 * viewport.height + 1);
              // Layers are emitted top-to-bottom and never overprint.
              expect(top, label).toBeGreaterThanOrEqual(previousBottom);
              previousBottom = bottom;
            }
          }
        }
      }
    }
  });

  it('keeps the stack above a bottom accent strip', () => {
    const layers = dateEvent(
      makeInput({
        description: LONG,
        accentImage: { src: 'x.jpg', alt: 'x', position: 'bottom-strip' },
      }),
      context,
    );
    const footer = boxExtent(textLayer(layers, 'footer')!, landscape.height);
    expect(footer.bottom).toBeLessThanOrEqual(0.65 * landscape.height + 1);
  });

  it('keeps the column-centre x convention shared by the other prose lockups', () => {
    const layers = dateEvent(makeInput(), context);
    for (const id of ['date', 'description', 'footer']) {
      const layer = textLayer(layers, id)!;
      expect(layer.position.x).toBe('50%');
      expect(layer.position.width).toBe('85%');
      expect(layer.content.style.textAlign).toBe('left');
    }
  });
});
