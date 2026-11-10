import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { markdownToDoc } from '@bendyline/squisq/doc';
import { docToPptx } from '../pptx/export';
import {
  customGeometryXml,
  isStraightLine,
  parseSvgPath,
  pathBounds,
  type PathSegment,
} from '../pptx/pathGeometry';
import { openPackage, getPartXml } from '../ooxml/reader';
import { NS_DRAWINGML, NS_PML } from '../ooxml/namespaces';

const round = (segments: PathSegment[]) =>
  segments.map((segment) =>
    Object.fromEntries(
      Object.entries(segment).map(([key, value]) => [
        key,
        typeof value === 'number' ? Math.round(value * 100) / 100 : value,
      ]),
    ),
  );

describe('parseSvgPath', () => {
  it('reduces relative commands and the H/V shorthands to absolute lines', () => {
    expect(parseSvgPath('M 10 10 h 20 v 30 l -5 -5 Z')).toEqual([
      { op: 'M', x: 10, y: 10 },
      { op: 'L', x: 30, y: 10 },
      { op: 'L', x: 30, y: 40 },
      { op: 'L', x: 25, y: 35 },
      { op: 'Z' },
    ]);
    // Coordinates after a move's first pair are lines, and a relative move
    // after a close starts from the subpath's first point.
    expect(parseSvgPath('M0 0 10 0 10 10z m 5 5 l 1 0')).toEqual([
      { op: 'M', x: 0, y: 0 },
      { op: 'L', x: 10, y: 0 },
      { op: 'L', x: 10, y: 10 },
      { op: 'Z' },
      { op: 'M', x: 5, y: 5 },
      { op: 'L', x: 6, y: 5 },
    ]);
  });

  it('keeps curves, reflecting the control point of the smooth forms', () => {
    expect(parseSvgPath('M 0 0 C 0 10 10 10 10 0 S 20 -10 20 0')).toEqual([
      { op: 'M', x: 0, y: 0 },
      { op: 'C', x1: 0, y1: 10, x2: 10, y2: 10, x: 10, y: 0 },
      { op: 'C', x1: 10, y1: -10, x2: 20, y2: -10, x: 20, y: 0 },
    ]);
    expect(parseSvgPath('M 0 0 Q 5 10 10 0 T 20 0')).toEqual([
      { op: 'M', x: 0, y: 0 },
      { op: 'Q', x1: 5, y1: 10, x: 10, y: 0 },
      { op: 'Q', x1: 15, y1: -10, x: 20, y: 0 },
    ]);
  });

  it('draws an arc as cubic curves that pass through the arc', () => {
    // A quarter circle of radius 100 about the origin, clockwise on screen.
    const quarter = parseSvgPath('M 100 0 A 100 100 0 0 1 0 100')!;
    expect(quarter).toHaveLength(2);
    const curve = quarter[1] as Extract<PathSegment, { op: 'C' }>;
    expect(round([curve])[0]).toMatchObject({ op: 'C', x: 0, y: 100, x1: 100, y2: 100 });
    // The curve's midpoint sits on the circle.
    const mid = {
      x: (100 + 3 * curve.x1 + 3 * curve.x2 + curve.x) / 8,
      y: (0 + 3 * curve.y1 + 3 * curve.y2 + curve.y) / 8,
    };
    expect(Math.hypot(mid.x, mid.y)).toBeCloseTo(100, 0);
    // More than a quarter turn splits into several curves; a full sweep the long way is three.
    expect(parseSvgPath('M 100 0 A 100 100 0 1 1 0 -100')).toHaveLength(4);
    // A zero radius is a straight line.
    expect(parseSvgPath('M 0 0 A 0 5 0 0 1 10 10')).toEqual([
      { op: 'M', x: 0, y: 0 },
      { op: 'L', x: 10, y: 10 },
    ]);
  });

  it('rejects data that is not a path', () => {
    expect(parseSvgPath('')).toBeNull();
    expect(parseSvgPath('L 10 10')).toBeNull();
    expect(parseSvgPath('M 10')).toBeNull();
    expect(parseSvgPath('M 0 0 X 5 5')).toBeNull();
  });
});

describe('custom geometry', () => {
  it('tells one straight stroke from a polyline', () => {
    expect(isStraightLine(parseSvgPath('M 0 0 L 50 50 L 100 100')!)).toBe(true);
    expect(isStraightLine(parseSvgPath('M 0 0 L 50 0 L 50 50')!)).toBe(false);
    expect(isStraightLine(parseSvgPath('M 0 0 L 50 0 Z')!)).toBe(false);
  });

  it('writes a path in its own bounds, open strokes unfilled', () => {
    const segments = parseSvgPath('M 100 200 L 300 200 L 200 400 Z')!;
    const bounds = pathBounds(segments)!;
    expect(bounds).toEqual({ x: 100, y: 200, width: 200, height: 200 });
    const xml = customGeometryXml(segments, bounds, 10, true);
    expect(xml).toContain('<a:path w="2000" h="2000">');
    expect(xml).toContain('<a:moveTo><a:pt x="0" y="0"/></a:moveTo>');
    expect(xml).toContain('<a:lnTo><a:pt x="1000" y="2000"/></a:lnTo>');
    expect(xml).toContain('<a:close/>');
    expect(customGeometryXml(segments, bounds, 10, false)).toContain('fill="none"');
  });
});

describe('docToPptx path layers', () => {
  async function slide(markdown: string) {
    const doc = markdownToDoc(parseMarkdown(markdown), {
      articleId: 'paths',
      generateCoverBlock: false,
    });
    const pkg = await openPackage(await docToPptx(doc, { includeCoverSlide: false }));
    const xml = await getPartXml(pkg, 'ppt/slides/slide1.xml');
    if (!xml) throw new Error('the deck has no first slide');
    return xml;
  }
  const shapes = (xml: Document) => Array.from(xml.getElementsByTagNameNS(NS_PML, 'sp'));
  const named = (xml: Document, pattern: RegExp) =>
    shapes(xml).filter((shape) =>
      pattern.test(shape.getElementsByTagNameNS(NS_PML, 'cNvPr')[0]?.getAttribute('name') ?? ''),
    );
  const geometry = (shape: Element) =>
    shape.getElementsByTagNameNS(NS_DRAWINGML, 'custGeom')[0] ??
    shape.getElementsByTagNameNS(NS_DRAWINGML, 'prstGeom')[0];

  it('draws a pie chart’s wedges as filled shapes, not as spokes', async () => {
    const xml = await slide(
      [
        '## Share {[pieChart]}',
        '',
        '| Kind | Share |',
        '| --- | ---: |',
        '| A | 60 |',
        '| B | 40 |',
      ].join('\n'),
    );
    const curved = shapes(xml).filter(
      (shape) => shape.getElementsByTagNameNS(NS_DRAWINGML, 'cubicBezTo').length > 0,
    );
    expect(curved.length).toBeGreaterThanOrEqual(2);
    for (const wedge of curved) {
      expect(wedge.getElementsByTagNameNS(NS_DRAWINGML, 'solidFill').length).toBeGreaterThan(0);
      expect(wedge.getElementsByTagNameNS(NS_DRAWINGML, 'close')).toHaveLength(1);
    }
  });

  it('draws a pyramid’s tiers as closed shapes and its callouts as lines', async () => {
    const xml = await slide(
      [
        '## Who decides {[pyramid]}',
        '',
        '- Board: direction',
        '- Managers: plans',
        '- Teams: work',
      ].join('\n'),
    );
    const tiers = named(xml, /^tier-\d$/u);
    expect(tiers).toHaveLength(3);
    for (const tier of tiers) {
      expect(geometry(tier)?.localName).toBe('custGeom');
      expect(tier.getElementsByTagNameNS(NS_DRAWINGML, 'lnTo').length).toBeGreaterThanOrEqual(2);
    }
    const callouts = named(xml, /^tier-\d-callout$/u);
    expect(callouts).toHaveLength(3);
    for (const callout of callouts) expect(geometry(callout)?.getAttribute('prst')).toBe('line');
  });

  it('draws a cycle’s arrows as arcs that keep their arrowheads', async () => {
    const xml = await slide(
      ['## The water cycle {[cycle]}', '', '- Evaporation', '- Condensation', '- Rain'].join('\n'),
    );
    const arcs = named(xml, /arrow$/u);
    expect(arcs).toHaveLength(3);
    for (const arc of arcs) {
      expect(arc.getElementsByTagNameNS(NS_DRAWINGML, 'cubicBezTo').length).toBeGreaterThan(0);
      expect(arc.getElementsByTagNameNS(NS_DRAWINGML, 'path')[0]?.getAttribute('fill')).toBe(
        'none',
      );
      expect(arc.getElementsByTagNameNS(NS_DRAWINGML, 'tailEnd')).toHaveLength(1);
    }
  });

  it('gives a rounded card its authored corner radius', async () => {
    const xml = await slide(
      ['## Kinds {[cards]}', '', '- Live: weakened', '- Inactivated: killed'].join('\n'),
    );
    const card = named(xml, /^card-0$/u)[0]!;
    const adjust = card.getElementsByTagNameNS(NS_DRAWINGML, 'gd')[0];
    expect(geometry(card)?.getAttribute('prst')).toBe('roundRect');
    expect(adjust?.getAttribute('name')).toBe('adj');
    // Six percent of the shorter side, far from PowerPoint's default 16.667%.
    expect(Number(adjust?.getAttribute('fmla')?.replace('val ', ''))).toBeLessThan(8000);
  });
});
