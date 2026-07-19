import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { CONTENT_SAMPLES, getSampleLabel, SAMPLES } from '../samples.js';

function collectAstNodes(value: unknown, nodes: Array<Record<string, unknown>> = []) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectAstNodes(entry, nodes));
  } else if (value && typeof value === 'object') {
    const node = value as Record<string, unknown>;
    nodes.push(node);
    Object.values(node).forEach((entry) => collectAstNodes(entry, nodes));
  }
  return nodes;
}

describe('site samples', () => {
  it('starts every sample dropdown label with a capital letter', () => {
    for (const key of Object.keys(SAMPLES)) {
      expect(getSampleLabel(key)).toMatch(/^\p{Lu}/u);
    }
    for (const sample of Object.values(CONTENT_SAMPLES)) {
      expect(sample.label).toMatch(/^\p{Lu}/u);
    }
  });

  it('keeps the About SquigglySquare footer links and GitHub icon parseable', () => {
    const astNodes = collectAstNodes(parseMarkdown(SAMPLES['about-squisq'] ?? ''));
    const linkUrls = astNodes
      .filter((node) => node.type === 'link')
      .map((node) => node.url as string);

    expect(linkUrls).toEqual(
      expect.arrayContaining([
        'https://squigglysquare.com',
        'https://github.com/bendyline/squisq',
        'https://github.com/bendyline/squisq/issues/new',
      ]),
    );
    expect(astNodes).toContainEqual(
      expect.objectContaining({ type: 'inlineIcon', family: 'brands', name: 'github' }),
    );
  });

  it('keeps demo image assets self-hosted', () => {
    for (const [sampleKey, source] of Object.entries(SAMPLES)) {
      const astNodes = collectAstNodes(parseMarkdown(source));
      const imageUrls = astNodes.flatMap((node) => {
        if (node.type === 'image' && typeof node.url === 'string') return [node.url];

        const annotation = node.templateAnnotation as
          | { params?: Record<string, string> }
          | undefined;
        const imageSrc = annotation?.params?.imageSrc;
        return imageSrc ? [imageSrc] : [];
      });

      for (const imageUrl of imageUrls) {
        expect(imageUrl, `${sampleKey} uses a remote demo image`).not.toMatch(/^https?:\/\//i);
      }
    }
  });
});
