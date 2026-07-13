import { describe, it, expect } from 'vitest';
import {
  applyTransform,
  resolveTransformStyle,
  getTransformStyleIds,
  createTransformStyleRegistry,
} from '../transform/index.js';
import type { TransformStyleConfig } from '../transform/index.js';
import type { Doc, Block } from '../schemas/Doc.js';
import { isTemplateBlock } from '../schemas/BlockTemplates.js';

function paragraphBlock(id: string, title: string, text: string, duration = 20): Block {
  return {
    id,
    startTime: 0,
    duration,
    audioSegment: 0,
    title,
    contents: [
      {
        type: 'paragraph',
        children: [{ type: 'text', value: text }],
      },
    ],
  };
}

/** Body with a strong quote extraction. */
const QUOTED =
  'The ranger paused at the overlook. "The mountain decides who climbs it," she said quietly. ' +
  'Every year thousands of visitors make the same journey up the winding road to Paradise.';

function sampleDoc(): Doc {
  return {
    articleId: 'transform-v2-test',
    duration: 60,
    blocks: [
      paragraphBlock('b1', 'The Mountain', QUOTED),
      paragraphBlock(
        'b2',
        'Visitors',
        'In 2024 the park recorded 2.5 million visitors, a 40% increase over the prior decade. ' +
          'Rangers attribute the growth to social media and improved road access.',
      ),
    ],
    audio: { segments: [] },
  };
}

describe('transform style contract v2', () => {
  it('suggestedThemeId applies only when the doc declares no theme', () => {
    const { doc } = applyTransform(sampleDoc(), 'magazine');
    expect(doc.themeId).toBe('magazine');

    const themed = { ...sampleDoc(), themeId: 'gezellig' };
    expect(applyTransform(themed, 'magazine').doc.themeId).toBe('gezellig');

    const viaOption = applyTransform(sampleDoc(), 'magazine', { themeId: 'bold' });
    expect(viaOption.doc.themeId).toBe('bold');
  });

  it('templateMap remaps quote extractions (magazine → pullQuote with accent image as background)', () => {
    const images = [{ src: 'photo.jpg', alt: 'a photo' }];
    const { doc } = applyTransform(sampleDoc(), 'magazine', { images });
    const templates = doc.blocks.filter(isTemplateBlock).map((b) => b.template);
    // The quote extraction maps to pullQuote (magazine's templateMap)
    // because an image was available to serve as the background.
    expect(templates).toContain('pullQuote');
    expect(templates).not.toContain('quote');
  });

  it('templateMap remap falls back to the default when the target needs an unavailable image', () => {
    const { doc } = applyTransform(sampleDoc(), 'magazine', { images: [] });
    const templates = doc.blocks.filter(isTemplateBlock).map((b) => b.template);
    expect(templates).toContain('quote');
    expect(templates).not.toContain('pullQuote');
  });

  it('pacing adds intro/outro bookends (narrative)', () => {
    const { doc } = applyTransform(sampleDoc(), 'narrative');
    const first = doc.blocks[0];
    const last = doc.blocks[doc.blocks.length - 1];
    expect(first.template).toBe('title');
    expect(first.title ?? (first as { title?: string }).title).toBeDefined();
    expect(last.template).toBe('sectionHeader');
  });

  it('resolves custom styles only through their caller-owned registry', () => {
    const custom: TransformStyleConfig = {
      ...resolveTransformStyle('minimal'),
      id: 'custom-test',
      name: 'Custom Test',
      description: 'test style',
    };
    const registry = createTransformStyleRegistry([custom]);
    expect(getTransformStyleIds(registry)).toContain('custom-test');
    expect(resolveTransformStyle('custom-test', registry).name).toBe('Custom Test');
    expect(resolveTransformStyle('custom-test').id).toBe('documentary');
    expect(
      applyTransform(sampleDoc(), 'custom-test', { registry }).doc.blocks.length,
    ).toBeGreaterThan(0);
  });

  it('normalizes the stored legacy dataDriven id without advertising it', () => {
    expect(resolveTransformStyle('data-driven').id).toBe('data-driven');
    expect(resolveTransformStyle('dataDriven').id).toBe('data-driven');
    expect(getTransformStyleIds()).not.toContain('dataDriven');
  });

  it('validates and stores immutable style snapshots in isolated registries', () => {
    const base = resolveTransformStyle('minimal');
    const source: TransformStyleConfig = {
      ...base,
      id: 'tenant-style',
      name: 'Tenant Style',
      preferredTypes: [...base.preferredTypes],
      colorSchemes: [...base.colorSchemes],
      blocksPerSection: { ...base.blocksPerSection },
    };
    const tenantA = createTransformStyleRegistry([source]);
    const tenantB = createTransformStyleRegistry();
    source.name = 'Changed later';
    source.colorSchemes[0] = 'red';

    const stored = tenantA.get('tenant-style')!;
    expect(stored.name).toBe('Tenant Style');
    expect(stored.colorSchemes[0]).toBe(base.colorSchemes[0]);
    expect(Object.isFrozen(stored)).toBe(true);
    expect(Object.isFrozen(stored.colorSchemes)).toBe(true);
    expect(tenantB.get('tenant-style')).toBeUndefined();

    expect(() => tenantA.register({ ...source, id: 'bad-style', transformRatio: 2 })).toThrow(
      /transformRatio/,
    );
  });

  it('budget.slidesPerMinute caps promotions on long docs', () => {
    const manyBlocks: Doc = {
      articleId: 'budget-test',
      duration: 60,
      blocks: Array.from({ length: 12 }, (_, i) =>
        paragraphBlock(
          `b${i}`,
          `Section ${i}`,
          `In 2024 the park recorded ${(i + 2) * 7}% growth across all visitor categories nationwide.`,
          5,
        ),
      ),
      audio: { segments: [] },
    };
    const unbudgeted = resolveTransformStyle('data-driven');
    const budgeted: TransformStyleConfig = {
      ...unbudgeted,
      id: 'custom-test',
      budget: { slidesPerMinute: 2 },
    };
    const loose = applyTransform(manyBlocks, 'data-driven');
    const tight = applyTransform(manyBlocks, budgeted);
    expect(tight.stats.transformedBlocks).toBeLessThan(loose.stats.transformedBlocks);
    // 12 blocks x 5s = 60s → 2/minute → at most 2 promotions
    expect(tight.stats.transformedBlocks).toBeLessThanOrEqual(2);
  });
});
