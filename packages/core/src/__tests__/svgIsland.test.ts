/**
 * SVG island codec — the sanitizer is the only thing standing between an
 * author's markup and Office/EPUB SVG engines, so this file is mostly a
 * hostile corpus. Every accepted output must also be well-formed XML: it is
 * re-parsed as XML wherever it renders.
 */

import { describe, it, expect } from 'vitest';
import {
  SVG_ISLAND_LIMITS,
  isSvgIslandFence,
  isSvgIslandLang,
  parseSvgIsland,
  svgIslandDataUrl,
  svgIslandMarkup,
  type SvgIsland,
} from '../markdown/svgIsland.js';

function island(source: string, options?: { static?: boolean }): SvgIsland {
  const result = parseSvgIsland(source, options);
  if (!result.ok) throw new Error(`expected an island, got ${result.reason}: ${result.message}`);
  return result.island;
}

/** Parse as XML (the way an <img> or an Office engine reads it). */
function asXml(markup: string): Document {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
  return doc;
}

const FORBIDDEN_OUTPUT = [
  '<script',
  'onload',
  'onerror',
  'onclick',
  'onbegin',
  'javascript:',
  'foreignObject',
  'http://evil',
  'https://evil',
  '@import',
  '@font-face',
  'image-set',
  'xml:base',
  'foo:href',
  'data:image/svg',
  'data:text/html',
  '<!DOCTYPE',
  '<!--',
  '<iframe',
  '<img',
  'alert(',
];

function expectInert(markup: string): void {
  for (const needle of FORBIDDEN_OUTPUT) expect(markup).not.toContain(needle);
  asXml(markup);
}

describe('fence recognition', () => {
  it('matches only the svg language', () => {
    expect(isSvgIslandLang('svg')).toBe(true);
    expect(isSvgIslandLang(' SVG ')).toBe(true);
    expect(isSvgIslandLang('xml')).toBe(false);
    expect(isSvgIslandLang(undefined)).toBe(false);
    expect(isSvgIslandFence({ type: 'code', lang: 'svg', value: '' })).toBe(true);
    expect(isSvgIslandFence({ type: 'code', lang: 'html', value: '<svg/>' })).toBe(false);
  });
});

describe('well-formed input', () => {
  it('keeps SVG attribute case and hyphenation through the HTML parser', () => {
    const { markup } = island(
      '<svg viewBox="0 0 24 24"><linearGradient id="g" gradientUnits="userSpaceOnUse" gradientTransform="rotate(45)"><stop offset="0" stop-color="red" stop-opacity="0.5"/></linearGradient><path d="M0 0L24 24" stroke-width="2" stroke-dasharray="4, 2" stroke-linecap="round" fill="url(#g)" class="a b"/><text x="1" y="20" font-family="Inter, sans-serif" text-anchor="start" dominant-baseline="middle">A &amp; B &lt;3</text></svg>',
    );
    expect(markup).toContain('viewBox="0 0 24 24"');
    expect(markup).toContain('gradientUnits="userSpaceOnUse"');
    expect(markup).toContain('gradientTransform="rotate(45)"');
    expect(markup).toContain('<linearGradient');
    expect(markup).toContain('stroke-width="2"');
    expect(markup).toContain('stroke-dasharray="4 2"');
    expect(markup).toContain('stop-color="red"');
    expect(markup).toContain('class="a b"');
    expect(markup).toContain('text-anchor="start"');
    const doc = asXml(markup);
    expect(doc.documentElement.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(doc.getElementsByTagName('text')[0]!.textContent).toBe('A & B <3');
  });

  it('keeps local references, xlink included', () => {
    const { markup } = island(
      '<svg><defs><circle id="dot" r="2"/></defs><use xlink:href="#dot" x="5"/><use href="#dot" x="9"/><rect fill="url(#pattern)" clip-path="url( \'#clip\' )"/></svg>',
    );
    expect(markup).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
    expect(markup).toContain('xlink:href="#dot"');
    expect(markup).toContain('href="#dot"');
    expect(markup).toContain('fill="url(#pattern)"');
    expect(markup).toContain('clip-path="url( \'#clip\' )"');
    asXml(markup);
  });

  it('keeps raster data images and class-styled sheets', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    const { markup } = island(
      `<svg><style>.a { fill: #0af; } .b:hover { stroke: red }</style><image href="${png}" width="4" height="4"/><rect class="a"/></svg>`,
    );
    expect(markup).toContain(png);
    expect(markup).toContain('.a { fill: #0af; }');
    asXml(markup);
  });

  it('reads CDATA stylesheets', () => {
    const { markup } = island('<svg><style><![CDATA[ .a{fill:red} ]]></style></svg>');
    expect(markup).toContain('<style>.a{fill:red}</style>');
  });

  it('accepts an XML prolog, comments and a DOCTYPE with an internal subset', () => {
    const result = parseSvgIsland(
      '\uFEFF<?xml version="1.0" encoding="utf-8"?>\n<!-- Generator: Adobe Illustrator -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [\n  <!ENTITY ns_svg "http://www.w3.org/2000/svg">\n]>\n<svg xmlns="&ns_svg;" width="100pt" height="50pt"><rect width="10" height="10"/></svg>\n<!-- trailing -->\n',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.island.width).toBeCloseTo(133.333, 2);
    expect(result.island.height).toBeCloseTo(66.667, 2);
    expectInert(result.island.markup);
  });
});

describe('sizing', () => {
  it('derives size from the viewBox', () => {
    const result = island('<svg viewBox="0 0 400 100"/>');
    expect([result.width, result.height, result.aspectRatio]).toEqual([400, 100, 4]);
  });

  it('completes a single dimension from the viewBox ratio', () => {
    const result = island('<svg viewBox="0 0 200 100" width="50"/>');
    expect([result.width, result.height]).toEqual([50, 25]);
  });

  it('ignores relative lengths, falling back to the viewBox', () => {
    const result = island('<svg viewBox="0 0 30 10" width="100%" height="2em"/>');
    expect([result.width, result.height]).toEqual([30, 10]);
  });

  it('defaults to 300×150 and always writes width, height and viewBox', () => {
    const result = island('<svg><rect/></svg>');
    expect([result.width, result.height]).toEqual([300, 150]);
    expect(result.markup).toContain('width="300"');
    expect(result.markup).toContain('viewBox="0 0 300 150"');
  });
});

describe('title', () => {
  it('prefers aria-label, then the first <title>', () => {
    expect(island('<svg aria-label="Logo"><title>Ignored</title></svg>').title).toBe('Logo');
    expect(island('<svg><title> Sales\n chart </title></svg>').title).toBe('Sales chart');
    expect(island('<svg/>').title).toBeUndefined();
  });
});

describe('rejected input', () => {
  it.each([
    ['empty', '   \n'],
    ['not-svg', '<div>hi</div>'],
    ['not-svg', 'just text'],
    ['not-svg', '<svg></svg><svg></svg>'],
    ['not-svg', '<svg></svg> trailing prose'],
    ['not-svg', '<svg><p>breakout</p></svg>'],
    ['not-svg', '<svg><img src=x onerror=alert(1)></svg>'],
    ['not-svg', '<svg><font color="red">x</font></svg>'],
    ['not-svg', '<svg><style><b>x</b></style></svg>'],
  ])('%s: %j', (reason, source) => {
    const result = parseSvgIsland(source);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe(reason);
  });

  it('caps source size', () => {
    const big = `<svg>${'<rect/>'.repeat(SVG_ISLAND_LIMITS.maxSourceBytes / 6)}</svg>`;
    const result = parseSvgIsland(big);
    expect(result.ok === false && result.reason).toBe('too-large');
  });

  it('caps nesting depth without overflowing the stack', () => {
    const deep = `<svg>${'<g>'.repeat(5000)}${'</g>'.repeat(5000)}</svg>`;
    const result = parseSvgIsland(deep);
    expect(result.ok === false && result.reason).toBe('too-deep');
  });

  it('caps element count', () => {
    const many = `<svg>${'<g/>'.repeat(SVG_ISLAND_LIMITS.maxElements + 1)}</svg>`;
    const result = parseSvgIsland(many);
    expect(result.ok === false && result.reason).toBe('too-large');
  });

  it('caps <use> fan-out (a "billion laughs" of shapes)', () => {
    let defs =
      '<g id="l0"><rect/><rect/><rect/><rect/><rect/><rect/><rect/><rect/><rect/><rect/></g>';
    for (let i = 1; i <= 6; i++) {
      defs += `<g id="l${i}">${`<use href="#l${i - 1}"/>`.repeat(10)}</g>`;
    }
    const result = parseSvgIsland(`<svg><defs>${defs}</defs><use href="#l6"/></svg>`);
    expect(result.ok === false && result.reason).toBe('too-large');
  });

  it('rejects circular <use> references', () => {
    const result = parseSvgIsland('<svg><g id="a"><use href="#a"/></g></svg>');
    expect(result.ok === false && result.reason).toBe('too-large');
  });

  it('never throws on lone surrogates', () => {
    const result = parseSvgIsland('<svg><text>\uD800 broken</text></svg>');
    expect(result.ok).toBe(true);
    if (result.ok) asXml(result.island.markup);
  });
});

describe('hostile corpus', () => {
  const HOSTILE: Record<string, string> = {
    'event handlers': '<svg onload="alert(1)"><rect onclick="alert(1)" onbegin="alert(1)"/></svg>',
    script: '<svg><script>alert(1)</script><script href="https://evil/x.js"/></svg>',
    foreignObject:
      '<svg><foreignObject><iframe src="https://evil"></iframe><div onclick="alert(1)">x</div></foreignObject></svg>',
    'title integration point': '<svg><title><img src=x onerror=alert(1)>Hi</title></svg>',
    'desc integration point': '<svg><desc><iframe src="javascript:alert(1)"></iframe></desc></svg>',
    'javascript link': '<svg><a href="javascript:alert(1)"><rect/></a></svg>',
    'xlink javascript link': '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>',
    'external use': '<svg><use href="https://evil/sprite.svg#icon"/></svg>',
    'data use': '<svg><use href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=#x"/></svg>',
    'external image': '<svg><image href="https://evil/x.png"/></svg>',
    'svg image': '<svg><image href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="/></svg>',
    'html image': '<svg><image href="data:text/html;base64,PHNjcmlwdD4="/></svg>',
    'external feImage': '<svg><filter><feImage href="https://evil/x.png"/></filter></svg>',
    'animate href':
      '<svg><a><animate attributeName="href" values="javascript:alert(1)"/></a><animate attributeName="xlink:href" to="javascript:alert(1)"/></svg>',
    'set href': '<svg><set attributeName="HREF" to="javascript:alert(1)"/></svg>',
    'animate external url':
      '<svg><rect><set attributeName="fill" to="url(https://evil/x#p)"/></rect></svg>',
    'prefixed namespace href':
      '<svg xmlns:foo="http://www.w3.org/1999/xlink"><use foo:href="javascript:alert(1)"/></svg>',
    'xml base': '<svg xml:base="https://evil/"><use href="#a"/></svg>',
    'external url attribute': '<svg><rect fill="url(https://evil/x.svg#p)"/></svg>',
    'css escape':
      '<svg><rect fill="u\\72 l(https://evil/x)"/><rect style="fill: \\75 rl(https://evil)"/></svg>',
    'style import': '<svg><style>@import url("https://evil/x.css"); .a{fill:red}</style></svg>',
    'style font-face':
      '<svg><style>@font-face { font-family: x; src: url(https://evil/f.woff) }</style></svg>',
    'style image-set': '<svg><style>.a { fill: image-set("https://evil/x.png" 1x) }</style></svg>',
    'style comment smuggle': '<svg><style>.a { fill: u/**/rl(https://evil/x) }</style></svg>',
    'style attribute url': '<svg><rect style="fill:url(https://evil/x)"/></svg>',
    'style expression': '<svg><rect style="width: expression(alert(1))"/></svg>',
    'html breakout in style':
      '<svg><style></style><style>x</style><iframe src=javascript:alert(1)></svg>',
    comments: '<svg><!-- a -- b --><rect/></svg>',
  };

  it.each(Object.entries(HOSTILE))('%s', (_name, source) => {
    const result = parseSvgIsland(source);
    if (!result.ok) return; // Rejected outright is also inert.
    expectInert(result.island.markup);
  });

  it('keeps the harmless parts of a hostile island', () => {
    const result = parseSvgIsland(
      '<svg><style>@import url(https://evil/x.css); .ok { fill: red }</style><rect class="ok" onclick="alert(1)" width="3" height="3"/></svg>',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.island.markup).toContain('.ok { fill: red }');
    expect(result.island.markup).toContain('<rect class="ok" width="3" height="3"/>');
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'attribute', name: 'onclick' }),
        expect.objectContaining({ kind: 'style', name: 'style rule' }),
      ]),
    );
  });

  it('never copies author namespace declarations', () => {
    const { markup } = island(
      '<svg xmlns="http://evil/ns" xmlns:xlink="http://evil/xlink" xmlns:foo="bar"><rect/></svg>',
    );
    expect(markup).not.toContain('http://evil');
    expect(markup).not.toContain('xmlns:foo');
  });
});

describe('static rendering', () => {
  it('writes a frozen animation’s end value onto its target', () => {
    const { markup } = island(
      '<svg><rect opacity="0"><animate attributeName="opacity" from="0" to="1" dur="1s" fill="freeze"/></rect><circle r="1"><animate attributeName="r" values="1;4;9" dur="1s" fill="freeze"/></circle></svg>',
      { static: true },
    );
    expect(markup).toContain('<rect opacity="1"/>');
    expect(markup).toContain('<circle r="9"/>');
    expect(markup).not.toContain('animate');
  });

  it('drops non-frozen animation and CSS motion', () => {
    const { markup } = island(
      '<svg><rect><animateTransform attributeName="transform" type="rotate" to="360" repeatCount="indefinite"/></rect><style>.s { animation: spin 1s infinite; fill: red } @keyframes spin { to { transform: rotate(1turn) } }</style></svg>',
      { static: true },
    );
    expect(markup).not.toContain('animate');
    expect(markup).not.toContain('keyframes');
    expect(markup).not.toContain('animation');
    expect(markup).toContain('fill: red');
  });

  it('keeps animation when not static', () => {
    const { markup } = island(
      '<svg><rect><animate attributeName="opacity" values="0;1" dur="1s" repeatCount="indefinite"/></rect></svg>',
    );
    expect(markup).toContain('<animate attributeName="opacity"');
  });

  it('a frozen value must pass the same checks as an authored one', () => {
    const { markup } = island(
      '<svg><rect><set attributeName="fill" to="url(https://evil/x#p)" fill="freeze"/></rect></svg>',
      { static: true },
    );
    expect(markup).toContain('<rect/>');
  });
});

describe('markup and data URLs', () => {
  it('sets the surrounding color on the root unless the author did', () => {
    const icon = island('<svg viewBox="0 0 1 1"><rect fill="currentColor"/></svg>');
    expect(svgIslandMarkup(icon, { color: '#336699' })).toContain('color="#336699"');
    const authored = island('<svg color="red"><rect fill="currentColor"/></svg>');
    expect(svgIslandMarkup(authored, { color: '#336699' })).not.toContain('#336699');
  });

  it('can substitute currentColor for engines that do not resolve it', () => {
    const icon = island(
      '<svg><style>.a{stroke:currentColor}</style><rect fill="currentColor"/></svg>',
    );
    const markup = svgIslandMarkup(icon, { color: 'rgb(10, 20, 30)', replaceCurrentColor: true });
    expect(markup).not.toMatch(/currentcolor/i);
    expect(markup).toContain('fill="rgb(10, 20, 30)"');
    expect(markup).toContain('stroke:rgb(10, 20, 30)');
  });

  it('ignores a color that is not a plain CSS color', () => {
    const icon = island('<svg><rect fill="currentColor"/></svg>');
    expect(svgIslandMarkup(icon, { color: 'red" onload="alert(1)' })).toBe(icon.markup);
  });

  it('builds a base64 data URL that decodes back to the markup', () => {
    const icon = island('<svg><text>Größe ✓</text></svg>');
    const url = svgIslandDataUrl(icon);
    expect(url.startsWith('data:image/svg+xml;base64,')).toBe(true);
    const bytes = Uint8Array.from(atob(url.split(',')[1]!), (c) => c.charCodeAt(0));
    expect(new TextDecoder().decode(bytes)).toBe(icon.markup);
  });

  it('memoizes parses of the same source', () => {
    const source = '<svg viewBox="0 0 2 1"/>';
    expect(parseSvgIsland(source)).toBe(parseSvgIsland(source));
    expect(parseSvgIsland(source)).not.toBe(parseSvgIsland(source, { static: true }));
  });
});
