import { describe, expect, it } from 'vitest';
import type { Block, ImageLayer, Layer, ShapeLayer, TextLayer } from '@bendyline/squisq/schemas';
import { compositeBackdrop, planDeckBackdrops, splitSlideBackdrop } from '../pptx/backdrop';
import { cssGradientFillXml, parseCssGradient } from '../pptx/cssPaint';
import { photoBackgroundXml } from '../pptx/masters';

const FULL = { x: 0, y: 0, width: '100%', height: '100%' } as const;

function paint(id: string, content: Partial<ShapeLayer['content']>): ShapeLayer {
  return { id, type: 'shape', position: FULL, content: { shape: 'rect', ...content } };
}

function text(id: string): TextLayer {
  return {
    id,
    type: 'text',
    position: { x: '8%', y: '9%', width: '84%', height: '10%' },
    content: { text: id, style: { fontSize: 40, color: '#ffffff' } },
  };
}

function photo(id: string, fit: 'cover' | 'contain' = 'cover'): ImageLayer {
  return { id, type: 'image', position: FULL, content: { src: `${id}.png`, alt: id, fit } };
}

function block(id: string, template: string | undefined, layers: Layer[]): Block {
  return { id, template, startTime: 0, duration: 5, audioSegment: 0, layers } as Block;
}

describe('parseCssGradient', () => {
  it('reads angles, side keywords and fills in stop positions like CSS', () => {
    const linear = parseCssGradient('linear-gradient(155deg, #2b2420 0%, #1f1a17 100%)');
    expect(linear).toMatchObject({ kind: 'linear', angle: 155 });
    expect(parseCssGradient('linear-gradient(to right, red, blue)')).toMatchObject({ angle: 90 });
    const spread = parseCssGradient('linear-gradient(#000, #111, #222, #333 90%)');
    expect(spread?.stops.map((stop) => stop.position)).toEqual([0, 0.3, 0.6, 0.9]);
  });

  it('reads a positioned radial and fades transparent stops without darkening', () => {
    const radial = parseCssGradient(
      'radial-gradient(ellipse at 50% 40%, rgba(176, 114, 76, 0.32) 0%, transparent 75%)',
    );
    expect(radial).toMatchObject({ kind: 'radial', centerX: 0.5, centerY: 0.4 });
    // `transparent` borrows its neighbour's hue: CSS fades premultiplied.
    expect(radial?.stops[1]?.color).toEqual({ hex: 'B0724C', alpha: 0 });
  });

  it('rejects values that are not gradients', () => {
    expect(parseCssGradient('#ffffff')).toBeNull();
    expect(parseCssGradient('linear-gradient(90deg, #fff)')).toBeNull();
  });
});

describe('cssGradientFillXml', () => {
  it('measures linear angles from the right, as DrawingML does', () => {
    // CSS 155deg (down and to the right) is DrawingML 65deg.
    const xml = cssGradientFillXml(parseCssGradient('linear-gradient(155deg, #000, #fff)')!);
    expect(xml).toContain('<a:lin ang="3900000" scaled="0"/>');
  });

  it('draws radials as a circle path focused on the CSS centre', () => {
    const xml = cssGradientFillXml(
      parseCssGradient('radial-gradient(ellipse at 50% 40%, #000 0%, #fff 100%)')!,
    );
    expect(xml).toContain('<a:path path="circle">');
    expect(xml).toContain('<a:fillToRect l="50000" t="40000" r="50000" b="60000"/>');
  });
});

describe('splitSlideBackdrop', () => {
  it('drops paint hidden under the topmost opaque fill', () => {
    const hidden = paint('persistent-bg-gradient', { fill: 'linear-gradient(#000, #111)' });
    const bg = paint('bg', { fill: '#1f1a17' });
    const split = splitSlideBackdrop([hidden, bg, text('title')]);
    expect(split.base?.id).toBe('bg');
    expect(split.overlays).toEqual([]);
    expect(split.content.map((layer) => layer.id)).toEqual(['title']);
  });

  it('moves full-bleed atmosphere drawn over the content under it', () => {
    const photoBase = photo('bg-image');
    const vignette = paint('persistent-vignette', {
      fill: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,0.35) 100%)',
    });
    const split = splitSlideBackdrop([photoBase, text('title'), vignette]);
    expect(split.base?.id).toBe('bg-image');
    expect(split.overlays.map((layer) => layer.id)).toEqual(['persistent-vignette']);
    expect(split.content.map((layer) => layer.id)).toEqual(['title']);
  });

  it('drops film grain, which DrawingML cannot draw', () => {
    const grain = paint('persistent-grain', {
      fill: '#000000',
      filter: { type: 'noise', opacity: 0.04 },
    });
    const split = splitSlideBackdrop([paint('bg', { fill: '#222' }), text('t'), grain]);
    expect(split.overlays).toEqual([]);
    expect(split.base?.id).toBe('bg');
  });

  it('keeps a letterboxed image and partial shapes as slide content', () => {
    const split = splitSlideBackdrop([
      paint('bg', { fill: '#fff' }),
      photo('figure', 'contain'),
      {
        ...paint('band', { fill: '#000' }),
        position: { x: 0, y: 0, width: '100%', height: '20%' },
      },
    ]);
    expect(split.content.map((layer) => layer.id)).toEqual(['figure', 'band']);
  });
});

describe('compositeBackdrop', () => {
  it('flattens a radial tint over a solid base into one opaque radial', () => {
    const base = paint('bg', { fill: '#1f1a17' });
    const tint = paint('bg-tint', {
      fill: 'radial-gradient(ellipse at 50% 40%, rgba(176, 114, 76, 0.32) 0%, transparent 75%)',
    });
    const flat = compositeBackdrop(base, [tint]);
    const gradient = parseCssGradient(flat!.content.fill!);
    expect(gradient).toMatchObject({ kind: 'radial', centerX: 0.5, centerY: 0.4 });
    // 32% copper over the base at the centre, the bare base where it fades out.
    expect(gradient!.stops.map((stop) => [stop.color.hex, stop.color.alpha])).toEqual([
      ['4D3628', 100000],
      ['1F1A17', 100000],
    ]);
  });

  it('flattens a pattern over a solid base into a ground and an ink', () => {
    const flat = compositeBackdrop(paint('bg', { fill: '#000000' }), [
      paint('persistent-bg-pattern', {
        pattern: { kind: 'grid', color: '#ffffff', size: 36, opacity: 0.5 },
      }),
    ]);
    expect(flat?.content.fill).toBe('#000000');
    expect(flat?.content.pattern).toMatchObject({ kind: 'grid', color: '#808080', opacity: 1 });
  });

  it('leaves two differently shaped gradients apart', () => {
    const base = paint('bg', { fill: '#000' });
    const one = paint('a', {
      fill: 'radial-gradient(ellipse at 20% 20%, rgba(255,0,0,0.5), transparent)',
    });
    const two = paint('b', { fill: 'linear-gradient(90deg, rgba(0,0,255,0.5), transparent)' });
    expect(compositeBackdrop(base, [one, two])).toBeNull();
  });
});

describe('planDeckBackdrops', () => {
  it('gives the master the common base, one layout per template look, slides only content', () => {
    const solid = () => paint('bg', { fill: '#1f1a17' });
    const plan = planDeckBackdrops([
      block('a', 'title', [
        solid(),
        paint('bg-tint', { fill: 'radial-gradient(rgba(255,255,255,0.2), transparent)' }),
        text('title'),
      ]),
      block('b', 'content', [solid(), text('body')]),
      block('c', 'content', [solid(), text('body')]),
      block('d', 'list', [
        paint('bg', { fill: 'linear-gradient(155deg, #2b2420, #1f1a17)' }),
        text('items'),
      ]),
    ]);

    expect(plan.master.base?.content.fill).toBe('#1f1a17');
    expect(plan.layouts.map((layout) => layout.name)).toEqual(['Title', 'Content', 'List']);
    // Content inherits the master; Title and List carry their own backgrounds.
    expect(plan.layouts.map((layout) => !!layout.base)).toEqual([true, false, true]);
    expect(plan.layouts.every((layout) => layout.overlays.length === 0)).toBe(true);
    expect(plan.slides.map((slide) => slide.layout)).toEqual([0, 1, 1, 2]);
    expect(plan.slides.every((slide) => slide.base === null)).toBe(true);
    expect(plan.slides.map((slide) => slide.content.map((layer) => layer.id))).toEqual([
      ['title'],
      ['body'],
      ['body'],
      ['items'],
    ]);
  });

  it("keeps each slide's photo as its own background under a shared layout", () => {
    const scrim = () => paint('scrim', { fill: 'linear-gradient(transparent, rgba(0,0,0,0.6))' });
    const plan = planDeckBackdrops([
      block('a', 'imageWithCaption', [photo('one'), scrim(), text('caption')]),
      block('b', 'imageWithCaption', [photo('two'), scrim(), text('caption')]),
    ]);
    expect(plan.layouts).toHaveLength(1);
    expect(plan.layouts[0]!.overlays.map((layer) => layer.id)).toEqual(['scrim']);
    expect(plan.slides.map((slide) => (slide.base as ImageLayer).content.src)).toEqual([
      'one.png',
      'two.png',
    ]);
  });

  it('puts theme atmosphere every slide shares on the master', () => {
    const vignette = () =>
      paint('persistent-vignette', {
        fill: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,0.35) 100%)',
      });
    const scrim = () => paint('scrim', { fill: 'linear-gradient(transparent, rgba(0,0,0,0.6))' });
    const plan = planDeckBackdrops([
      block('a', 'imageWithCaption', [photo('one'), scrim(), text('caption'), vignette()]),
      block('b', 'fullBleedQuote', [photo('two'), text('quote'), vignette()]),
    ]);
    expect(plan.master.overlays.map((layer) => layer.id)).toEqual(['persistent-vignette']);
    expect(plan.layouts.map((layout) => layout.overlays.map((layer) => layer.id))).toEqual([
      ['scrim'],
      [],
    ]);
  });

  it('keeps shared atmosphere on the master while each layout composites its own tint', () => {
    const grid = () =>
      paint('persistent-bg-pattern', {
        pattern: { kind: 'grid', color: '#00e5ff', size: 36, opacity: 0.04 },
      });
    const plan = planDeckBackdrops([
      block('a', 'title', [
        paint('bg', { fill: '#0a0a0a' }),
        paint('bg-tint', { fill: 'radial-gradient(rgba(0,229,255,0.2), transparent 70%)' }),
        text('title'),
        grid(),
      ]),
      block('b', 'content', [paint('bg', { fill: '#0a0a0a' }), text('body'), grid()]),
    ]);
    // One pattern shape, on the master, drawn over every layout's background.
    expect(plan.master.overlays.map((layer) => layer.id)).toEqual(['persistent-bg-pattern']);
    expect(plan.master.base?.content.fill).toBe('#0a0a0a');
    // The title's tint flattened into its layout's own radial background.
    expect(plan.layouts[0]!.overlays).toEqual([]);
    expect(plan.layouts[0]!.base?.content.fill).toContain('radial-gradient');
    expect(plan.layouts[1]!.base).toBeNull();
  });

  it('bakes shared atmosphere into the master background when nothing overrides it', () => {
    const grid = () =>
      paint('persistent-bg-pattern', {
        pattern: { kind: 'grid', color: '#ffffff', size: 36, opacity: 0.5 },
      });
    const plan = planDeckBackdrops([
      block('a', 'content', [paint('bg', { fill: '#000000' }), text('one'), grid()]),
      block('b', 'content', [paint('bg', { fill: '#000000' }), text('two'), grid()]),
    ]);
    expect(plan.master.overlays).toEqual([]);
    expect(plan.master.base?.content).toMatchObject({
      fill: '#000000',
      pattern: { kind: 'grid', color: '#808080' },
    });
  });

  it('gives the master the plain colour when it ties with a gradient', () => {
    const plan = planDeckBackdrops([
      block('a', 'title', [
        paint('bg', { fill: 'radial-gradient(#4d3628, #1f1a17 75%)' }),
        text('title'),
      ]),
      block('b', 'content', [paint('bg', { fill: '#1f1a17' }), text('body')]),
    ]);
    expect(plan.master.base?.content.fill).toBe('#1f1a17');
    expect(plan.layouts[0]!.base?.content.fill).toContain('radial-gradient');
  });

  it('numbers layouts that share a template but not a look', () => {
    const plan = planDeckBackdrops([
      block('a', 'content', [paint('bg', { fill: '#000' }), text('t')]),
      block('b', 'content', [
        paint('bg', { fill: '#000' }),
        paint('band', { pattern: { kind: 'dots', color: '#fff', opacity: 0.1 } }),
        paint('extra', { fill: 'linear-gradient(rgba(255,0,0,0.2), transparent)' }),
        text('t'),
      ]),
    ]);
    expect(plan.layouts.map((layout) => layout.name)).toEqual(['Content', 'Content 2']);
  });
});

describe('photoBackgroundXml', () => {
  /** A PNG header just long enough for `readImageDimensions`. */
  function pngOfSize(width: number, height: number): Uint8Array {
    const bytes = new Uint8Array(24);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    new DataView(bytes.buffer).setUint32(16, width);
    new DataView(bytes.buffer).setUint32(20, height);
    return bytes;
  }

  it('crops a cover photo to the slide like CSS, centred on the overflowing axis', () => {
    // A square photo on a 16:9 slide trims 1 − 9/16 of its height, half each side.
    const square = photoBackgroundXml('rId2', photo('p'), pngOfSize(1000, 1000));
    expect(square).toContain('<a:srcRect t="21875" b="21875"/>');
    const wide = photoBackgroundXml('rId2', photo('p'), pngOfSize(3200, 900));
    // A 32:9 panorama keeps half its width: a quarter trimmed from each side.
    expect(wide).toContain('<a:srcRect l="25000" r="25000"/>');
  });

  it('stretches a fill photo and leaves an exact 16:9 photo uncropped', () => {
    expect(
      photoBackgroundXml(
        'rId2',
        { ...photo('p'), content: { ...photo('p').content, fit: 'fill' } },
        pngOfSize(1000, 1000),
      ),
    ).not.toContain('srcRect');
    expect(photoBackgroundXml('rId2', photo('p'), pngOfSize(1920, 1080))).not.toContain('srcRect');
  });
});
