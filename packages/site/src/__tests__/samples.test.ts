import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { CONTENT_SAMPLES, SAMPLE_GROUPS, getSampleLabel, SAMPLES } from '../samples.js';
import { GENERATED_SAMPLES } from '../dataSamples.js';

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

  it('keeps the sample category tree in sync with the sample registries', () => {
    const known = new Set([
      ...Object.keys(SAMPLES),
      ...Object.keys(GENERATED_SAMPLES),
      ...Object.keys(CONTENT_SAMPLES),
    ]);
    const categorized = new Set<string>();
    for (const group of SAMPLE_GROUPS) {
      for (const key of group.keys) {
        // A group must never point at a sample that does not exist…
        expect(known.has(key), `SAMPLE_GROUPS names unknown sample "${key}"`).toBe(true);
        expect(categorized.has(key), `"${key}" appears in two groups`).toBe(false);
        categorized.add(key);
      }
    }
    // …and every sample belongs to a group (the picker's "Other" fallback
    // exists as a runtime safety net, not as a place to leave things).
    for (const key of known) {
      expect(
        categorized.has(key),
        `sample "${key}" is uncategorized — add it to SAMPLE_GROUPS`,
      ).toBe(true);
    }
  });

  it('builds every generated data sample with its sidecar in place', async () => {
    for (const [key, sample] of Object.entries(GENERATED_SAMPLES)) {
      const { markdown, container } = await sample.build();
      // The doc must reference a sidecar the container actually holds.
      const src = /\{\[dataTable src=([^\s\]]+)/.exec(markdown)?.[1];
      expect(src, `${key}: no {[dataTable src=…]} reference`).toBeTruthy();
      const bytes = await container.readFile(src!);
      expect(bytes, `${key}: sidecar "${src}" missing from container`).not.toBeNull();
      expect(bytes!.byteLength).toBeGreaterThan(100);
      expect(await container.readDocument()).toBe(markdown);
    }
  });
});
