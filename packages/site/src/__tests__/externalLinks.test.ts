import { describe, expect, it, vi } from 'vitest';
import { openExternalLink, resolveExternalLinkHref } from '../externalLinks.js';

describe('external link handling', () => {
  it.each([
    ['https://example.com/docs?q=one#two', 'https://example.com/docs?q=one#two'],
    ['http://example.com', 'http://example.com'],
    ['//example.com/docs', 'https://example.com/docs'],
    ['docblocks.com', 'https://docblocks.com/'],
    ['docs.example.com/guide', 'https://docs.example.com/guide'],
    ['localhost:5199/demo', 'https://localhost:5199/demo'],
  ])('resolves web destination %s', (href, expected) => {
    expect(resolveExternalLinkHref(href)).toBe(expected);
  });

  it.each([
    '#section',
    '/docs/page',
    './guide.md',
    '../guide.md',
    'guide.md',
    'attachments/report.pdf',
    'mailto:hello@example.com',
    'tel:+15551234567',
    'javascript:alert(1)',
    'workspace-nav:src%2Findex.ts',
    'https://',
    '//',
  ])('leaves non-web destination %s to its normal handler', (href) => {
    expect(resolveExternalLinkHref(href)).toBeNull();
  });

  it('opens resolved websites in an isolated tab', () => {
    const openWindow = vi.fn();

    expect(openExternalLink('docblocks.com', openWindow)).toBe(true);
    expect(openWindow).toHaveBeenCalledWith(
      'https://docblocks.com/',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('declines links that belong to the browser or another host handler', () => {
    const openWindow = vi.fn();

    expect(openExternalLink('../guide.md', openWindow)).toBe(false);
    expect(openWindow).not.toHaveBeenCalled();
  });
});
