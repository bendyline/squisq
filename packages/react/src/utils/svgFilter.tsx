/**
 * svgFilter
 *
 * The SVG `<filter>` equivalent of a CSS `filter` function list, for engines
 * that cannot apply the CSS form where we need it. WebKit draws a filtered
 * `<img>` inside a `<foreignObject>` without the slide's scale (see
 * foreignObjectPaint.ts) and ignores CSS filter functions on SVG elements, so
 * a graded or blurred photo there is drawn as an SVG `<image>` with this
 * filter instead.
 *
 * Each function maps to its primitive from the Filter Effects spec, computed
 * in sRGB as CSS filters are. Functions this module does not know are
 * skipped, so an unknown grade degrades to an ungraded photo rather than a
 * broken one.
 */
import type { ReactElement } from 'react';

interface FilterFunction {
  name: string;
  value: number;
}

/** Parse `name(number[unit]) …` — the shape `cssFilterForTreatment` emits. */
export function parseCssFilter(filter: string): FilterFunction[] {
  const functions: FilterFunction[] = [];
  for (const match of filter.matchAll(/([a-z-]+)\(\s*(-?[\d.]+)(?:px|deg|%)?\s*\)/g)) {
    const value = Number(match[2]);
    if (Number.isFinite(value)) functions.push({ name: match[1]!, value });
  }
  return functions;
}

/** feColorMatrix values for CSS `sepia(amount)`. */
function sepiaMatrix(amount: number): string {
  const a = 1 - Math.min(1, Math.max(0, amount));
  const rows = [
    [0.393 + 0.607 * a, 0.769 - 0.769 * a, 0.189 - 0.189 * a],
    [0.349 - 0.349 * a, 0.686 + 0.314 * a, 0.168 - 0.168 * a],
    [0.272 - 0.272 * a, 0.534 - 0.534 * a, 0.131 + 0.869 * a],
  ];
  return [...rows.map((row) => [...row, 0, 0].join(' ')), '0 0 0 1 0'].join(' ');
}

function primitive(fn: FilterFunction, key: number): ReactElement | null {
  switch (fn.name) {
    case 'blur':
      return fn.value > 0 ? <feGaussianBlur key={key} stdDeviation={fn.value} /> : null;
    case 'grayscale':
      return (
        <feColorMatrix
          key={key}
          type="saturate"
          values={String(1 - Math.min(1, Math.max(0, fn.value)))}
        />
      );
    case 'saturate':
      return <feColorMatrix key={key} type="saturate" values={String(fn.value)} />;
    case 'hue-rotate':
      return <feColorMatrix key={key} type="hueRotate" values={String(fn.value)} />;
    case 'sepia':
      return <feColorMatrix key={key} type="matrix" values={sepiaMatrix(fn.value)} />;
    case 'contrast': {
      const intercept = 0.5 - 0.5 * fn.value;
      return (
        <feComponentTransfer key={key}>
          <feFuncR type="linear" slope={fn.value} intercept={intercept} />
          <feFuncG type="linear" slope={fn.value} intercept={intercept} />
          <feFuncB type="linear" slope={fn.value} intercept={intercept} />
        </feComponentTransfer>
      );
    }
    case 'brightness':
      return (
        <feComponentTransfer key={key}>
          <feFuncR type="linear" slope={fn.value} />
          <feFuncG type="linear" slope={fn.value} />
          <feFuncB type="linear" slope={fn.value} />
        </feComponentTransfer>
      );
    default:
      return null;
  }
}

/**
 * An SVG `<filter>` element (with `id`) applying `cssFilter`, or null when
 * the list has nothing this module can draw.
 */
export function svgFilterFromCss(id: string, cssFilter: string | undefined): ReactElement | null {
  if (!cssFilter) return null;
  const primitives = parseCssFilter(cssFilter)
    .map(primitive)
    .filter((element): element is ReactElement => element !== null);
  if (primitives.length === 0) return null;
  return (
    <filter id={id} colorInterpolationFilters="sRGB" x="-10%" y="-10%" width="120%" height="120%">
      {primitives}
    </filter>
  );
}
