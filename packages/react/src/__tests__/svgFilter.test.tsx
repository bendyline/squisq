import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { cssFilterForTreatment } from '@bendyline/squisq/doc';
import { parseCssFilter, svgFilterFromCss } from '../utils/svgFilter';

function renderFilter(css: string | undefined) {
  const filter = svgFilterFromCss('grade', css);
  const { container } = render(<svg>{filter && <defs>{filter}</defs>}</svg>);
  return container.querySelector('filter');
}

describe('svgFilterFromCss', () => {
  it('parses the function list a treatment emits', () => {
    expect(parseCssFilter('blur(6px) saturate(0.85) hue-rotate(-7deg) contrast(1.04)')).toEqual([
      { name: 'blur', value: 6 },
      { name: 'saturate', value: 0.85 },
      { name: 'hue-rotate', value: -7 },
      { name: 'contrast', value: 1.04 },
    ]);
  });

  it('draws every function of every treatment, in order, in sRGB', () => {
    for (const type of ['mono', 'duotone', 'warm', 'cool'] as const) {
      const css = cssFilterForTreatment({ type, strength: 0.6 }, 3)!;
      const filter = renderFilter(css)!;
      expect(filter.getAttribute('color-interpolation-filters'), type).toBe('sRGB');
      expect(filter.children, type).toHaveLength(parseCssFilter(css).length);
    }
  });

  it('maps contrast to a linear transfer about mid-grey', () => {
    const funcR = renderFilter('contrast(1.5)')!.querySelector('feFuncR')!;
    expect(funcR.getAttribute('slope')).toBe('1.5');
    expect(funcR.getAttribute('intercept')).toBe('-0.25');
  });

  it('draws nothing for an empty or unknown list', () => {
    expect(renderFilter(undefined)).toBeNull();
    expect(renderFilter('drop-shadow(2px)')).toBeNull();
  });
});
