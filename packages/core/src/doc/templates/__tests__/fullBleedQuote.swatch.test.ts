import { describe, expect, it } from 'vitest';
import { createTemplateContext } from '../../../schemas/BlockTemplates.js';
import type { Layer, TextLayer } from '../../../schemas/Doc.js';
import { DEFAULT_THEME } from '../../../schemas/themeLibrary.js';
import { VIEWPORT_PRESETS } from '../../../schemas/Viewport.js';
import { themedFontSize } from '../../utils/themeUtils.js';
import { fullBleedQuote } from '../fullBleedQuote.js';

const context = () => createTemplateContext(DEFAULT_THEME, 0, 8, VIEWPORT_PRESETS.landscape);

const PUNCHY = 'Make the oddities visible';
const SENTENCE =
  'The waterfront redesign opened to the public in June, and weekend foot traffic doubled within a month.';
const PARAGRAPH =
  'The waterfront redesign replaced a four-lane arterial with a shared promenade, a protected cycle track, and a tidal garden that floods twice a day. Early counts show weekend foot traffic more than doubling, while vehicle throughput on the parallel bypass held steady. Merchants along the promenade report longer dwell times, and the harbor authority has already extended ferry hours to match the new evening crowds.';
const LONG = `When the harbor authority first proposed closing the arterial, the loudest objection was congestion: four lanes of traffic had to go somewhere, and the bypass was already busy at the evening peak. The counts told a different story. Roughly a third of the trips simply disappeared, absorbed by the ferry, the new cycle track, and people choosing to walk the last kilometre. The bypass gained about two hundred vehicles an hour, well inside its capacity, and average speeds there did not change in a measurable way.
What changed most was how long people stayed. Before the redesign the median visit to the promenade lasted fourteen minutes; afterwards it stretched to thirty-one, and the evening ferry — once nearly empty after nine — now runs full on Fridays and Saturdays. The tidal garden survived its first storm season with minor planting losses, the merchants voted to extend their hours, and the authority is now drafting the same treatment for the fishing quay on the north shore.`;

const render = (text: string): Layer[] =>
  fullBleedQuote(
    { template: 'fullBleedQuote', id: 'fbq', duration: 6, audioSegment: 0, text },
    context(),
  );

const impact = (layers: Layer[]): TextLayer => {
  const layer = layers.find((l): l is TextLayer => l.type === 'text' && l.id === 'impact-text');
  if (!layer) throw new Error('missing impact-text');
  return layer;
};

const pct = (value: number | string | undefined): number =>
  typeof value === 'number' ? value : value ? parseFloat(value) : 0;

describe('fullBleedQuote swatch geometry', () => {
  const impactSize = themedFontSize(120, context(), true);

  it('renders a punchy line at the full impact size, boxed and centred', () => {
    const layer = impact(render(PUNCHY));
    expect(layer.content.style.fontSize).toBe(impactSize);
    expect(layer.position.anchor).toBe('top-left');
    expect(layer.position.x).toBe('7.5%');
    expect(layer.position.width).toBe('85%');
    expect(layer.content.style.textAlign).toBe('center');
    expect(layer.content.style.shrinkToFit).toBe(true);
    expect(layer.content.style.maxLines).toBeUndefined();
    const top = pct(layer.position.y);
    const height = pct(layer.position.height);
    expect(height).toBeGreaterThan(0);
    expect(Math.abs(top + height / 2 - 50)).toBeLessThan(1);
  });

  it('eases the size down as the text gets longer', () => {
    const punchy = impact(render(PUNCHY)).content.style.fontSize;
    const sentence = impact(render(SENTENCE)).content.style.fontSize;
    const paragraph = impact(render(PARAGRAPH)).content.style.fontSize;
    const long = impact(render(LONG)).content.style.fontSize;
    expect(sentence).toBeLessThan(punchy);
    expect(paragraph).toBeLessThan(sentence);
    expect(long).toBeLessThanOrEqual(paragraph);
  });

  it('fits a whole paragraph and a 180-word body inside the band without clamping', () => {
    for (const text of [SENTENCE, PARAGRAPH, LONG]) {
      const layer = impact(render(text));
      const top = pct(layer.position.y);
      const bottom = top + pct(layer.position.height);
      expect(top, text.slice(0, 20)).toBeGreaterThanOrEqual(10);
      expect(bottom, text.slice(0, 20)).toBeLessThanOrEqual(90);
      expect(layer.content.style.fontSize, text.slice(0, 20)).toBeGreaterThanOrEqual(28);
      expect(layer.content.style.maxLines, text.slice(0, 20)).toBeUndefined();
    }
  });

  it('clamps with maxLines at the floor for a pathological body, still inside the frame', () => {
    const absurd = Array.from({ length: 40 }, () => SENTENCE).join(' ');
    const layer = impact(render(absurd));
    expect(layer.content.style.maxLines).toBeGreaterThan(0);
    const bottom = pct(layer.position.y) + pct(layer.position.height);
    expect(bottom).toBeLessThanOrEqual(90);
  });

  it('never positions the text past the frame for any length', () => {
    for (let n = 1; n <= 12; n += 1) {
      const layer = impact(render(Array.from({ length: n }, () => SENTENCE).join(' ')));
      const top = pct(layer.position.y);
      const bottom = top + pct(layer.position.height);
      expect(top, `${n}×`).toBeGreaterThanOrEqual(0);
      expect(bottom, `${n}×`).toBeLessThanOrEqual(100);
    }
  });

  it('still renders text for an empty-ish input rather than a blank slide', () => {
    const layers = render('');
    expect(layers.some((l) => l.type === 'text')).toBe(true);
    expect(layers[0]?.type).toBe('shape');
  });
});
