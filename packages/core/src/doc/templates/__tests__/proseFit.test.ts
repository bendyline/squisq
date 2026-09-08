import { describe, expect, it } from 'vitest';
import { estimateProseLineCount, estimateWrappedLineCount, fitProse } from '../captionUtils.js';

const SENTENCE =
  'The waterfront redesign opened to the public in June, and weekend foot traffic doubled within a month.';

describe('estimateProseLineCount', () => {
  it('matches the single-line estimator for text without newlines', () => {
    expect(estimateProseLineCount(SENTENCE, 30, 800)).toBe(
      estimateWrappedLineCount(SENTENCE, 30, 800),
    );
  });

  it('counts every forced line break, unlike the whitespace-only estimator', () => {
    const nested = 'Survey the arterial\nCount vehicles at six points\nMap the tidal range';
    expect(estimateWrappedLineCount(nested, 30, 2000)).toBe(1);
    expect(estimateProseLineCount(nested, 30, 2000)).toBe(3);
  });
});

describe('fitProse', () => {
  const width = 900;
  const lineHeight = 1.5;

  it('keeps the base size when the text already fits', () => {
    const fit = fitProse({
      text: SENTENCE,
      baseFontSize: 30,
      minFontSize: 18,
      maxWidthPx: width,
      maxHeightPx: 400,
      lineHeight,
    });
    expect(fit.fontSize).toBe(30);
    expect(fit.maxLines).toBeUndefined();
    expect(fit.heightPx).toBeLessThanOrEqual(400);
  });

  it('steps the size down, re-wrapping, until the block fits the height', () => {
    const long = Array.from({ length: 6 }, () => SENTENCE).join(' ');
    const fit = fitProse({
      text: long,
      baseFontSize: 34,
      minFontSize: 18,
      maxWidthPx: width,
      maxHeightPx: 360,
      lineHeight,
    });
    expect(fit.fontSize).toBeLessThan(34);
    expect(fit.fontSize).toBeGreaterThanOrEqual(18);
    expect(fit.heightPx).toBeLessThanOrEqual(360);
    expect(fit.maxLines).toBeUndefined();
    // The size that fits is the largest candidate that does.
    const oneStepUp =
      estimateProseLineCount(long, fit.fontSize + 2, width) * (fit.fontSize + 2) * lineHeight;
    expect(oneStepUp).toBeGreaterThan(360);
  });

  it('stops at the readable floor and reports a line clamp instead of overflowing', () => {
    const absurd = Array.from({ length: 40 }, () => SENTENCE).join(' ');
    const fit = fitProse({
      text: absurd,
      baseFontSize: 34,
      minFontSize: 18,
      maxWidthPx: width,
      maxHeightPx: 300,
      lineHeight,
    });
    expect(fit.fontSize).toBe(18);
    expect(fit.maxLines).toBe(Math.floor(300 / (18 * lineHeight)));
    expect(fit.lines).toBe(fit.maxLines);
    expect(fit.heightPx).toBeLessThanOrEqual(300);
  });

  it('never grows above the base size and tolerates a floor above the base', () => {
    const fit = fitProse({
      text: 'Short.',
      baseFontSize: 20,
      minFontSize: 24,
      maxWidthPx: width,
      maxHeightPx: 100,
      lineHeight,
    });
    expect(fit.fontSize).toBe(20);
  });
});
