import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { SAMPLES } from '../samples.js';

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
});
