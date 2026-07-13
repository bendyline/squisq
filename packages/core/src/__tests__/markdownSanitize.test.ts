import { describe, expect, it } from 'vitest';
import { parseHtmlToNodes, sanitizeHtmlNodes, sanitizeUrl } from '../markdown/index';
import type { HtmlElement, HtmlNode } from '../markdown/index';

function elements(nodes: HtmlNode[]): HtmlElement[] {
  return nodes.filter((node): node is HtmlElement => node.type === 'htmlElement');
}

describe('markdown HTML sanitization', () => {
  it('allows safe link URLs and rejects executable schemes', () => {
    expect(sanitizeUrl('https://example.com', 'link')).toBe('https://example.com');
    expect(sanitizeUrl('/docs/page.html#intro', 'link')).toBe('/docs/page.html#intro');
    expect(sanitizeUrl('mailto:me@example.com', 'link')).toBe('mailto:me@example.com');
    expect(sanitizeUrl('tel:+15551234567', 'link')).toBe('tel:+15551234567');
    expect(sanitizeUrl('javascript:alert(1)', 'link')).toBeNull();
    expect(sanitizeUrl('java\nscript:alert(1)', 'link')).toBeNull();
    expect(sanitizeUrl('data:text/html,<script>alert(1)</script>', 'link')).toBeNull();
  });

  it('extraLinkSchemes allows host-app schemes but never executable ones', () => {
    expect(sanitizeUrl('workspace-nav:src%2Fa.ts', 'link')).toBeNull();
    expect(
      sanitizeUrl('workspace-nav:src%2Fa.ts', 'link', { extraLinkSchemes: ['workspace-nav'] }),
    ).toBe('workspace-nav:src%2Fa.ts');
    expect(
      sanitizeUrl('javascript:alert(1)', 'link', { extraLinkSchemes: ['javascript'] }),
    ).toBeNull();
    expect(sanitizeUrl('data:text/html,x', 'link', { extraLinkSchemes: ['data'] })).toBeNull();
    // media URLs ignore the option entirely
    expect(
      sanitizeUrl('workspace-nav:src%2Fa.ts', 'media', {
        extraLinkSchemes: ['workspace-nav'],
      }),
    ).toBeNull();
  });

  it('allows Squisq media URLs without allowing SVG or HTML data payloads', () => {
    expect(sanitizeUrl('blob:http://localhost/abc', 'media')).toBe('blob:http://localhost/abc');
    expect(sanitizeUrl('data:image/png;base64,AAA', 'media')).toBe('data:image/png;base64,AAA');
    expect(sanitizeUrl('data:audio/webm;base64,AAA', 'media')).toBe('data:audio/webm;base64,AAA');
    expect(sanitizeUrl('data:image/svg+xml;base64,AAA', 'media')).toBeNull();
    expect(sanitizeUrl('data:text/html,<script>alert(1)</script>', 'media')).toBeNull();
  });

  it('removes dangerous tags and event handler attributes', () => {
    const safe = sanitizeHtmlNodes(
      parseHtmlToNodes('<div onclick="alert(1)">ok<script>alert(1)</script></div>'),
    );
    const [div] = elements(safe);

    expect(div.tagName).toBe('div');
    expect(div.attributes.onclick).toBeUndefined();
    expect(div.children).toEqual([{ type: 'htmlText', value: 'ok' }]);
  });

  it('sanitizes link and image attributes inside raw HTML', () => {
    const safe = sanitizeHtmlNodes(
      parseHtmlToNodes(
        '<a href="javascript:alert(1)" target="_blank">bad</a><img src="x.jpg" onerror="alert(1)" width="300">',
      ),
    );
    const [link, image] = elements(safe);

    expect(link.tagName).toBe('a');
    expect(link.attributes.href).toBeUndefined();
    expect(link.attributes.target).toBe('_blank');
    expect(link.attributes.rel).toBe('noopener noreferrer');
    expect(image.tagName).toBe('img');
    expect(image.attributes.src).toBe('x.jpg');
    expect(image.attributes.onerror).toBeUndefined();
    expect(image.attributes.width).toBe('300');
  });

  it('unwraps unknown harmless containers while keeping their safe children', () => {
    const safe = sanitizeHtmlNodes(parseHtmlToNodes('<custom><strong>kept</strong></custom>'));
    const [strong] = elements(safe);

    expect(strong.tagName).toBe('strong');
    expect(strong.children).toEqual([{ type: 'htmlText', value: 'kept' }]);
  });
});
