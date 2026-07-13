import { describe, expect, it } from 'vitest';
import { DIAGRAM_LABEL_LINE_HEIGHT, fitDiagramLabel } from '../doc/utils/diagramText';

describe('fitDiagramLabel', () => {
  it('keeps a short single-line label at its preferred size', () => {
    expect(fitDiagramLabel('Web1', 180, 64, 22)).toMatchObject({
      fontSize: 22,
      lineCount: 1,
      firstLineOffset: 0,
    });
  });

  it('shrinks and centers a dense multi-line package label inside its card', () => {
    const fit = fitDiagramLabel(
      '@bendyline/molen-kernel\nheadless sim — no DOM, no thread\nWorker + Node',
      252,
      112,
      38,
    );

    expect(fit.fontSize).toBeLessThan(38);
    expect(fit.lineCount).toBeGreaterThanOrEqual(3);
    expect(fit.lineCount * fit.fontSize * DIAGRAM_LABEL_LINE_HEIGHT).toBeLessThanOrEqual(96);
    expect(fit.firstLineOffset).toBeLessThan(0);
  });
});
