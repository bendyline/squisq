/**
 * Chart insert starters: every gallery entry's markdown must parse into a
 * block annotated with that chart template and materialize real chart
 * marks (not the content fallback).
 */

import { describe, it, expect } from 'vitest';
import { markdownToDoc, materializeBlockLayers } from '@bendyline/squisq/doc';
import { parseMarkdown } from '@bendyline/squisq/markdown';
import { CHART_TYPES, chartStarterMarkdown, DEFAULT_CHART_TYPE } from '../chart/chartTypes';
import { TEMPLATE_ENTRIES } from '../TemplatePicker';

describe('chart starter markdown', () => {
  for (const entry of CHART_TYPES) {
    it(`"${entry.label}" starter parses and renders as ${entry.id}`, () => {
      const doc = markdownToDoc(parseMarkdown(chartStarterMarkdown(entry)), {
        generateCoverBlock: false,
      });
      expect(doc.blocks).toHaveLength(1);
      const block = doc.blocks[0];
      expect(block.template).toBe(entry.id);

      const { layers } = materializeBlockLayers(block, { persistentLayers: false });
      // Chart marks prove the starter table was chartable (no content fallback).
      // Bars/pies/scatter emit `mark-*`; line/area emit `line-*`/`area-*`.
      expect(layers.some((layer) => /^(mark|line|area)-/.test(layer.id))).toBe(true);
    });
  }

  it('every chart type maps to a template picker entry', () => {
    const pickerIds = new Set(TEMPLATE_ENTRIES.map((entry) => entry.name));
    for (const entry of CHART_TYPES) {
      expect(pickerIds.has(entry.id), `no picker entry for ${entry.id}`).toBe(true);
    }
  });

  it('default chart type is part of the gallery', () => {
    expect(CHART_TYPES).toContain(DEFAULT_CHART_TYPE);
  });
});
