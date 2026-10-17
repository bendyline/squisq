/**
 * SVG islands in React: a ```svg fence renders as an image of core's
 * sanitized markup — in markdown (read view, Page mode) and as an `svg` layer
 * on slides — never as inline author markup.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import type { Block } from '@bendyline/squisq/schemas';
import { MarkdownRenderer } from '../MarkdownRenderer';
import { BlockRenderer } from '../BlockRenderer';
import { SvgIslandImage } from '../svgIsland/SvgIslandImage';
import { decodeSvgImages } from '../utils/decodeSvgImages';

const ICON =
  '<svg viewBox="0 0 24 12"><title>Badge</title><rect width="24" height="12" fill="currentColor"/></svg>';
const HOSTILE = '<svg onload="alert(1)"><script>alert(1)</script><circle r="2"/></svg>';
const ANIMATED =
  '<svg viewBox="0 0 10 10"><rect width="10" height="10" opacity="0"><animate attributeName="opacity" to="1" dur="1s" fill="freeze"/></rect></svg>';

function decode(src: string | null | undefined): string {
  expect(src).toMatch(/^data:image\/svg\+xml;base64,/);
  const base64 = src!.slice(src!.indexOf(',') + 1);
  return new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
}

describe('svg fences in markdown', () => {
  it('render as an image of the sanitized markup, not inline SVG or code', () => {
    const nodes = parseMarkdown(`\`\`\`svg\n${HOSTILE}\n\`\`\``).children;
    const { container } = render(<MarkdownRenderer nodes={nodes} />);
    const img = container.querySelector('figure.squisq-md-svg > img');
    expect(img).not.toBeNull();
    expect(container.querySelector('pre')).toBeNull();
    expect(container.querySelector('figure svg, script')).toBeNull();
    const markup = decode(img!.getAttribute('src'));
    expect(markup).toContain('<circle r="2"/>');
    expect(markup).not.toContain('script');
    expect(markup).not.toContain('onload');
  });

  it('take their alt text and intrinsic size from the island', () => {
    const nodes = parseMarkdown(`\`\`\`svg\n${ICON}\n\`\`\``).children;
    const { container } = render(<MarkdownRenderer nodes={nodes} />);
    const img = container.querySelector('img')!;
    expect(img.getAttribute('alt')).toBe('Badge');
    expect(img.getAttribute('width')).toBe('24');
    expect(img.getAttribute('height')).toBe('12');
  });

  it('fall back to the code block, with a note, when the markup is not an island', () => {
    const nodes = parseMarkdown('```svg\n<div>nope</div>\n```').children;
    const { container } = render(<MarkdownRenderer nodes={nodes} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.squisq-md-svg-error-note')?.textContent).toContain(
      'Couldn’t render this SVG',
    );
    expect(container.querySelector('pre.squisq-md-code-block')?.textContent).toContain('nope');
  });

  it('leave xml fences as code', () => {
    const nodes = parseMarkdown(`\`\`\`xml\n${ICON}\n\`\`\``).children;
    const { container } = render(<MarkdownRenderer nodes={nodes} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('pre.squisq-md-code-block')).not.toBeNull();
  });

  it('yield to a host renderer registered for svg', () => {
    const nodes = parseMarkdown(`\`\`\`svg\n${ICON}\n\`\`\``).children;
    const { container } = render(
      <MarkdownRenderer nodes={nodes} fenceRenderers={{ svg: () => <b>host</b> }} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('host');
  });
});

describe('SvgIslandImage', () => {
  it('colors currentColor with the surrounding text color', () => {
    const { container } = render(
      <div style={{ color: 'rgb(1, 2, 3)' }}>
        <SvgIslandImage source={ICON} />
      </div>,
    );
    expect(decode(container.querySelector('img')!.getAttribute('src'))).toContain(
      'color="rgb(1, 2, 3)"',
    );
  });

  it('draws a still on request', () => {
    const { container } = render(<SvgIslandImage source={ANIMATED} isStatic />);
    const markup = decode(container.querySelector('img')!.getAttribute('src'));
    expect(markup).not.toContain('animate');
    expect(markup).toContain('opacity="1"');
  });
});

describe('svg layers on slides', () => {
  const block = (source: string): Block => ({
    id: 'slide',
    startTime: 0,
    duration: 5,
    audioSegment: 0,
    layers: [
      {
        type: 'svg',
        id: 'island',
        content: { source, color: '#abcdef' },
        position: { x: 100, y: 50, width: 400, height: 200 },
      },
    ],
  });

  it('draw an SVG <image> of the sanitized, colored markup', () => {
    const { container } = render(<BlockRenderer block={block(ICON)} blockTime={0} basePath="/" />);
    const image = container.querySelector('.block-layer--svg image');
    expect(image).not.toBeNull();
    expect(image!.getAttribute('aria-label')).toBe('Badge');
    expect(image!.getAttribute('width')).toBe('400');
    expect(decode(image!.getAttribute('href'))).toContain('color="#abcdef"');
  });

  it('draw a still for capture', () => {
    const { container } = render(
      <BlockRenderer block={block(ANIMATED)} blockTime={0} basePath="/" staticMedia />,
    );
    const markup = decode(container.querySelector('.block-layer--svg image')!.getAttribute('href'));
    expect(markup).not.toContain('animate');
  });

  it('keep animation in interactive playback', () => {
    const { container } = render(
      <BlockRenderer block={block(ANIMATED)} blockTime={0} basePath="/" />,
    );
    const markup = decode(container.querySelector('.block-layer--svg image')!.getAttribute('href'));
    expect(markup).toContain('<animate');
  });

  it('say so when the source is not an island', () => {
    const { container } = render(
      <BlockRenderer block={block('<div>nope</div>')} blockTime={0} basePath="/" />,
    );
    expect(container.querySelector('.block-layer--svg image')).toBeNull();
    expect(container.querySelector('.block-layer--svg')?.textContent).toContain(
      'Couldn’t render this SVG',
    );
  });
});

describe('decodeSvgImages', () => {
  it('resolves for data and blob hrefs and ignores remote ones', async () => {
    const { container } = render(
      <svg>
        <image href="data:image/png;base64,iVBORw0KGgo=" />
        <image href="https://example.com/x.png" />
      </svg>,
    );
    await expect(decodeSvgImages(container)).resolves.toBeUndefined();
  });
});
